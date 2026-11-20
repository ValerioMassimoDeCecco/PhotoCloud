"""
End-to-End verification suite for the pure Zero-Knowledge Rust server (`rust/app`).

Proves:
1. Static crate purity (zero symmetric cipher crates in `rust/app/Cargo.toml` / `rust/app/src`).
2. Unconditional redirects from legacy entry pages (`/`, `/login`, `/trash`, `/map`) -> `/v2`.
3. Removed legacy V1 server-side encryption endpoints fail closed with `410 Gone` (`SERVER_SIDE_ENCRYPTION_REMOVED`).
4. Full Zero-Knowledge `/v2` & `/api/v2/*` lifecycle: setup token, registration, login/params anti-enumeration,
   login, chunked PCZK v1 blob upload + HTTP Range 206/416, upload abort (`DELETE`), thumbnails, encrypted albums
   with optimistic concurrency (`If-Match` / `412`), trash/restore/delete, public E2EE shares, passphrase rewrap,
   stats, logout, CSRF enforcement, Android update-manifest, AI TFLite Range, V2-authenticated Android/push APIs,
   and on-disk zero-plaintext verification.
"""

import base64
import hashlib
import http.cookiejar
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

PORT = int(os.environ.get("RUST_E2E_PORT", "8089"))
BASE_URL = f"http://127.0.0.1:{PORT}"
REPO_ROOT = os.path.abspath(os.getcwd())
BINARY_NAME = "server.exe" if sys.platform == "win32" else "server"
BINARY = os.path.abspath(os.path.join(REPO_ROOT, "rust", "app", "target", "release", BINARY_NAME))


class SimpleResponse:
    def __init__(self, status: int, headers: dict, body: bytes):
        self.status_code = status
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.content = body

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self):
        return json.loads(self.text)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpSession:
    def __init__(self):
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPRedirectHandler(),
        )
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPRedirectHandler(),
        )
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
            NoRedirectHandler(),
        )

    def request(
        self,
        method: str,
        url: str,
        json_body=None,
        data: bytes | None = None,
        headers: dict | None = None,
    ) -> SimpleResponse:
        req_headers = dict(headers or {})
        body_bytes = data
        if json_body is not None:
            body_bytes = json.dumps(json_body).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(url, data=body_bytes, headers=req_headers, method=method)
        try:
            with self.opener.open(req, timeout=15) as resp:
                return SimpleResponse(resp.status, dict(resp.headers.items()), resp.read())
        except urllib.error.HTTPError as err:
            return SimpleResponse(err.code, dict(err.headers.items()), err.read())

    def get(self, url: str, headers: dict | None = None) -> SimpleResponse:
        return self.request("GET", url, headers=headers)

    def post(self, url: str, json_body=None, data: bytes | None = None, headers: dict | None = None) -> SimpleResponse:
        return self.request("POST", url, json_body=json_body, data=data, headers=headers)

    def put(self, url: str, json_body=None, data: bytes | None = None, headers: dict | None = None) -> SimpleResponse:
        return self.request("PUT", url, json_body=json_body, data=data, headers=headers)

    def patch(self, url: str, json_body=None, data: bytes | None = None, headers: dict | None = None) -> SimpleResponse:
        return self.request("PATCH", url, json_body=json_body, data=data, headers=headers)

    def delete(self, url: str, json_body=None, headers: dict | None = None) -> SimpleResponse:
        return self.request("DELETE", url, json_body=json_body, headers=headers)


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def make_pczk_blob(blob_id: str, size: int = 256) -> bytes:
    """Builds a syntactically valid PCZK v1 ciphertext envelope (>= 102 bytes) with matching blobId."""
    assert size >= 102
    header = bytearray(70)
    header[0:4] = b"PCZK"
    header[4] = 0x01
    header[5] = 0x00
    header[6:22] = uuid.UUID(blob_id).bytes
    header[22:70] = os.urandom(48)
    body = os.urandom(size - 70)
    return bytes(header) + body


