#!/usr/bin/env python3
"""
Independent Deterministic Test Vector Generator for PhotoCloud Zero-Knowledge (v2).

Generates `test-vectors/zk-v1.json` and binary `.pczk` interoperability fixtures:
- `test-vectors/interop-empty.pczk`
- `test-vectors/interop-single.pczk`
- `test-vectors/interop-multi.pczk`

This script does NOT import or execute any PhotoCloud TypeScript or Kotlin code.
It uses Python's `cryptography` library when installed in the active environment,
and falls back to OpenSSL `libcrypto.so.3` (via ctypes) + Python stdlib `hashlib`/`hmac`
when running in minimal container environments without `pip`.
"""

from __future__ import annotations

import base64
import ctypes
import ctypes.util
import hashlib
import hmac
import json
import math
import struct
import unicodedata
from pathlib import Path
from typing import Dict, List, Tuple


# ---------------------------------------------------------------------------
# Cryptographic Primitives (Python `cryptography` with OpenSSL libcrypto fallback)
# ---------------------------------------------------------------------------

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    HAS_PYCA_CRYPTOGRAPHY = True
except ImportError:
    HAS_PYCA_CRYPTOGRAPHY = False


class _OpenSslAesGcm:
    """Direct binding to OpenSSL 3.x EVP AES-256-GCM when pyca/cryptography is absent."""

    EVP_CTRL_GCM_SET_IVLEN = 0x9
    EVP_CTRL_GCM_GET_TAG = 0x10

    def __init__(self) -> None:
        lib_name = ctypes.util.find_library("crypto") or "libcrypto.so.3"
        self.lib = ctypes.CDLL(lib_name)

        self.lib.EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
        self.lib.EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]
        self.lib.EVP_aes_256_gcm.restype = ctypes.c_void_p

        self.lib.EVP_EncryptInit_ex.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_char_p,
            ctypes.c_char_p,
        ]
        self.lib.EVP_EncryptInit_ex.restype = ctypes.c_int

        self.lib.EVP_CIPHER_CTX_ctrl.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_void_p,
        ]
        self.lib.EVP_CIPHER_CTX_ctrl.restype = ctypes.c_int

        self.lib.EVP_EncryptUpdate.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_int),
            ctypes.c_char_p,
            ctypes.c_int,
        ]
        self.lib.EVP_EncryptUpdate.restype = ctypes.c_int

        self.lib.EVP_EncryptFinal_ex.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_int),
        ]
        self.lib.EVP_EncryptFinal_ex.restype = ctypes.c_int

    def encrypt(self, key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> Tuple[bytes, bytes]:
        if len(key) != 32:
            raise ValueError("AES-256-GCM requires a 32-byte key")
        ctx = self.lib.EVP_CIPHER_CTX_new()
        if not ctx:
            raise RuntimeError("EVP_CIPHER_CTX_new failed")
        try:
            cipher = self.lib.EVP_aes_256_gcm()
            if self.lib.EVP_EncryptInit_ex(ctx, cipher, None, None, None) != 1:
                raise RuntimeError("EVP_EncryptInit_ex (cipher) failed")
            if self.lib.EVP_CIPHER_CTX_ctrl(ctx, self.EVP_CTRL_GCM_SET_IVLEN, len(nonce), None) != 1:
                raise RuntimeError("EVP_CTRL_GCM_SET_IVLEN failed")
            if self.lib.EVP_EncryptInit_ex(ctx, None, None, key, nonce) != 1:
                raise RuntimeError("EVP_EncryptInit_ex (key/nonce) failed")

            out_len = ctypes.c_int(0)
            if aad:
                if self.lib.EVP_EncryptUpdate(ctx, None, ctypes.byref(out_len), aad, len(aad)) != 1:
                    raise RuntimeError("EVP_EncryptUpdate (AAD) failed")

            ct_buf = ctypes.create_string_buffer(len(plaintext) + 16)
            total_len = 0
            if plaintext:
                out_len.value = 0
                if (
                    self.lib.EVP_EncryptUpdate(
                        ctx, ct_buf, ctypes.byref(out_len), plaintext, len(plaintext)
                    )
                    != 1
                ):
                    raise RuntimeError("EVP_EncryptUpdate (plaintext) failed")
                total_len = out_len.value

            final_len = ctypes.c_int(0)
            final_buf = ctypes.create_string_buffer(16)
            if self.lib.EVP_EncryptFinal_ex(ctx, final_buf, ctypes.byref(final_len)) != 1:
                raise RuntimeError("EVP_EncryptFinal_ex failed")

            tag_buf = ctypes.create_string_buffer(16)
            if self.lib.EVP_CIPHER_CTX_ctrl(ctx, self.EVP_CTRL_GCM_GET_TAG, 16, tag_buf) != 1:
                raise RuntimeError("EVP_CTRL_GCM_GET_TAG failed")

            return ct_buf.raw[:total_len], tag_buf.raw[:16]
        finally:
            self.lib.EVP_CIPHER_CTX_free(ctx)


_OPENSSL_GCM = None if HAS_PYCA_CRYPTOGRAPHY else _OpenSslAesGcm()


def aes_256_gcm_encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> Dict[str, bytes]:
    """Encrypts with AES-256-GCM and returns {'ct', 'tag', 'combined': nonce || ct || tag}."""
    if HAS_PYCA_CRYPTOGRAPHY:
        ct_and_tag = AESGCM(key).encrypt(nonce, plaintext, aad)
        ct, tag = ct_and_tag[:-16], ct_and_tag[-16:]
    else:
        assert _OPENSSL_GCM is not None
        ct, tag = _OPENSSL_GCM.encrypt(key, nonce, plaintext, aad)
    return {
        "ct": ct,
        "tag": tag,
        "combined": nonce + ct + tag,
    }


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    """RFC 5869 HKDF-SHA256."""
    if HAS_PYCA_CRYPTOGRAPHY:
        return HKDF(
            algorithm=hashes.SHA256(),
            length=length,
            salt=salt if len(salt) > 0 else None,
            info=info,
        ).derive(ikm)
    actual_salt = salt if len(salt) > 0 else b"\x00" * 32
    prk = hmac.new(actual_salt, ikm, hashlib.sha256).digest()
    okm = bytearray()
    t = b""
    counter = 1
    while len(okm) < length:
        t = hmac.new(prk, t + info + bytes([counter]), hashlib.sha256).digest()
        okm.extend(t)
        counter += 1
    return bytes(okm[:length])


# ---------------------------------------------------------------------------
# RFC 9106 Argon2id Reference Implementation (using Python stdlib hashlib.blake2b)
# ---------------------------------------------------------------------------

MASK64 = 0xFFFFFFFFFFFFFFFF


def _rotr64(x: int, n: int) -> int:
    return ((x >> n) | ((x << (64 - n)) & MASK64)) & MASK64


def _f_blamka(x: int, y: int) -> int:
    xy = (x & 0xFFFFFFFF) * (y & 0xFFFFFFFF)
    return (x + y + (xy << 1)) & MASK64


def _g_argon(v: List[int], a: int, b: int, c: int, d: int) -> None:
    v[a] = _f_blamka(v[a], v[b])
    v[d] = _rotr64(v[d] ^ v[a], 32)
    v[c] = _f_blamka(v[c], v[d])
    v[b] = _rotr64(v[b] ^ v[c], 24)
    v[a] = _f_blamka(v[a], v[b])
    v[d] = _rotr64(v[d] ^ v[a], 16)
    v[c] = _f_blamka(v[c], v[d])
    v[b] = _rotr64(v[b] ^ v[c], 63)


def _p_argon(
    v: List[int],
    i0: int, i1: int, i2: int, i3: int,
    i4: int, i5: int, i6: int, i7: int,
    i8: int, i9: int, i10: int, i11: int,
    i12: int, i13: int, i14: int, i15: int,
) -> None:
    _g_argon(v, i0, i4, i8, i12)
    _g_argon(v, i1, i5, i9, i13)
    _g_argon(v, i2, i6, i10, i14)
    _g_argon(v, i3, i7, i11, i15)
    _g_argon(v, i0, i5, i10, i15)
    _g_argon(v, i1, i6, i11, i12)
    _g_argon(v, i2, i7, i8, i13)
    _g_argon(v, i3, i4, i9, i14)


def _compress_block(x_blk: List[int], y_blk: List[int], out_blk: List[int], xor_out: bool) -> None:
    r = [x_blk[i] ^ y_blk[i] for i in range(128)]
    z = r[:]
    for row in range(8):
        o = row * 16
        _p_argon(
            z,
            o + 0, o + 1, o + 2, o + 3,
            o + 4, o + 5, o + 6, o + 7,
            o + 8, o + 9, o + 10, o + 11,
            o + 12, o + 13, o + 14, o + 15,
        )
    for col in range(8):
        o = col * 2
        _p_argon(
            z,
            o, o + 1, o + 16, o + 17,
            o + 32, o + 33, o + 48, o + 49,
            o + 64, o + 65, o + 80, o + 81,
            o + 96, o + 97, o + 112, o + 113,
        )
    if xor_out:
        for i in range(128):
            out_blk[i] ^= z[i] ^ r[i]
    else:
        for i in range(128):
            out_blk[i] = z[i] ^ r[i]


def _blake2b_long(data: bytes, out_len: int) -> bytes:
    prefix = struct.pack("<I", out_len) + data
    if out_len <= 64:
        return hashlib.blake2b(prefix, digest_size=out_len).digest()
    r = math.ceil(out_len / 32) - 2
    v = hashlib.blake2b(prefix, digest_size=64).digest()
    chunks = [v[:32]]
    for _ in range(1, r):
        v = hashlib.blake2b(v, digest_size=64).digest()
        chunks.append(v[:32])
    last_len = out_len - 32 * r
    v = hashlib.blake2b(v, digest_size=last_len).digest()
    chunks.append(v)
    return b"".join(chunks)


def argon2id_rfc9106(
    password: bytes,
    salt: bytes,
    m_kib: int,
    t: int,
    p: int,
    tag_len: int = 32,
    secret: bytes = b"",
    ad: bytes = b"",
) -> bytes:
    """RFC 9106 Argon2id v1.3 (0x13) derivation."""
    try:
        from cryptography.hazmat.primitives.kdf.argon2 import Argon2id as PycaArgon2id

        if not secret and not ad:
            return PycaArgon2id(
                salt=salt,
                length=tag_len,
                iterations=t,
                lanes=p,
                memory_cost=m_kib,
            ).derive(password)
    except Exception:
        pass

    h0_input = (
        struct.pack("<IIIIII", p, tag_len, m_kib, t, 0x13, 2)
        + struct.pack("<I", len(password)) + password
        + struct.pack("<I", len(salt)) + salt
        + struct.pack("<I", len(secret)) + secret
        + struct.pack("<I", len(ad)) + ad
    )
    h0 = hashlib.blake2b(h0_input, digest_size=64).digest()

    m_prime = 4 * p * (m_kib // (4 * p))
    q = m_prime // p
    segment_len = q // 4

    blocks: List[List[int]] = [[0] * 128 for _ in range(m_prime)]

    def bytes_to_block(buf: bytes, target: List[int]) -> None:
        target[:] = list(struct.unpack("<128Q", buf))

    for lane in range(p):
        b0 = _blake2b_long(h0 + struct.pack("<II", 0, lane), 1024)
        b1 = _blake2b_long(h0 + struct.pack("<II", 1, lane), 1024)
        bytes_to_block(b0, blocks[lane * q + 0])
        bytes_to_block(b1, blocks[lane * q + 1])

    zero_blk = [0] * 128
    in_blk = [0] * 128
    addr_blk = [0] * 128
    tmp_blk = [0] * 128

    for pass_num in range(t):
        for sl in range(4):
            data_indep = pass_num == 0 and sl < 2
            for lane in range(p):
                addr_counter = 0
                if data_indep:
                    in_blk = [pass_num, lane, sl, m_prime, t, 2] + [0] * 122
                start_idx = 2 if (pass_num == 0 and sl == 0) else 0
                for idx in range(start_idx, segment_len):
                    curr_off = lane * q + sl * segment_len + idx
                    prev_off = (lane * q + q - 1) if (sl == 0 and idx == 0) else (curr_off - 1)

                    if data_indep:
                        if idx % 128 == 0 or idx == start_idx:
                            addr_counter += 1
                            in_blk[6] = addr_counter
                            _compress_block(zero_blk, in_blk, tmp_blk, False)
                            _compress_block(zero_blk, tmp_blk, addr_blk, False)
                        prand = addr_blk[idx % 128]
                    else:
                        prand = blocks[prev_off][0]

                    j1 = prand & 0xFFFFFFFF
                    j2 = (prand >> 32) & 0xFFFFFFFF
                    ref_lane = lane if (pass_num == 0 and sl == 0) else (j2 % p)

                    if pass_num == 0:
                        if sl == 0:
                            ref_area = idx - 1
                        elif ref_lane == lane:
                            ref_area = sl * segment_len + idx - 1
                        else:
                            ref_area = sl * segment_len - (1 if idx == 0 else 0)
                    else:
                        if ref_lane == lane:
                            ref_area = q - segment_len + idx - 1
                        else:
                            ref_area = q - segment_len - (1 if idx == 0 else 0)

                    rel_pos = (j1 * j1) >> 32
                    map_pos = ref_area - 1 - ((ref_area * rel_pos) >> 32)
                    start_pos = 0 if pass_num == 0 else (((sl + 1) % 4) * segment_len)
                    ref_idx = (start_pos + map_pos) % q
                    ref_off = ref_lane * q + ref_idx

                    _compress_block(blocks[prev_off], blocks[ref_off], blocks[curr_off], pass_num > 0)

    c_blk = blocks[q - 1][:]
    for lane in range(1, p):
        last_blk = blocks[lane * q + q - 1]
        for i in range(128):
            c_blk[i] ^= last_blk[i]

    c_bytes = struct.pack("<128Q", *c_blk)
    return _blake2b_long(c_bytes, tag_len)


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def build_pczk_blob(
    chunk_size_log2: int,
    blob_id_bytes: bytes,
    nonce_prefix: bytes,
    wrapped_fk_combined: bytes,
    file_key: bytes,
    plaintext: bytes,
) -> Tuple[Dict[str, object], bytes]:
    header = (
        b"PCZK"
        + bytes([0x01, chunk_size_log2])
        + blob_id_bytes
        + nonce_prefix
        + wrapped_fk_combined
    )
    assert len(header) == 86
    header_sha256 = hashlib.sha256(header).digest()
    chunk_size = 1 << chunk_size_log2
    num_chunks = 1 if len(plaintext) == 0 else math.ceil(len(plaintext) / chunk_size)

    chunk_infos = []
    encrypted_chunks = []

    for i in range(num_chunks):
        start = i * chunk_size
        end = min(len(plaintext), (i + 1) * chunk_size)
        chunk_pt = plaintext[start:end]
        is_last = 1 if (i == num_chunks - 1) else 0
        nonce = nonce_prefix + struct.pack(">Q", i)
        aad = header_sha256 + bytes([is_last])
        res = aes_256_gcm_encrypt(file_key, nonce, chunk_pt, aad)
        chunk_blob = res["ct"] + res["tag"]
        encrypted_chunks.append(chunk_blob)
        chunk_infos.append(
            {
                "chunkIndex": i,
                "isLast": bool(is_last == 1),
                "plaintextLength": len(chunk_pt),
                "ciphertextWithTagLength": len(chunk_blob),
                "nonceHex": nonce.hex(),
                "aadHex": aad.hex(),
                "tagHex": res["tag"].hex(),
            }
        )

    full_blob = header + b"".join(encrypted_chunks)
    ct_sha256 = hashlib.sha256(full_blob).digest()
    info: Dict[str, object] = {
        "chunkSizeLog2": chunk_size_log2,
        "plaintextLength": len(plaintext),
        "totalCiphertextLength": len(full_blob),
        "headerHex": header.hex(),
        "headerB64u": b64u(header),
        "headerSha256Hex": header_sha256.hex(),
        "ciphertextSha256Hex": ct_sha256.hex(),
        "chunks": chunk_infos,
    }
    if len(full_blob) <= 512:
        info["fullBlobHex"] = full_blob.hex()
        info["fullBlobB64u"] = b64u(full_blob)
    return info, full_blob


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "test-vectors"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. RFC 5869 Official HKDF-SHA256 Test Vectors (Appendix A.1, A.2, A.3)
    rfc5869_vectors = [
        {
            "name": "RFC 5869 Test Case 1",
            "ikmHex": ("0b" * 22),
            "saltHex": "000102030405060708090a0b0c",
            "infoHex": "f0f1f2f3f4f5f6f7f8f9",
            "length": 42,
            "expectedOkmHex": (
                "3cb25f25faacd57a90434f64d0362f2a"
                "2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
                "34007208d5b887185865"
            ),
        },
        {
            "name": "RFC 5869 Test Case 2",
            "ikmHex": bytes(range(0x00, 0x50)).hex(),
            "saltHex": bytes(range(0x60, 0xB0)).hex(),
            "infoHex": bytes(range(0xB0, 0x100)).hex(),
            "length": 82,
            "expectedOkmHex": (
                "b11e398dc80327a1c8e7f78c596a4934"
                "4f012eda2d4efad8a050cc4c19afa97c"
                "59045a99cac7827271cb41c65e590e09"
                "da3275600c2f09b8367793a9aca3db71"
                "cc30c58179ec3e87c14c01d5c1f3434f"
                "1d87"
            ),
        },
        {
            "name": "RFC 5869 Test Case 3 (zero-length salt and info)",
            "ikmHex": ("0b" * 22),
            "saltHex": "",
            "infoHex": "",
            "length": 42,
            "expectedOkmHex": (
                "8da4e775a563c18f715f802a063c5a31"
                "b8a11f5c5ee1879ec3454e5f3c738d2d"
                "9d201395faa4b61a96c8"
            ),
        },
    ]

    for tc in rfc5869_vectors:
        derived = hkdf_sha256(
            bytes.fromhex(str(tc["ikmHex"])),
            bytes.fromhex(str(tc["saltHex"])),
            bytes.fromhex(str(tc["infoHex"])),
            int(tc["length"]),
        )
        assert derived.hex() == tc["expectedOkmHex"], f"RFC 5869 mismatch in {tc['name']}"

    # 2. RFC 9106 §5.3 Official Argon2id Test Vector
    rfc9106_tag = argon2id_rfc9106(
        password=b"\x01" * 32,
        salt=b"\x02" * 16,
        m_kib=32,
        t=3,
        p=4,
        tag_len=32,
        secret=b"\x03" * 8,
        ad=b"\x04" * 12,
    )
    expected_rfc9106_hex = "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659"
    assert rfc9106_tag.hex() == expected_rfc9106_hex, "RFC 9106 §5.3 mismatch"

    # 3. PhotoCloud Zero-Knowledge v2 Hierarchy & Blobs
    user_id = "550e8400-e29b-41d4-a716-446655440000"
    username = "alice"
    account_key = bytes.fromhex("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")
    user_salt = bytes.fromhex("a1a2a3a4a5a6a7a8a9aaabacadaeafb0")
    passphrase = "correct-horse-battery-staple-zk2"
    passphrase_bytes = unicodedata.normalize("NFC", passphrase).encode("utf-8")

    argon_fast = argon2id_rfc9106(passphrase_bytes, user_salt, m_kib=1024, t=2, p=1, tag_len=32)
    argon_spec = argon2id_rfc9106(passphrase_bytes, user_salt, m_kib=65536, t=3, p=1, tag_len=32)

    def derive_hierarchy(pass_part: bytes) -> Tuple[Dict[str, str], bytes]:
        ikm = pass_part + account_key
        root = hkdf_sha256(ikm, user_salt, b"photocloud/v2/root", 32)
        kek = hkdf_sha256(root, b"", b"photocloud/v2/kek", 32)
        auth_secret = hkdf_sha256(root, b"", b"photocloud/v2/auth", 32)
        return (
            {
                "passphrasePartHex": pass_part.hex(),
                "passphrasePartB64u": b64u(pass_part),
                "ikmHex": ikm.hex(),
                "rootHex": root.hex(),
                "rootB64u": b64u(root),
                "kekHex": kek.hex(),
                "kekB64u": b64u(kek),
                "authSecretHex": auth_secret.hex(),
                "authSecretB64u": b64u(auth_secret),
            },
            kek,
        )

    with_pass_spec, kek_spec = derive_hierarchy(argon_spec)
    with_pass_fast, kek_fast = derive_hierarchy(argon_fast)
    without_pass, kek_nopass = derive_hierarchy(b"\x00" * 32)

    vault_key = bytes.fromhex("102030405060708090a0b0c0d0e0f000112233445566778899aabbccddeeff00")
    vk_nonce = bytes.fromhex("b1b2b3b4b5b6b7b8b9babbbc")
    vk_aad = f"vk|{user_id}".encode("utf-8")

    wrapped_vk_spec = aes_256_gcm_encrypt(kek_spec, vk_nonce, vault_key, vk_aad)
    wrapped_vk_fast = aes_256_gcm_encrypt(kek_fast, vk_nonce, vault_key, vk_aad)
    wrapped_vk_nopass = aes_256_gcm_encrypt(kek_nopass, vk_nonce, vault_key, vk_aad)

    meta_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/metaKey", 32)
    thumb_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/thumbKey", 32)
    dedup_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/dedupKey", 32)
    fk_wrap_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/fkWrapKey", 32)

    blob_id = "d3b07384-d113-4e59-9c2a-7b8e1f02a3c4"
    blob_id_bytes = bytes.fromhex(blob_id.replace("-", ""))
    file_key = bytes.fromhex("f0e1d2c3b4a5968778695a4b3c2d1e0f0f1e2d3c4b5a69788796a5b4c3d2e1f0")
    fk_wrap_nonce = bytes.fromhex("c1c2c3c4c5c6c7c8c9cacbcc")
    wrapped_fk = aes_256_gcm_encrypt(fk_wrap_key, fk_wrap_nonce, file_key, blob_id_bytes)

    nonce_prefix = bytes.fromhex("deadbeef")

    empty_info, empty_bytes = build_pczk_blob(
        20, blob_id_bytes, nonce_prefix, wrapped_fk["combined"], file_key, b""
    )
    sample_pt = b"PhotoCloud Zero-Knowledge Test Vector"
    single_info, single_bytes = build_pczk_blob(
        20, blob_id_bytes, nonce_prefix, wrapped_fk["combined"], file_key, sample_pt
    )
    multi_pt = bytes(((i * 31 + 17) & 0xFF) for i in range(150000))
    multi_info, multi_bytes = build_pczk_blob(
        16, blob_id_bytes, nonce_prefix, wrapped_fk["combined"], file_key, multi_pt
    )

    # Write binary interoperability fixtures
    (out_dir / "interop-empty.pczk").write_bytes(empty_bytes)
    (out_dir / "interop-single.pczk").write_bytes(single_bytes)
    (out_dir / "interop-multi.pczk").write_bytes(multi_bytes)

    dedup_sample = hmac.new(dedup_key, sample_pt, hashlib.sha256).digest()
    dedup_multi_ctx = hmac.new(dedup_key, b"", hashlib.sha256)
    for off in range(0, len(multi_pt), 65536):
        dedup_multi_ctx.update(multi_pt[off : off + 65536])
    dedup_multi = dedup_multi_ctx.digest()

    blob_meta_key = hkdf_sha256(meta_key, blob_id_bytes, b"photocloud/v2/blob-meta", 32)
    meta_nonce = bytes.fromhex("d1d2d3d4d5d6d7d8d9dadbdc")
    meta_aad = f"meta|{blob_id}".encode("utf-8")
    meta_json_str = json.dumps(
        {
            "v": 1,
            "name": "IMG_20261115_183000.jpg",
            "mime": "image/jpeg",
            "size": 37,
            "takenAt": 1763231400000,
            "createdAt": 1763231405000,
            "width": 4032,
            "height": 3024,
            "duration": None,
            "isFavorite": True,
            "exifSubset": {
                "make": "Google",
                "model": "Pixel 9 Pro",
                "iso": 64,
                "lat": 41.89021,
                "lon": 12.49223,
            },
            "dedupTag": b64u(dedup_sample),
            "thumbs": {
                "sm": {"present": True, "width": 320, "height": 240, "sizeBytes": 16},
                "md": {"present": False, "width": 0, "height": 0, "sizeBytes": 0},
            },
        },
        separators=(",", ":"),
    )
    encrypted_meta = aes_256_gcm_encrypt(
        blob_meta_key, meta_nonce, meta_json_str.encode("utf-8"), meta_aad
    )

    blob_thumb_key_320 = hkdf_sha256(thumb_key, blob_id_bytes, b"photocloud/v2/thumb/320", 32)
    thumb_nonce = bytes.fromhex("e1e2e3e4e5e6e7e8e9eaebec")
    thumb_aad = f"thumb|{blob_id}|320".encode("utf-8")
    sample_thumb_pt = bytes.fromhex("ffd8ffe000104a464946000101000001ffd9")
    encrypted_thumb_320 = aes_256_gcm_encrypt(
        blob_thumb_key_320, thumb_nonce, sample_thumb_pt, thumb_aad
    )

    album_catalog_key = hkdf_sha256(
        meta_key, user_id.encode("utf-8"), b"photocloud/v2/albums", 32
    )
    album_revision = 1
    album_nonce = bytes.fromhex("f1f2f3f4f5f6f7f8f9fafbfc")
    album_aad = f"albums|{user_id}|{album_revision}".encode("utf-8")
    album_json_str = json.dumps(
        {
            "v": 1,
            "revision": album_revision,
            "updatedAt": 1763232000000,
            "albums": [
                {
                    "id": "alb_90c1a2b3-4d5e-4f6a-8b9c-0d1e2f3a4b5c",
                    "name": "Vacanze Estate 2026",
                    "createdAt": 1763231000000,
                    "coverBlobId": blob_id,
                    "blobIds": [blob_id],
                }
            ],
        },
        separators=(",", ":"),
    )
    encrypted_albums = aes_256_gcm_encrypt(
        album_catalog_key, album_nonce, album_json_str.encode("utf-8"), album_aad
    )
    album_payload_bin = struct.pack(">I", album_revision) + encrypted_albums["combined"]

    share_id = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    share_key = bytes.fromhex("2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40")
    share_wrap_key = hkdf_sha256(share_key, b"", b"photocloud/v2/share/wrap", 32)
    share_meta_key = hkdf_sha256(share_key, b"", b"photocloud/v2/share/meta", 32)
    share_fk_nonce = bytes.fromhex("a0a1a2a3a4a5a6a7a8a9aaab")
    share_fk_aad = f"share-fk|{share_id}|{blob_id}".encode("utf-8")
    share_wrapped_fk = aes_256_gcm_encrypt(share_wrap_key, share_fk_nonce, file_key, share_fk_aad)

    vectors = {
        "version": "photocloud-zk-v1",
        "specVersion": 2,
        "description": "Shared deterministic test vectors for PhotoCloud Zero-Knowledge v2 (TypeScript Web/Node & Android Kotlin), generated independently by scripts/gen-zk-vectors.py",
        "rfc5869HkdfSha256": rfc5869_vectors,
        "rfc9106SelfCheck": {
            "description": "RFC 9106 Section 5.3 Official Argon2id Test Vector",
            "passwordHex": ("01" * 32),
            "saltHex": ("02" * 16),
            "secretHex": ("03" * 8),
            "associatedDataHex": ("04" * 12),
            "mKiB": 32,
            "t": 3,
            "p": 4,
            "tagLen": 32,
            "expectedTagHex": expected_rfc9106_hex,
        },
        "inputs": {
            "userId": user_id,
            "username": username,
            "accountKeyHex": account_key.hex(),
            "accountKeyB64u": b64u(account_key),
            "userSaltHex": user_salt.hex(),
            "userSaltB64u": b64u(user_salt),
            "passphraseUtf8": passphrase,
            "argon2SpecParams": {
                "memoryKiB": 65536,
                "iterations": 3,
                "parallelism": 1,
                "hashLength": 32,
            },
            "argon2FastParams": {
                "memoryKiB": 1024,
                "iterations": 2,
                "parallelism": 1,
                "hashLength": 32,
            },
        },
        "keyHierarchy": {
            "withPassphraseSpec": with_pass_spec,
            "withPassphraseFast": with_pass_fast,
            "withoutPassphrase": without_pass,
        },
        "vaultKeyAndSubkeys": {
            "vaultKeyHex": vault_key.hex(),
            "vaultKeyB64u": b64u(vault_key),
            "vkWrapNonceHex": vk_nonce.hex(),
            "vkWrapAadUtf8": f"vk|{user_id}",
            "vkWrapAadHex": vk_aad.hex(),
            "wrappedVkSpecHex": wrapped_vk_spec["combined"].hex(),
            "wrappedVkSpecB64u": b64u(wrapped_vk_spec["combined"]),
            "wrappedVkFastHex": wrapped_vk_fast["combined"].hex(),
            "wrappedVkFastB64u": b64u(wrapped_vk_fast["combined"]),
            "wrappedVkNoPassHex": wrapped_vk_nopass["combined"].hex(),
            "wrappedVkNoPassB64u": b64u(wrapped_vk_nopass["combined"]),
            "subkeys": {
                "metaKeyHex": meta_key.hex(),
                "metaKeyB64u": b64u(meta_key),
                "thumbKeyHex": thumb_key.hex(),
                "thumbKeyB64u": b64u(thumb_key),
                "dedupKeyHex": dedup_key.hex(),
                "dedupKeyB64u": b64u(dedup_key),
                "fkWrapKeyHex": fk_wrap_key.hex(),
                "fkWrapKeyB64u": b64u(fk_wrap_key),
            },
        },
        "fileKeyWrap": {
            "blobId": blob_id,
            "blobIdBytesHex": blob_id_bytes.hex(),
            "fileKeyHex": file_key.hex(),
            "fileKeyB64u": b64u(file_key),
            "fkWrapNonceHex": fk_wrap_nonce.hex(),
            "fkWrapAadHex": blob_id_bytes.hex(),
            "wrappedFkHex": wrapped_fk["combined"].hex(),
            "wrappedFkB64u": b64u(wrapped_fk["combined"]),
        },
        "pczkBlobs": {
            "noncePrefixHex": nonce_prefix.hex(),
            "emptyFile": {
                "fixtureFile": "test-vectors/interop-empty.pczk",
                **empty_info,
            },
            "singleChunk": {
                "fixtureFile": "test-vectors/interop-single.pczk",
                "plaintextUtf8": "PhotoCloud Zero-Knowledge Test Vector",
                "plaintextHex": sample_pt.hex(),
                **single_info,
            },
            "multiChunk": {
                "fixtureFile": "test-vectors/interop-multi.pczk",
                "plaintextGeneratorFormula": "byte[i] = (i * 31 + 17) & 0xff for i in 0..149999",
                "plaintextSha256Hex": hashlib.sha256(multi_pt).hexdigest(),
                **multi_info,
            },
        },
        "dedupTags": {
            "streamingBlockSizeBytes": 65536,
            "singleChunkPlaintextDedupTagHex": dedup_sample.hex(),
            "singleChunkPlaintextDedupTagB64u": b64u(dedup_sample),
            "multiChunkPlaintextDedupTagHex": dedup_multi.hex(),
            "multiChunkPlaintextDedupTagB64u": b64u(dedup_multi),
        },
        "encryptedMetadata": {
            "blobId": blob_id,
            "blobMetaKeyHex": blob_meta_key.hex(),
            "nonceHex": meta_nonce.hex(),
            "aadUtf8": f"meta|{blob_id}",
            "aadHex": meta_aad.hex(),
            "plaintextJson": meta_json_str,
            "encryptedMetaHex": encrypted_meta["combined"].hex(),
            "encryptedMetaB64u": b64u(encrypted_meta["combined"]),
        },
        "encryptedThumbnail": {
            "blobId": blob_id,
            "variant": "320",
            "blobThumbKeyHex": blob_thumb_key_320.hex(),
            "nonceHex": thumb_nonce.hex(),
            "aadUtf8": f"thumb|{blob_id}|320",
            "aadHex": thumb_aad.hex(),
            "plaintextHex": sample_thumb_pt.hex(),
            "encryptedThumbHex": encrypted_thumb_320["combined"].hex(),
            "encryptedThumbB64u": b64u(encrypted_thumb_320["combined"]),
        },
        "encryptedAlbums": {
            "userId": user_id,
            "revision": album_revision,
            "albumCatalogKeyHex": album_catalog_key.hex(),
            "nonceHex": album_nonce.hex(),
            "aadUtf8": f"albums|{user_id}|{album_revision}",
            "aadHex": album_aad.hex(),
            "plaintextJson": album_json_str,
            "payloadHex": album_payload_bin.hex(),
            "payloadB64u": b64u(album_payload_bin),
        },
        "sharing": {
            "shareId": share_id,
            "shareKeyHex": share_key.hex(),
            "shareKeyB64u": b64u(share_key),
            "shareUrlFragment": f"/share/{share_id}#{b64u(share_key)}",
            "shareWrapKeyHex": share_wrap_key.hex(),
            "shareMetaKeyHex": share_meta_key.hex(),
            "shareFkNonceHex": share_fk_nonce.hex(),
            "shareFkAadUtf8": f"share-fk|{share_id}|{blob_id}",
            "shareWrappedFkHex": share_wrapped_fk["combined"].hex(),
            "shareWrappedFkB64u": b64u(share_wrapped_fk["combined"]),
        },
    }

    out_json_path = out_dir / "zk-v1.json"
    out_json_path.write_text(json.dumps(vectors, indent=2) + "\n", encoding="utf-8")
    print(f"[gen-zk-vectors.py] Successfully wrote {out_json_path} and 3 .pczk fixtures.")


if __name__ == "__main__":
    main()
