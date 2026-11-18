#!/usr/bin/env python3
"""
Independent Interoperability Verifier for PhotoCloud Zero-Knowledge (v2) — Phase 4A.2.

Starting ONLY from `test-vectors/interop/manifest.json` and the cryptographic
specification (`docs/zk-spec.md`), without importing or executing any TypeScript
or Kotlin code, this script:
1. Derives `root`, `kek`, and `authSecret` from `accountKey` + `passphrase` + `userSalt`
   via Argon2id (m=65536 KiB, t=3, p=1) and HKDF-SHA256.
2. Unwraps `wrappedVk.bin` using `kek` (AES-256-GCM, AAD="vk|<userId>") to obtain `VK`.
3. Derives subkeys (`metaKey`, `thumbKey`, `dedupKey`, `fkWrapKey`) from `VK`.
4. Parses and decrypts `blob.pczk` (PCZK v1 header + AES-256-GCM chunks), verifying
   ciphertext SHA-256, plaintext SHA-256, and `dedupTag` (HMAC-SHA256).
5. Decrypts `encMeta.bin` (HKDF per-blob `blobMetaKey`, AAD="meta|<blobId>").
6. Decrypts `shareManifest.bin` (HKDF `shareMetaKey`, AAD="share-manifest|<shareId>")
   and unwraps the per-item `wrappedFk` (HKDF `shareWrapKey`, AAD="share-fk|<shareId>|<blobId>").
7. Decrypts `albums.bin` (HKDF `albumCatalogKey`, AAD="albums|<userId>|<revision>").
8. Also verifies `android-app/app/build/interop-kotlin/` (real Kotlin -> TypeScript artifacts
   produced by `testDebugUnitTest` / CI), returning `[PENDING]` locally when absent and failing
   with non-zero exit if `--require-kotlin` / `REQUIRE_KOTLIN_ARTIFACTS=1` is set.
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
import sys
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Dict, Tuple


# ---------------------------------------------------------------------------
# AES-256-GCM (pyca/cryptography when installed, OpenSSL libcrypto.so.3 fallback)
# ---------------------------------------------------------------------------

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    HAS_PYCA_CRYPTOGRAPHY = True
except ImportError:
    HAS_PYCA_CRYPTOGRAPHY = False


class _OpenSslAesGcm:
    EVP_CTRL_GCM_SET_IVLEN = 0x9
    EVP_CTRL_GCM_GET_TAG = 0x10
    EVP_CTRL_GCM_SET_TAG = 0x11

    def __init__(self) -> None:
        lib_name = ctypes.util.find_library("crypto") or "libcrypto.so.3"
        self.lib = ctypes.CDLL(lib_name)

        self.lib.EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
        self.lib.EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]
        self.lib.EVP_aes_256_gcm.restype = ctypes.c_void_p

        self.lib.EVP_EncryptInit_ex.argtypes = [
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p
        ]
        self.lib.EVP_EncryptInit_ex.restype = ctypes.c_int

        self.lib.EVP_DecryptInit_ex.argtypes = [
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p
        ]
        self.lib.EVP_DecryptInit_ex.restype = ctypes.c_int

        self.lib.EVP_CIPHER_CTX_ctrl.argtypes = [
            ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_void_p
        ]
        self.lib.EVP_CIPHER_CTX_ctrl.restype = ctypes.c_int

        self.lib.EVP_EncryptUpdate.argtypes = [
            ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int
        ]
        self.lib.EVP_EncryptUpdate.restype = ctypes.c_int

        self.lib.EVP_DecryptUpdate.argtypes = [
            ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int
        ]
        self.lib.EVP_DecryptUpdate.restype = ctypes.c_int

        self.lib.EVP_EncryptFinal_ex.argtypes = [
            ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)
        ]
        self.lib.EVP_EncryptFinal_ex.restype = ctypes.c_int

        self.lib.EVP_DecryptFinal_ex.argtypes = [
            ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)
        ]
        self.lib.EVP_DecryptFinal_ex.restype = ctypes.c_int

    def encrypt(self, key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> bytes:
        if len(key) != 32:
            raise ValueError("AES-256-GCM requires a 32-byte key")
        ctx = self.lib.EVP_CIPHER_CTX_new()
        if not ctx:
            raise RuntimeError("EVP_CIPHER_CTX_new failed")
        try:
            cipher = self.lib.EVP_aes_256_gcm()
            if self.lib.EVP_EncryptInit_ex(ctx, cipher, None, None, None) != 1:
                raise RuntimeError("EVP_EncryptInit_ex failed")
            if self.lib.EVP_CIPHER_CTX_ctrl(ctx, self.EVP_CTRL_GCM_SET_IVLEN, len(nonce), None) != 1:
                raise RuntimeError("SET_IVLEN failed")
            if self.lib.EVP_EncryptInit_ex(ctx, None, None, key, nonce) != 1:
                raise RuntimeError("EVP_EncryptInit_ex key/nonce failed")

            out_len = ctypes.c_int(0)
            if aad:
                if self.lib.EVP_EncryptUpdate(ctx, None, ctypes.byref(out_len), aad, len(aad)) != 1:
                    raise RuntimeError("EVP_EncryptUpdate AAD failed")

            ct_buf = ctypes.create_string_buffer(len(plaintext) + 16)
            total_len = 0
            if plaintext:
                if self.lib.EVP_EncryptUpdate(ctx, ct_buf, ctypes.byref(out_len), plaintext, len(plaintext)) != 1:
                    raise RuntimeError("EVP_EncryptUpdate plaintext failed")
                total_len = out_len.value

            final_len = ctypes.c_int(0)
            final_buf = ctypes.create_string_buffer(16)
            if self.lib.EVP_EncryptFinal_ex(ctx, final_buf, ctypes.byref(final_len)) != 1:
                raise RuntimeError("EVP_EncryptFinal_ex failed")

            tag_buf = ctypes.create_string_buffer(16)
            if self.lib.EVP_CIPHER_CTX_ctrl(ctx, self.EVP_CTRL_GCM_GET_TAG, 16, tag_buf) != 1:
                raise RuntimeError("GET_TAG failed")

            return ct_buf.raw[:total_len] + tag_buf.raw[:16]
        finally:
            self.lib.EVP_CIPHER_CTX_free(ctx)

    def decrypt(self, key: bytes, nonce: bytes, ct_and_tag: bytes, aad: bytes) -> bytes:
        if len(key) != 32:
            raise ValueError("AES-256-GCM requires a 32-byte key")
        if len(ct_and_tag) < 16:
            raise ValueError("Ciphertext shorter than 16-byte GCM tag")
        ciphertext = ct_and_tag[:-16]
        tag = ct_and_tag[-16:]

        ctx = self.lib.EVP_CIPHER_CTX_new()
        if not ctx:
            raise RuntimeError("EVP_CIPHER_CTX_new failed")
        try:
            cipher = self.lib.EVP_aes_256_gcm()
            if self.lib.EVP_DecryptInit_ex(ctx, cipher, None, None, None) != 1:
                raise RuntimeError("EVP_DecryptInit_ex failed")
            if self.lib.EVP_CIPHER_CTX_ctrl(ctx, self.EVP_CTRL_GCM_SET_IVLEN, len(nonce), None) != 1:
                raise RuntimeError("SET_IVLEN failed")
            if self.lib.EVP_DecryptInit_ex(ctx, None, None, key, nonce) != 1:
                raise RuntimeError("EVP_DecryptInit_ex key/nonce failed")

            out_len = ctypes.c_int(0)
            if aad:
                if self.lib.EVP_DecryptUpdate(ctx, None, ctypes.byref(out_len), aad, len(aad)) != 1:
                    raise RuntimeError("EVP_DecryptUpdate AAD failed")

            pt_buf = ctypes.create_string_buffer(len(ciphertext) + 16)
            total_len = 0
            if ciphertext:
                if self.lib.EVP_DecryptUpdate(ctx, pt_buf, ctypes.byref(out_len), ciphertext, len(ciphertext)) != 1:
                    raise RuntimeError("EVP_DecryptUpdate ciphertext failed")
                total_len = out_len.value

            tag_buf = ctypes.create_string_buffer(tag, 16)
            if self.lib.EVP_CIPHER_CTX_ctrl(ctx, self.EVP_CTRL_GCM_SET_TAG, 16, tag_buf) != 1:
                raise RuntimeError("SET_TAG failed")

            final_len = ctypes.c_int(0)
            final_buf = ctypes.create_string_buffer(16)
            rc = self.lib.EVP_DecryptFinal_ex(ctx, final_buf, ctypes.byref(final_len))
            if rc != 1:
                raise ValueError("AES-256-GCM authentication tag verification failed (AUTH_TAG_MISMATCH)")

            return pt_buf.raw[:total_len]
        finally:
            self.lib.EVP_CIPHER_CTX_free(ctx)


_OPENSSL_GCM = None if HAS_PYCA_CRYPTOGRAPHY else _OpenSslAesGcm()


def aes_256_gcm_encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> bytes:
    """Returns nonce (12B) || ciphertext || tag (16B)."""
    if HAS_PYCA_CRYPTOGRAPHY:
        return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)
    assert _OPENSSL_GCM is not None
    return nonce + _OPENSSL_GCM.encrypt(key, nonce, plaintext, aad)


def aes_256_gcm_decrypt_combined(key: bytes, combined: bytes, aad: bytes) -> bytes:
    """Splits combined into nonce (12B) || ct_and_tag and decrypts with AES-256-GCM."""
    if len(combined) < 28:
        raise ValueError(f"Combined GCM payload too short: {len(combined)} bytes")
    nonce = combined[:12]
    ct_and_tag = combined[12:]
    if HAS_PYCA_CRYPTOGRAPHY:
        return AESGCM(key).decrypt(nonce, ct_and_tag, aad)
    assert _OPENSSL_GCM is not None
    return _OPENSSL_GCM.decrypt(key, nonce, ct_and_tag, aad)


def aes_256_gcm_decrypt_explicit_nonce(key: bytes, nonce: bytes, ct_and_tag: bytes, aad: bytes) -> bytes:
    if HAS_PYCA_CRYPTOGRAPHY:
        return AESGCM(key).decrypt(nonce, ct_and_tag, aad)
    assert _OPENSSL_GCM is not None
    return _OPENSSL_GCM.decrypt(key, nonce, ct_and_tag, aad)


# ---------------------------------------------------------------------------
# HKDF-SHA256 (RFC 5869) & Argon2id (RFC 9106 via argon2-cffi or libsodium.so.23)
# ---------------------------------------------------------------------------

def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
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


def argon2id_derive(
    password: bytes,
    salt: bytes,
    memory_kib: int,
    iterations: int,
    parallelism: int,
    tag_len: int = 32,
) -> bytes:
    try:
        from argon2.low_level import Type, hash_secret_raw

        return hash_secret_raw(
            secret=password,
            salt=salt,
            time_cost=iterations,
            memory_cost=memory_kib,
            parallelism=parallelism,
            hash_len=tag_len,
            type=Type.ID,
            version=19,
        )
    except ImportError:
        pass

    if parallelism == 1 and len(salt) == 16:
        sodium_name = ctypes.util.find_library("sodium") or "libsodium.so.23"
        sodium = ctypes.CDLL(sodium_name)
        sodium.sodium_init()
        sodium.crypto_pwhash.argtypes = [
            ctypes.c_char_p,
            ctypes.c_ulonglong,
            ctypes.c_char_p,
            ctypes.c_ulonglong,
            ctypes.c_char_p,
            ctypes.c_ulonglong,
            ctypes.c_size_t,
            ctypes.c_int,
        ]
        sodium.crypto_pwhash.restype = ctypes.c_int
        out = ctypes.create_string_buffer(tag_len)
        ALG_ARGON2ID13 = 2
        rc = sodium.crypto_pwhash(
            out,
            tag_len,
            password,
            len(password),
            salt,
            iterations,
            memory_kib * 1024,
            ALG_ARGON2ID13,
        )
        if rc != 0:
            raise RuntimeError(f"libsodium crypto_pwhash failed with code {rc}")
        return out.raw[:tag_len]

    raise RuntimeError("Requires argon2-cffi or libsodium for Argon2id")


def b64u_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64u_decode(text: str) -> bytes:
    pad = "=" * ((4 - (len(text) % 4)) % 4)
    return base64.urlsafe_b64decode((text + pad).encode("ascii"))


# ---------------------------------------------------------------------------
# Spec §4.1 & §4.2 PCZK v1 Parser & Decrypter
# ---------------------------------------------------------------------------

def decrypt_pczk_blob(pczk_bytes: bytes, fk_wrap_key: bytes, expected_blob_id: str) -> Tuple[bytes, bytes, Dict[str, Any]]:
    if len(pczk_bytes) < 102:
        raise ValueError(f"PCZK blob shorter than 102 bytes: {len(pczk_bytes)}")
    header = pczk_bytes[:86]
    magic = header[0:4]
    if magic != b"PCZK":
        raise ValueError(f"Invalid PCZK magic: {magic!r}")
    version = header[4]
    if version != 1:
        raise ValueError(f"Unsupported PCZK version: {version}")
    chunk_size_log2 = header[5]
    if not (16 <= chunk_size_log2 <= 24):
        raise ValueError(f"Invalid chunkSizeLog2: {chunk_size_log2}")
    chunk_plain_size = 1 << chunk_size_log2
    chunk_enc_size = chunk_plain_size + 16

    blob_id_bytes = header[6:22]
    parsed_blob_id = str(uuid.UUID(bytes=blob_id_bytes))
    if parsed_blob_id != expected_blob_id.lower():
        raise ValueError(f"Header blobId {parsed_blob_id} != expected {expected_blob_id}")

    nonce_prefix = header[22:26]
    wrapped_fk = header[26:86]
    file_key = aes_256_gcm_decrypt_combined(fk_wrap_key, wrapped_fk, blob_id_bytes)
    if len(file_key) != 32:
        raise ValueError(f"Unwrapped FK length != 32: {len(file_key)}")

    header_sha256 = hashlib.sha256(header).digest()
    chunks_payload = pczk_bytes[86:]

    if len(chunks_payload) == 16:
        total_chunks = 1
    else:
        total_chunks = math.ceil(len(chunks_payload) / chunk_enc_size)

    plaintext_parts = bytearray()
    offset = 0
    for idx in range(total_chunks):
        is_last = 1 if idx == total_chunks - 1 else 0
        end_offset = len(chunks_payload) if is_last else (offset + chunk_enc_size)
        chunk_ct = chunks_payload[offset:end_offset]
        offset = end_offset

        nonce = nonce_prefix + struct.pack(">Q", idx)
        aad = header_sha256 + bytes([is_last])
        chunk_pt = aes_256_gcm_decrypt_explicit_nonce(file_key, nonce, chunk_ct, aad)
        plaintext_parts.extend(chunk_pt)

    return bytes(plaintext_parts), file_key, {
        "chunkSizeLog2": chunk_size_log2,
        "blobId": parsed_blob_id,
        "totalChunks": total_chunks,
    }


def encrypt_pczk_blob(
    plaintext: bytes,
    fk_wrap_key: bytes,
    blob_id: str,
    file_key: bytes,
    nonce_prefix: bytes,
    wrap_iv: bytes,
    chunk_size_log2: int = 20,
) -> bytes:
    blob_id_bytes = uuid.UUID(blob_id).bytes
    wrapped_fk = aes_256_gcm_encrypt(fk_wrap_key, wrap_iv, file_key, blob_id_bytes)
    header = b"PCZK" + bytes([1, chunk_size_log2]) + blob_id_bytes + nonce_prefix + wrapped_fk
    assert len(header) == 86
    header_sha256 = hashlib.sha256(header).digest()

    chunk_size = 1 << chunk_size_log2
    total_chunks = 1 if len(plaintext) == 0 else math.ceil(len(plaintext) / chunk_size)
    out = bytearray(header)
    for idx in range(total_chunks):
        is_last = 1 if idx == total_chunks - 1 else 0
        chunk_pt = plaintext[idx * chunk_size : (idx + 1) * chunk_size]
        nonce = nonce_prefix + struct.pack(">Q", idx)
        aad = header_sha256 + bytes([is_last])
        chunk_ct_with_nonce = aes_256_gcm_encrypt(file_key, nonce, chunk_pt, aad)
        out.extend(chunk_ct_with_nonce[12:])
    return bytes(out)


# ---------------------------------------------------------------------------
# Verification of `test-vectors/interop/manifest.json` (4A.2)
# ---------------------------------------------------------------------------

def verify_interop_directory(interop_dir: Path, label: str) -> None:
    manifest_path = interop_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"[{label}] Missing {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    user_id: str = manifest["userId"]
    blob_id: str = manifest["blobId"]
    passphrase: str = manifest["passphrase"]
    kdf_params: Dict[str, int] = manifest["kdfParams"]
    account_key = bytes.fromhex(manifest["accountKeyHex"])
    user_salt = bytes.fromhex(manifest["userSaltHex"])

    # 1. Floor check (>= 64 MiB, t >= 3, p >= 1, salt >= 16B)
    if kdf_params["memoryKiB"] < 65536 or kdf_params["iterations"] < 3 or kdf_params["parallelism"] < 1:
        raise AssertionError(f"[{label}] KDF params below 4.0 floor: {kdf_params}")
    if len(user_salt) < 16:
        raise AssertionError(f"[{label}] userSalt shorter than 16 bytes")

    # 2. Argon2id + HKDF root, kek, authSecret
    norm_pass = unicodedata.normalize("NFC", passphrase).encode("utf-8")
    pass_part = argon2id_derive(
        norm_pass,
        user_salt,
        kdf_params["memoryKiB"],
        kdf_params["iterations"],
        kdf_params["parallelism"],
        32,
    )
    ikm = pass_part + account_key
    root = hkdf_sha256(ikm, user_salt, b"photocloud/v2/root", 32)
    kek = hkdf_sha256(root, b"", b"photocloud/v2/kek", 32)
    auth_secret = hkdf_sha256(root, b"", b"photocloud/v2/auth", 32)

    assert root.hex() == manifest["rootHex"], f"[{label}] root mismatch"
    assert kek.hex() == manifest["kekHex"], f"[{label}] kek mismatch"
    assert auth_secret.hex() == manifest["authSecretHex"], f"[{label}] authSecret mismatch"

    # 3. Unwrap wrappedVk.bin
    wrapped_vk_bytes = (interop_dir / manifest["files"]["wrappedVk"]).read_bytes()
    vault_key = aes_256_gcm_decrypt_combined(kek, wrapped_vk_bytes, f"vk|{user_id}".encode("utf-8"))
    assert vault_key.hex() == manifest["vaultKeyHex"], f"[{label}] unwrapped VK mismatch"

    # 4. Subkeys
    meta_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/metaKey", 32)
    thumb_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/thumbKey", 32)
    dedup_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/dedupKey", 32)
    fk_wrap_key = hkdf_sha256(vault_key, b"", b"photocloud/v2/fkWrapKey", 32)
    _ = thumb_key

    # 5. Decrypt blob.pczk
    pczk_bytes = (interop_dir / manifest["files"]["blob"]).read_bytes()
    ct_sha256 = hashlib.sha256(pczk_bytes).hexdigest()
    assert ct_sha256 == manifest["ciphertextSha256Hex"], f"[{label}] blob ciphertext SHA-256 mismatch"

    plaintext, _fk, header_info = decrypt_pczk_blob(pczk_bytes, fk_wrap_key, blob_id)
    assert plaintext.decode("utf-8") == manifest["plaintextUtf8"], f"[{label}] decrypted plaintext mismatch"
    if "plaintextSha256Hex" in manifest:
        assert hashlib.sha256(plaintext).hexdigest() == manifest["plaintextSha256Hex"], (
            f"[{label}] plaintext SHA-256 mismatch"
        )
    if manifest.get("dedupTagHex"):
        dedup_tag = hmac.new(dedup_key, plaintext, hashlib.sha256).hexdigest()
        assert dedup_tag == manifest["dedupTagHex"], f"[{label}] dedupTag mismatch"

    # 6. Decrypt encMeta.bin
    enc_meta_bytes = (interop_dir / manifest["files"]["encMeta"]).read_bytes()
    blob_id_bytes = uuid.UUID(blob_id).bytes
    blob_meta_key = hkdf_sha256(meta_key, blob_id_bytes, b"photocloud/v2/blob-meta", 32)
    meta_pt = aes_256_gcm_decrypt_combined(
        blob_meta_key, enc_meta_bytes, f"meta|{blob_id}".encode("utf-8")
    )
    meta_json = json.loads(meta_pt.decode("utf-8"))
    assert meta_json["size"] == len(plaintext), f"[{label}] encMeta.size mismatch"
    if "expectedMetaName" in manifest:
        assert meta_json["name"] == manifest["expectedMetaName"], f"[{label}] encMeta.name mismatch"

    # 7. Decrypt shareManifest.bin (if present in manifest)
    if "shareManifest" in manifest.get("files", {}):
        share_id: str = manifest["shareId"]
        share_key = bytes.fromhex(manifest["shareKeyHex"])
        share_meta_key = hkdf_sha256(share_key, b"", b"photocloud/v2/share/meta", 32)
        share_wrap_key = hkdf_sha256(share_key, b"", b"photocloud/v2/share/wrap", 32)
        share_manifest_bytes = (interop_dir / manifest["files"]["shareManifest"]).read_bytes()
        share_manifest_pt = aes_256_gcm_decrypt_combined(
            share_meta_key, share_manifest_bytes, f"share-manifest|{share_id}".encode("utf-8")
        )
        share_manifest_json = json.loads(share_manifest_pt.decode("utf-8"))
        assert share_manifest_json["shareId"] == share_id, f"[{label}] shareManifest.shareId mismatch"
        assert len(share_manifest_json["items"]) >= 1, f"[{label}] shareManifest.items empty"
        first_item = share_manifest_json["items"][0]
        wrapped_fk_share = b64u_decode(first_item["wrappedFk"])
        unwrapped_fk_share = aes_256_gcm_decrypt_combined(
            share_wrap_key,
            wrapped_fk_share,
            f"share-fk|{share_id}|{first_item['blobId']}".encode("utf-8"),
        )
        assert len(unwrapped_fk_share) == 32, f"[{label}] share unwrapped FK length != 32"

    # 8. Decrypt albums.bin (if present in manifest)
    if "albums" in manifest.get("files", {}):
        albums_bytes = (interop_dir / manifest["files"]["albums"]).read_bytes()
        revision = struct.unpack(">I", albums_bytes[:4])[0]
        album_catalog_key = hkdf_sha256(
            meta_key, user_id.encode("utf-8"), b"photocloud/v2/albums", 32
        )
        albums_pt = aes_256_gcm_decrypt_combined(
            album_catalog_key,
            albums_bytes[4:],
            f"albums|{user_id}|{revision}".encode("utf-8"),
        )
        albums_json = json.loads(albums_pt.decode("utf-8"))
        assert albums_json["revision"] == revision, f"[{label}] albums revision mismatch"
        assert len(albums_json["albums"]) >= 1, f"[{label}] albums list empty"

    print(
        f"[OK] {label}: Verified Argon2id({kdf_params['memoryKiB']} KiB, t={kdf_params['iterations']}), "
        f"wrappedVk, blob.pczk ({header_info['totalChunks']} chunk(s), {len(plaintext)} B), "
        f"encMeta ({meta_json['name']})"
        + (", shareManifest" if "shareManifest" in manifest.get("files", {}) else "")
        + (", albumsCatalog" if "albums" in manifest.get("files", {}) else "")
    )


def main() -> int:
    import argparse
    import os

    parser = argparse.ArgumentParser(
        description="Independent PhotoCloud Zero-Knowledge Interoperability Verifier"
    )
    parser.add_argument(
        "--kotlin-dir",
        default=None,
        help="Path to Kotlin-generated interop fixtures (default: android-app/app/build/interop-kotlin)",
    )
    parser.add_argument(
        "--require-kotlin",
        action="store_true",
        help="Fail with non-zero exit code if Kotlin -> Web artifacts are missing (used in CI).",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    interop_web_dir = repo_root / "test-vectors" / "interop"
    kotlin_dir_str = args.kotlin_dir or os.environ.get("INTEROP_KOTLIN_DIR")
    interop_kt_dir = (
        Path(kotlin_dir_str)
        if kotlin_dir_str
        else repo_root / "android-app" / "app" / "build" / "interop-kotlin"
    )
    require_kotlin = args.require_kotlin or os.environ.get("REQUIRE_KOTLIN_ARTIFACTS") == "1"

    verify_interop_directory(interop_web_dir, "test-vectors/interop (Web -> Android/Python)")

    kt_manifest = interop_kt_dir / "manifest.json"
    if not kt_manifest.exists():
        msg = (
            f"[PENDING] Kotlin -> Web/Python interop: PENDING "
            f"(nessuna fixture reale trovata in {interop_kt_dir}; eseguire 'cd android-app && gradle testDebugUnitTest')."
        )
        if require_kotlin:
            print(f"[FAIL] {msg}", file=sys.stderr)
            return 2
        print(msg)
        return 0

    verify_interop_directory(interop_kt_dir, "interop-kotlin (Kotlin -> Web/Python)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