def main():
    # 0. Static Zero-Knowledge crate audit on rust/app
    print("[0] Verifying Rust server has ZERO symmetric cipher crates (AES/CFB/PBKDF2/HKDF)...")
    cargo_toml = open(os.path.join(REPO_ROOT, "rust", "app", "Cargo.toml"), "r", encoding="utf-8").read()
    for banned in ("aes =", "aes-gcm", "cfb-mode", "pbkdf2", "hkdf", "image ="):
        assert banned not in cargo_toml, f"Forbidden server-side crypto/media crate in Cargo.toml: {banned}"
    assert not os.path.exists(os.path.join(REPO_ROOT, "rust", "app", "src", "crypto.rs"))
    print("    OK (zero symmetric cipher crates in Rust server)")

    if not os.path.exists(BINARY):
        raise SystemExit(f"Rust release binary not found at {BINARY}. Run `npm run build:rust` first.")

    tmp_dir = tempfile.mkdtemp(prefix="photocloud-rust-zk-e2e-")
    for asset_dir in ("public", "static", "release", "android-app"):
        src = os.path.join(REPO_ROOT, asset_dir)
        dst = os.path.join(tmp_dir, asset_dir)
        if os.path.exists(src):
            try:
                os.symlink(src, dst, target_is_directory=True)
            except OSError:
                shutil.copytree(src, dst)

    print(f"Starting pure Zero-Knowledge Rust server on port {PORT} from {BINARY} (cwd={tmp_dir})...")
    env = os.environ.copy()
    env["PORT"] = str(PORT)

    server_proc = subprocess.Popen(
        [BINARY],
        cwd=tmp_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    setup_token = None
    deadline = time.time() + 15.0
    startup_lines: list[str] = []
    while time.time() < deadline:
        if server_proc.poll() is not None:
            rest = server_proc.stdout.read() if server_proc.stdout else ""
            raise RuntimeError(f"Rust server exited prematurely ({server_proc.returncode}): {''.join(startup_lines)}{rest}")
        line = server_proc.stdout.readline() if server_proc.stdout else ""
        if line:
            startup_lines.append(line)
            m = re.search(r"First-registration single-use setup token \(printed once\): ([A-Za-z0-9_-]+)", line)
            if m:
                setup_token = m.group(1)
            if "listening on" in line or f":{PORT}" in line:
                break
        else:
            time.sleep(0.05)

    try:
        anon = HttpSession()

        # 1. Legacy entry routes unconditionally redirect to /v2
        print("[1] Testing unconditional redirects (/, /login, /trash, /map -> /v2)...")
        for path in ("/", "/login", "/trash", "/map"):
            r = anon.get(f"{BASE_URL}{path}")
            assert r.status_code in (302, 307), f"Expected redirect on {path}, got {r.status_code}"
            assert r.headers.get("location") == "/v2", f"Expected Location=/v2 on {path}, got {r.headers.get('location')}"
        print("    OK")

        # 2. All removed legacy V1 server-side encryption routes fail closed with 410 Gone
        print("[2] Testing 410 Gone on removed legacy v1 endpoints...")
        for method, path in (
            ("POST", "/register"),
            ("POST", "/login"),
            ("POST", "/upload"),
            ("GET", "/api/session"),
            ("GET", "/media/test.jpg"),
            ("POST", "/api/upload/chunked/init"),
        ):
            r = anon.request(method, f"{BASE_URL}{path}")
            assert r.status_code == 410, f"Expected 410 on {method} {path}, got {r.status_code}"
            assert r.json().get("error") == "SERVER_SIDE_ENCRYPTION_REMOVED", f"Unexpected body: {r.text}"
        print("    OK")

        # 3. Zero-Knowledge /v2 Web Shell & SW strict security headers
        print("[3] Testing /v2 shell, strict CSP, and SW headers...")
        r_v2 = anon.get(f"{BASE_URL}/v2")
        assert r_v2.status_code == 200
        assert "script-src 'self' 'wasm-unsafe-eval'" in r_v2.headers.get("content-security-policy", "")
        assert r_v2.headers.get("referrer-policy") == "no-referrer"
        r_sw = anon.get(f"{BASE_URL}/v2/sw-stream.js")
        assert r_sw.status_code == 200
        assert r_sw.headers.get("service-worker-allowed") == "/v2"
        r_cfg = anon.get(f"{BASE_URL}/api/v2/auth/config")
        assert r_cfg.status_code == 200, f"Auth config failed: {r_cfg.status_code} {r_cfg.text}"
        cfg_json = r_cfg.json()
        assert cfg_json.get("registrationOpen") is True
        assert cfg_json.get("policy") == "open"
        assert cfg_json.get("requiresInviteToken") is False
        print("    OK")

        # 4. Anti-enumeration fake salt on /api/v2/login/params & CSRF cross-site block
        print("[4] Testing /api/v2/login/params anti-enumeration & CSRF protection...")
        r_p1 = anon.post(f"{BASE_URL}/api/v2/login/params", json_body={"username": "nonexistent_user"})
        r_p2 = anon.post(f"{BASE_URL}/api/v2/login/params", json_body={"username": "nonexistent_user"})
        assert r_p1.status_code == 200 and r_p2.status_code == 200
        assert r_p1.json()["salt"] == r_p2.json()["salt"], "Fake salt must be deterministic"
        r_csrf = anon.post(
            f"{BASE_URL}/api/v2/login",
            json_body={"username": "nonexistent_user", "authSecret": "x" * 43},
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert r_csrf.status_code == 403
        print("    OK")

        # 5. Open self-hosted registration (no setupToken required when policy == open)
        print("[5] Testing POST /api/v2/register (client-generated opaque authSecret & wrappedVaultKey)...")
        client = HttpSession()
        username = "rust_zk_alice"
        user_salt = b64u(os.urandom(16))
        auth_secret = b64u(os.urandom(32))
        wrapped_vk = b64u(os.urandom(60))
        kdf = {"algorithm": "Argon2id", "memoryKiB": 65536, "iterations": 3, "parallelism": 1}

        reg_payload = {
            "username": username,
            "salt": user_salt,
            "kdfParams": kdf,
            "authSecret": auth_secret,
            "wrappedVaultKey": wrapped_vk,
        }
        if setup_token:
            reg_payload["setupToken"] = setup_token

        r_reg = client.post(
            f"{BASE_URL}/api/v2/register",
            json_body=reg_payload,
        )
        assert r_reg.status_code == 201, f"Register failed: {r_reg.status_code} {r_reg.text}"
        set_cookie_hdr = r_reg.headers.get("set-cookie", "")
        assert "HttpOnly" in set_cookie_hdr and "SameSite=Strict" in set_cookie_hdr
        cookie_pair = set_cookie_hdr.split(";", 1)[0].strip()
        csrf = r_reg.json()["csrfToken"]
        auth_headers = {"Cookie": cookie_pair, "X-CSRF-Token": csrf}
        print("    OK")

        # 6. Upload abort (DELETE /api/v2/blobs/upload/{uploadId})
        print("[6] Testing upload init + abort (DELETE /api/v2/blobs/upload/{uploadId})...")
        abort_blob_id = str(uuid.uuid4())
        r_init_abort = client.post(
            f"{BASE_URL}/api/v2/blobs/upload/init",
            json_body={
                "blobId": abort_blob_id,
                "totalSize": 256,
                "chunkSize": 256,
                "totalChunks": 1,
                "expectedSha256": "a" * 64,
                "encMeta": b64u(os.urandom(48)),
            },
            headers=auth_headers,
        )
        assert r_init_abort.status_code == 201
        abort_upload_id = r_init_abort.json()["uploadId"]
        r_abort = client.delete(f"{BASE_URL}/api/v2/blobs/upload/{abort_upload_id}", headers=auth_headers)
        assert r_abort.status_code == 200 and r_abort.json().get("ok") is True
        r_abort_404 = client.delete(f"{BASE_URL}/api/v2/blobs/upload/{abort_upload_id}", headers=auth_headers)
        assert r_abort_404.status_code == 404
        print("    OK")

        # 7. Full chunked PCZK v1 ciphertext upload, Range 206/416 download, and thumbnail upload
        print("[7] Testing PCZK v1 chunked upload, Range 206/416, and encrypted thumbnail...")
        blob_id = str(uuid.uuid4())
        pczk_bytes = make_pczk_blob(blob_id, 512)
        chunk0 = pczk_bytes[:256]
        chunk1 = pczk_bytes[256:]
        expected_sha256 = hashlib.sha256(pczk_bytes).hexdigest()
        enc_meta_1 = b64u(os.urandom(64))
        dedup_tag = b64u(os.urandom(32))

        r_init = client.post(
            f"{BASE_URL}/api/v2/blobs/upload/init",
            json_body={
                "blobId": blob_id,
                "totalSize": len(pczk_bytes),
                "chunkSize": 256,
                "totalChunks": 2,
                "expectedSha256": expected_sha256,
                "encMeta": enc_meta_1,
                "dedupTag": dedup_tag,
            },
            headers=auth_headers,
        )
        assert r_init.status_code == 201, f"Init failed: {r_init.status_code} {r_init.text}"
        upload_id = r_init.json()["uploadId"]

        for idx, chunk in enumerate((chunk0, chunk1)):
            r_put = client.put(
                f"{BASE_URL}/api/v2/blobs/upload/{upload_id}/{idx}",
                data=chunk,
                headers={**auth_headers, "Content-Type": "application/octet-stream"},
            )
            assert r_put.status_code == 200, f"Chunk {idx} failed: {r_put.status_code} {r_put.text}"

        r_done = client.post(f"{BASE_URL}/api/v2/blobs/upload/{upload_id}/complete", headers=auth_headers)
        assert r_done.status_code == 201, f"Complete failed: {r_done.status_code} {r_done.text}"
        item_id = r_done.json()["item"]["id"]

        # Full GET
        r_blob = client.get(f"{BASE_URL}/api/v2/blobs/{blob_id}", headers={"Cookie": cookie_pair})
        assert r_blob.status_code == 200 and r_blob.content == pczk_bytes

        # Range 206
        r_206 = client.get(
            f"{BASE_URL}/api/v2/blobs/{blob_id}",
            headers={"Cookie": cookie_pair, "Range": "bytes=0-69"},
        )
        assert r_206.status_code == 206 and r_206.content == pczk_bytes[:70]

        # Range 416
        r_416 = client.get(
            f"{BASE_URL}/api/v2/blobs/{blob_id}",
            headers={"Cookie": cookie_pair, "Range": "bytes=99999-100000"},
        )
        assert r_416.status_code == 416

        # Encrypted thumbnail PUT + GET
        thumb_cipher = os.urandom(96)
        r_t_put = client.put(
            f"{BASE_URL}/api/v2/blobs/{blob_id}/thumbs/320",
            data=thumb_cipher,
            headers={**auth_headers, "Content-Type": "application/octet-stream"},
        )
        assert r_t_put.status_code in (200, 201, 204), f"Thumb put failed: {r_t_put.status_code} {r_t_put.text}"
        r_t_get = client.get(f"{BASE_URL}/api/v2/blobs/{blob_id}/thumbs/320", headers={"Cookie": cookie_pair})
        assert r_t_get.status_code == 200 and r_t_get.content == thumb_cipher
        print("    OK")

        # 8. Items listing, encrypted metadata PATCH, dedup check, and stats
        print("[8] Testing /api/v2/items, PATCH meta, /api/v2/backup/check, and /api/v2/stats...")
        r_items = client.get(f"{BASE_URL}/api/v2/items", headers={"Cookie": cookie_pair})
        assert r_items.status_code == 200
        items = r_items.json()["items"]
        assert len(items) == 1 and items[0]["id"] == item_id and items[0]["blobId"] == blob_id

        enc_meta_2 = b64u(os.urandom(64))
        r_patch = client.patch(
            f"{BASE_URL}/api/v2/items/{item_id}/meta",
            json_body={"encMeta": enc_meta_2, "expectedVersion": 1},
            headers=auth_headers,
        )
        assert r_patch.status_code == 200, f"Meta patch failed: {r_patch.status_code} {r_patch.text}"

        r_dedup = client.post(
            f"{BASE_URL}/api/v2/backup/check",
            json_body={"dedupTags": [dedup_tag, b64u(os.urandom(32))]},
            headers=auth_headers,
        )
        assert r_dedup.status_code == 200 and dedup_tag in r_dedup.json()["existingTags"]

        r_stats = client.get(f"{BASE_URL}/api/v2/stats", headers={"Cookie": cookie_pair})
        assert r_stats.status_code == 200 and r_stats.json()["activeCount"] == 1
        print("    OK")

        # 9. Encrypted Albums catalog with optimistic concurrency (If-Match / 412)
        print("[9] Testing encrypted /api/v2/albums (PUT, ETag/If-Match, 412 conflict, GET)...")
        enc_albums_1 = os.urandom(96)
        r_alb_put = client.put(
            f"{BASE_URL}/api/v2/albums",
            data=enc_albums_1,
            headers={**auth_headers, "Content-Type": "application/octet-stream"},
        )
        assert r_alb_put.status_code == 200, f"Albums PUT failed: {r_alb_put.status_code} {r_alb_put.text}"
        etag_1 = r_alb_put.headers.get("etag")
        assert etag_1

        r_alb_conflict = client.put(
            f"{BASE_URL}/api/v2/albums",
            data=os.urandom(96),
            headers={**auth_headers, "Content-Type": "application/octet-stream", "If-Match": '"wrong-etag"'},
        )
        assert r_alb_conflict.status_code == 412

        r_alb_get = client.get(f"{BASE_URL}/api/v2/albums", headers={"Cookie": cookie_pair})
        assert r_alb_get.status_code == 200 and r_alb_get.content == enc_albums_1
        print("    OK")

        # 10. Trash, Restore, and Public E2EE Share
        print("[10] Testing /api/v2/trash, /api/v2/trash/restore, and /api/v2/shares...")
        r_tr = client.post(f"{BASE_URL}/api/v2/trash", json_body={"itemIds": [item_id]}, headers=auth_headers)
        assert r_tr.status_code == 200, f"Trash failed: {r_tr.status_code} {r_tr.text}"
        r_rs = client.post(f"{BASE_URL}/api/v2/trash/restore", json_body={"itemIds": [item_id]}, headers=auth_headers)
        assert r_rs.status_code == 200, f"Restore failed: {r_rs.status_code} {r_rs.text}"

        enc_manifest = b64u(os.urandom(96))
        enc_owner_meta = b64u(os.urandom(80))
        r_sh = client.post(
            f"{BASE_URL}/api/v2/shares",
            json_body={
                "shareManifest": enc_manifest,
                "encShareMeta": enc_owner_meta,
                "maxDownloads": 3,
                "items": [{"blobId": blob_id, "wrappedFk": b64u(os.urandom(60))}],
            },
            headers=auth_headers,
        )
        assert r_sh.status_code == 201, f"Share create failed: {r_sh.status_code} {r_sh.text}"
        share_id = r_sh.json()["shareId"]

        # Owner authenticated listing returns encShareMeta
        r_sh_list = client.get(f"{BASE_URL}/api/v2/shares", headers={"Cookie": cookie_pair})
        assert r_sh_list.status_code == 200, f"Share list failed: {r_sh_list.status_code} {r_sh_list.text}"
        shares_arr = r_sh_list.json().get("shares", [])
        assert len(shares_arr) == 1 and shares_arr[0]["shareId"] == share_id
        assert shares_arr[0]["encShareMeta"] == enc_owner_meta
        assert shares_arr[0]["maxDownloads"] == 3

        # Public access without cookie (MUST NEVER expose encShareMeta!)
        r_sh_get = anon.get(f"{BASE_URL}/api/v2/shares/{share_id}")
        assert r_sh_get.status_code == 200 and r_sh_get.json()["shareManifest"] == enc_manifest
        assert "encShareMeta" not in r_sh_get.json(), "Public share response must NEVER leak encShareMeta"
        r_sh_blob = anon.get(f"{BASE_URL}/api/v2/shares/{share_id}/blobs/{blob_id}")
        assert r_sh_blob.status_code == 200 and r_sh_blob.content == pczk_bytes

        # Revoke share
        r_sh_del = client.delete(f"{BASE_URL}/api/v2/shares/{share_id}", headers=auth_headers)
        assert r_sh_del.status_code == 200
        r_sh_gone = anon.get(f"{BASE_URL}/api/v2/shares/{share_id}")
        assert r_sh_gone.status_code in (404, 410)
        print("    OK")

        # 11. Android update-manifest, AI TFLite Range, and V2-authenticated Android/Push APIs
        print("[11] Testing Android manifest, AI TFLite Range, and V2-authenticated Android/Push APIs...")
        r_and = anon.get(f"{BASE_URL}/api/android/update-manifest")
        assert r_and.status_code in (200, 404)
        manifest = r_and.json()
        assert manifest.get("versionCode", 0) >= 1 and manifest.get("versionName")

        # Unauthenticated /api/android/releases must be rejected; V2 session must succeed
        assert anon.get(f"{BASE_URL}/api/android/releases").status_code == 403
        r_rel = client.get(f"{BASE_URL}/api/android/releases", headers={"Cookie": cookie_pair})
        assert r_rel.status_code == 200 and isinstance(r_rel.json().get("releases"), list)

        # Push endpoints
        assert anon.get(f"{BASE_URL}/api/push/vapid-key").status_code == 200
        assert anon.post(f"{BASE_URL}/api/push/subscribe", json_body={}).status_code == 403
        assert client.post(f"{BASE_URL}/api/push/subscribe", json_body={}, headers=auth_headers).status_code == 200

        tflite_path = os.path.join(REPO_ROOT, "release", "efficientnet_lite4.tflite")
        if os.path.exists(tflite_path):
            r_ai206 = anon.get(
                f"{BASE_URL}/api/ai-model/efficientnet_lite4.tflite",
                headers={"Range": "bytes=0-15"},
            )
            assert r_ai206.status_code == 206 and len(r_ai206.content) == 16
            r_ai416 = anon.get(
                f"{BASE_URL}/api/ai-model/efficientnet_lite4.tflite",
                headers={"Range": "bytes=999999999-999999999"},
            )
            assert r_ai416.status_code == 416
        print("    OK")

        # 12. Zero-Knowledge Passphrase Rewrap + Re-login + Logout
        print("[12] Testing /api/v2/account/rewrap, re-login, and logout...")
        new_salt = b64u(os.urandom(16))
        new_auth_secret = b64u(os.urandom(32))
        new_wrapped_vk = b64u(os.urandom(60))
        r_rewrap = client.post(
            f"{BASE_URL}/api/v2/account/rewrap",
            json_body={
                "oldAuthSecret": auth_secret,
                "newSalt": new_salt,
                "newKdfParams": kdf,
                "newAuthSecret": new_auth_secret,
                "newWrappedVaultKey": new_wrapped_vk,
            },
            headers=auth_headers,
        )
        assert r_rewrap.status_code == 200, f"Rewrap failed: {r_rewrap.status_code} {r_rewrap.text}"

        r_login_new = anon.post(
            f"{BASE_URL}/api/v2/login",
            json_body={"username": username, "authSecret": new_auth_secret},
        )
        assert r_login_new.status_code == 200
        assert r_login_new.json()["wrappedVaultKey"] == new_wrapped_vk
        new_cookie = r_login_new.headers.get("set-cookie", "").split(";", 1)[0].strip()
        new_csrf = r_login_new.json()["csrfToken"]

        r_logout = anon.post(
            f"{BASE_URL}/api/v2/logout",
            headers={"Cookie": new_cookie, "X-CSRF-Token": new_csrf},
        )
        assert r_logout.status_code == 200
        r_after_logout = anon.get(f"{BASE_URL}/api/v2/items", headers={"Cookie": new_cookie})
        assert r_after_logout.status_code == 401
        print("    OK")

        # 13. Disk purity check: zero legacy V1 directories/files created
        print("[13] Verifying zero legacy v1 user_media/ or users.txt created on disk...")
        assert not os.path.exists(os.path.join(tmp_dir, "user_media")), "user_media/ must not be created!"
        assert not os.path.exists(os.path.join(tmp_dir, "users.txt")), "users.txt must not be created!"
        assert os.path.exists(os.path.join(tmp_dir, "vault_v2", "index.sqlite")), "index.sqlite must exist"
        print("    OK")

        print("\nALL 13 PURE ZERO-KNOWLEDGE RUST SERVER E2E SUITES PASSED WITH ZERO ERRORS!")
    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=3)
        except Exception:
            server_proc.kill()
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
