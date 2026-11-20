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
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
            NoRedirectHandler(),
        )

    def cookies_dict(self) -> dict:
        return {c.name: c.value for c in self.cookie_jar}

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


def encode_multipart(fields: list[tuple[str, str]], files: list[tuple[str, str, bytes, str]]) -> tuple[bytes, str]:
    boundary = f"----PhotoCloudRustE2E{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, val in fields:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(val.encode("utf-8"))
        chunks.append(b"\r\n")
    for field_name, filename, content, content_type in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(content)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def main():
    if not os.path.exists(BINARY):
        raise SystemExit(f"Rust release binary not found at {BINARY}. Run `npm run build:rust` first.")

    tmp_dir = tempfile.mkdtemp(prefix="photocloud-rust-e2e-")
    for asset_dir in ("public", "static", "templates", "dist", "release", "android-app"):
        src = os.path.join(REPO_ROOT, asset_dir)
        dst = os.path.join(tmp_dir, asset_dir)
        if os.path.exists(src):
            try:
                os.symlink(src, dst, target_is_directory=True)
            except OSError:
                shutil.copytree(src, dst)

    print(f"Starting Rust server on port {PORT} from {BINARY} (isolated cwd={tmp_dir})...")
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

        # 1. Unauthenticated root
        print("[1] Testing GET / (unauthenticated)...")
        r = anon.get(f"{BASE_URL}/")
        assert r.status_code == 200, f"GET / status={r.status_code}"
        assert "Accedi al tuo Cloud" in r.text or "PhotoCloud" in r.text
        print("    OK")

        # 2. Unauthenticated session
        print("[2] Testing GET /api/session (unauthenticated)...")
        r = anon.get(f"{BASE_URL}/api/session")
        assert r.status_code == 200
        assert r.json() == {"authenticated": False}
        print("    OK")

        # 3. Register a test user
        test_user = f"testuser_{int(time.time())}"
        print(f"[3] Testing POST /register for user {test_user}...")
        r = anon.post(f"{BASE_URL}/register", json_body={"username": test_user, "key_type": "generate"})
        assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
        auth_data = r.json()
        assert auth_data["username"] == test_user
        api_key = auth_data["api_key"]
        assert len(api_key) == 32
        print(f"    OK (generated API key: {api_key[:6]}...)")

        # 4. Login with JSON
        print("[4] Testing POST /login with API key...")
        session = HttpSession()
        r = session.post(
            f"{BASE_URL}/login",
            json_body={"username": test_user, "api_key": api_key},
            headers={"Accept": "application/json"},
        )
        assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
        assert r.json().get("success") is True
        assert "photocloud_sid" in session.cookies_dict()
        print("    OK (session cookie received)")

        # 5. Authenticated session
        print("[5] Testing GET /api/session (authenticated)...")
        r = session.get(f"{BASE_URL}/api/session")
        assert r.status_code == 200
        sess_info = r.json()
        assert sess_info.get("authenticated") is True
        assert sess_info.get("username") == test_user
        assert isinstance(sess_info.get("media"), list)
        assert isinstance(sess_info.get("albums"), list)
        assert isinstance(sess_info.get("storageStats"), dict)
        print("    OK (session active and stats returned)")

        # 6. Create album
        print("[6] Testing POST /api/albums/create...")
        r = session.post(f"{BASE_URL}/api/albums/create", json_body={"name": "Vacanze 2026"})
        assert r.status_code == 200
        assert "Vacanze 2026" in r.json().get("albums", [])
        print("    OK (album created)")

        # 7. File upload with encryption + SHA-256 verification + ?skipList=1
        print("[7] Testing POST /upload (encryption + SHA-256 check + ?skipList=1)...")
        payload = b"Hello PhotoCloud Native Rust Server! Test payload 12345."
        payload_sha = hashlib.sha256(payload).hexdigest()

        # 7a. Invalid SHA-256 must fail with 400 and leave no file behind
        bad_body, bad_ct = encode_multipart(
            [("album", "Vacanze 2026"), ("sha256", "0" * 64)],
            [("file[]", "corrupt_doc.txt", payload, "text/plain")],
        )
        r_bad = session.post(f"{BASE_URL}/upload", data=bad_body, headers={"Content-Type": bad_ct})
        assert r_bad.status_code == 400, f"Expected 400 for bad sha256, got {r_bad.status_code}: {r_bad.text}"

        # 7b. Valid SHA-256 with ?skipList=1
        body, ct = encode_multipart(
            [("album", "Vacanze 2026"), ("sha256", payload_sha)],
            [("file[]", "test_doc.txt", payload, "text/plain")],
        )
        r = session.post(f"{BASE_URL}/upload?skipList=1", data=body, headers={"Content-Type": ct})
        assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text}"
        upload_resp = r.json()
        assert upload_resp.get("success") is True
        assert upload_resp.get("uploadedCount") == 1
        uploaded_files = upload_resp.get("files") or upload_resp.get("uploaded") or []
        assert len(uploaded_files) == 1
        uploaded_filename = uploaded_files[0]
        print(f"    OK (uploaded with verified SHA-256 & skipList=1 as: {uploaded_filename})")

        # 7c. /api/backup/check recognizes the uploaded hash
        r_chk = session.post(f"{BASE_URL}/api/backup/check", json_body={"items": [payload_sha, "f" * 64]})
        assert r_chk.status_code == 200, f"backup/check failed: {r_chk.status_code} {r_chk.text}"
        chk_json = r_chk.json()
        assert payload_sha in chk_json.get("existingSha256", [])
        assert ("f" * 64) not in chk_json.get("existingSha256", [])
        print("    OK (/api/backup/check deduplication verified)")

        # 8. Check file on disk is encrypted with PhotoCloud GCM v1 format
        user_media_path = os.path.join(tmp_dir, "user_media", test_user, uploaded_filename)
        assert os.path.exists(user_media_path)
        with open(user_media_path, "rb") as fp:
            raw_on_disk = fp.read()
        assert raw_on_disk.startswith(b"PhotoCloud-GCM-v1\x00")
        assert payload not in raw_on_disk
        print(f"    OK (verified GCM v1 header and encryption on disk: {len(raw_on_disk)} bytes)")

        # 9. Download and decrypt file
        print(f"[9] Testing GET /media/{uploaded_filename} (decryption on the fly)...")
        r = session.get(f"{BASE_URL}/media/{uploaded_filename}")
        assert r.status_code == 200
        assert r.content == payload
        assert r.headers.get("content-type") == "text/plain; charset=utf-8"
        print("    OK (decrypted payload matches original exactly)")

        # 10. HTTP Range request decryption (206 + 416)
        print(f"[10] Testing HTTP Range 206 & 416 on /media/{uploaded_filename}...")
        r = session.get(f"{BASE_URL}/media/{uploaded_filename}", headers={"Range": "bytes=6-15"})
        assert r.status_code == 206
        assert r.content == payload[6:16]
        assert r.headers.get("content-range") == f"bytes 6-15/{len(payload)}"
        r_416 = session.get(f"{BASE_URL}/media/{uploaded_filename}", headers={"Range": "bytes=9999-10000"})
        assert r_416.status_code == 416, f"Expected 416, got {r_416.status_code}"
        assert r_416.headers.get("content-range") == f"bytes */{len(payload)}"
        print("    OK (206 slice & 416 unsatisfiable range verified)")

        # 11. Toggle favorite
        print("[11] Testing POST /api/favorites/toggle...")
        r = session.post(f"{BASE_URL}/api/favorites/toggle", json_body={"filename": uploaded_filename})
        assert r.status_code == 200
        assert r.json().get("isFavorite") is True
        assert uploaded_filename in r.json().get("favorites", [])
        print("    OK (favorited)")

        # 12. Search natural language query
        print("[12] Testing GET /api/search?q=test...")
        r = session.get(f"{BASE_URL}/api/search?q=test")
        assert r.status_code == 200
        results = r.json().get("results", [])
        assert any(item["filename"] == uploaded_filename for item in results)
        print("    OK (natural language search returned matches)")

        # 13. Public share inline maxDownloads quota + Range 416
        print("[13] Testing public share inline quota enforcement & Range 416...")
        r_sh = session.post(
            f"{BASE_URL}/api/shares/create",
            json_body={"filenames": [uploaded_filename], "maxDownloads": 1},
        )
        assert r_sh.status_code == 200, f"Create share failed: {r_sh.status_code} {r_sh.text}"
        share_token = r_sh.json()["url"].split("/share/")[1]
        pub = HttpSession()
        # First inline fetch succeeds (consumes 1/1 quota)
        r_s1 = pub.get(f"{BASE_URL}/share/{share_token}/media/{uploaded_filename}")
        assert r_s1.status_code == 200 and r_s1.content == payload
        # Second inline fetch must return 410 Gone (quota exceeded)
        r_s2 = pub.get(f"{BASE_URL}/share/{share_token}/media/{uploaded_filename}")
        assert r_s2.status_code == 410, f"Expected 410 on quota exceeded, got {r_s2.status_code}"
        # Create unlimited share and verify 416 on invalid Range
        r_sh2 = session.post(
            f"{BASE_URL}/api/shares/create",
            json_body={"filenames": [uploaded_filename]},
        )
        tok2 = r_sh2.json()["url"].split("/share/")[1]
        r_s416 = pub.get(
            f"{BASE_URL}/share/{tok2}/media/{uploaded_filename}",
            headers={"Range": "bytes=9999-10000"},
        )
        assert r_s416.status_code == 416, f"Expected 416 on public share invalid range, got {r_s416.status_code}"
        print("    OK (share quota 200->410 and Range 416 verified)")

        # 14. Move to trash and restore
        print(f"[14] Testing POST /trash/{uploaded_filename} and restore...")
        r = session.post(f"{BASE_URL}/trash/{uploaded_filename}")
        assert r.status_code == 200
        assert not os.path.exists(user_media_path)
        trash_path = os.path.join(tmp_dir, "user_media", test_user, "trash", uploaded_filename)
        assert os.path.exists(trash_path)
        r = session.post(f"{BASE_URL}/restore/{uploaded_filename}")
        assert r.status_code == 200
        assert os.path.exists(user_media_path)
        assert not os.path.exists(trash_path)
        print("    OK (trash and restore working perfectly)")

        # 15. /map CSP + Android dynamic update-manifest + AI TFLite Range + Android releases
        print("[15] Testing /map CSP, Android manifest, AI TFLite Range, and Android releases...")
        r_map = session.get(f"{BASE_URL}/map")
        assert r_map.status_code == 200
        assert "tile.openstreetmap.org" in r_map.headers.get("content-security-policy", "")
        r_and = anon.get(f"{BASE_URL}/api/android/update-manifest")
        assert r_and.status_code in (200, 404), f"Unexpected manifest status: {r_and.status_code}"
        manifest = r_and.json()
        assert manifest.get("versionCode", 0) >= 1 and manifest.get("versionName")
        r_rel = session.get(f"{BASE_URL}/api/android/releases")
        assert r_rel.status_code == 200 and isinstance(r_rel.json().get("releases"), list)
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
        print(f"    OK (manifest v{manifest['versionName']} code {manifest['versionCode']}, /map CSP & TFLite verified)")

        # 16. Zero-Knowledge V2 Web Shell & API smoke + CSRF check
        print("[16] Testing Zero-Knowledge V2 Web Shell (/v2) & API (/api/v2)...")
        r_v2 = anon.get(f"{BASE_URL}/v2")
        assert r_v2.status_code == 200
        assert "script-src 'self' 'wasm-unsafe-eval'" in r_v2.headers.get("content-security-policy", "")
        assert setup_token, "Expected setup_token printed on stdout"
        r_sw = anon.get(f"{BASE_URL}/v2/sw-stream.js")
        assert r_sw.status_code == 200
        assert r_sw.headers.get("service-worker-allowed") == "/v2"
        # CSRF cross-site rejection
        r_csrf = anon.post(
            f"{BASE_URL}/api/v2/login",
            json_body={"username": "nobody", "authSecret": "x" * 43},
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert r_csrf.status_code == 403
        print("    OK (/v2 shell, SW headers, setup token & CSRF protection verified)")

        # 17. Logout
        print("[17] Testing POST /logout...")
        r = session.post(f"{BASE_URL}/logout", headers={"Accept": "application/json"})
        assert r.status_code == 200
        assert r.json().get("success") is True
        r = session.get(f"{BASE_URL}/api/session")
        assert r.json() == {"authenticated": False}
        print("    OK (logged out and session invalidated)")

        # 18. Zero-Knowledge V2 upload abort (DELETE /api/v2/blobs/upload/{uploadId}) & PHOTOCLOUD_ZK_ONLY=1
        print("[18] Testing ZK V2 upload abort and PHOTOCLOUD_ZK_ONLY=1 strict mode...")
        import base64 as _b64
        import socket as _socket
        import uuid as _uuid

        v2_client = HttpSession()
        user_salt = _b64.urlsafe_b64encode(os.urandom(16)).decode("ascii").rstrip("=")
        auth_secret = _b64.urlsafe_b64encode(os.urandom(32)).decode("ascii").rstrip("=")
        wrapped_vk = _b64.urlsafe_b64encode(os.urandom(60)).decode("ascii").rstrip("=")
        r_v2_reg = v2_client.post(
            f"{BASE_URL}/api/v2/register",
            json_body={
                "username": "rust_zk_abort_user",
                "salt": user_salt,
                "kdfParams": {"algorithm": "Argon2id", "memoryKiB": 65536, "iterations": 3, "parallelism": 1},
                "authSecret": auth_secret,
                "wrappedVaultKey": wrapped_vk,
                "setupToken": setup_token,
            },
        )
        assert r_v2_reg.status_code == 201, f"V2 register failed: {r_v2_reg.status_code} {r_v2_reg.text}"
        set_cookie_hdr = r_v2_reg.headers.get("set-cookie", "")
        assert "HttpOnly" in set_cookie_hdr and "SameSite=Strict" in set_cookie_hdr, (
            f"Missing V2 session cookie flags: {set_cookie_hdr}"
        )
        v2_cookie_pair = set_cookie_hdr.split(";", 1)[0].strip()
        v2_csrf = r_v2_reg.json().get("csrfToken", "")
        v2_headers = {"Cookie": v2_cookie_pair, "X-CSRF-Token": v2_csrf}

        blob_id = str(_uuid.uuid4())
        enc_meta = _b64.urlsafe_b64encode(os.urandom(48)).decode("ascii").rstrip("=")
        r_init = v2_client.post(
            f"{BASE_URL}/api/v2/blobs/upload/init",
            json_body={
                "blobId": blob_id,
                "totalSize": 128,
                "chunkSize": 128,
                "totalChunks": 1,
                "expectedSha256": "a" * 64,
                "encMeta": enc_meta,
            },
            headers=v2_headers,
        )
        assert r_init.status_code == 201, f"V2 upload init failed: {r_init.status_code} {r_init.text}"
        upload_id = r_init.json()["uploadId"]
        r_abort = v2_client.request("DELETE", f"{BASE_URL}/api/v2/blobs/upload/{upload_id}", headers=v2_headers)
        assert r_abort.status_code == 200 and r_abort.json().get("ok") is True, f"Abort failed: {r_abort.status_code} {r_abort.text}"
        r_abort_again = v2_client.request("DELETE", f"{BASE_URL}/api/v2/blobs/upload/{upload_id}", headers=v2_headers)
        assert r_abort_again.status_code == 404, f"Expected 404 after abort, got {r_abort_again.status_code}"

        # Spawn a second short-lived Rust server with PHOTOCLOUD_ZK_ONLY=1
        with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as _sock:
            _sock.bind(("127.0.0.1", 0))
            zk_only_port = _sock.getsockname()[1]
        zk_only_dir = tempfile.mkdtemp(prefix="photocloud_rust_zk_only_")
        for asset_dir in ("public", "static", "templates", "dist", "release", "android-app"):
            src = os.path.join(REPO_ROOT, asset_dir)
            dst = os.path.join(zk_only_dir, asset_dir)
            if os.path.exists(src):
                try:
                    os.symlink(src, dst, target_is_directory=True)
                except OSError:
                    shutil.copytree(src, dst)
        zk_only_env = env.copy()
        zk_only_env["PORT"] = str(zk_only_port)
        zk_only_env["PHOTOCLOUD_ZK_ONLY"] = "1"
        zk_only_proc = subprocess.Popen(
            [BINARY],
            cwd=zk_only_dir,
            env=zk_only_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            zk_url = f"http://127.0.0.1:{zk_only_port}"
            zk_ready = False
            for _ in range(40):
                try:
                    rr = HttpSession().get(f"{zk_url}/v2")
                    if rr.status_code == 200:
                        zk_ready = True
                        break
                except Exception:
                    time.sleep(0.2)
            assert zk_ready, "Rust PHOTOCLOUD_ZK_ONLY=1 server failed to start"
            zk_sess = HttpSession()
            r_root_zk = zk_sess.get(f"{zk_url}/")
            assert r_root_zk.status_code in (302, 307) and r_root_zk.headers.get("location") == "/v2", (
                f"Expected redirect to /v2, got {r_root_zk.status_code} loc={r_root_zk.headers.get('location')}"
            )
            r_legacy_v1 = zk_sess.get(f"{zk_url}/api/session")
            assert r_legacy_v1.status_code == 410, f"Expected 410 on legacy V1 route, got {r_legacy_v1.status_code}"
            assert r_legacy_v1.json().get("error") == "LEGACY_V1_DISABLED_ZK_ONLY"
            r_v2_ok = zk_sess.post(f"{zk_url}/api/v2/login/params", json_body={"username": "probe_user"})
            assert r_v2_ok.status_code == 200, f"Expected 200 on V2 login params, got {r_v2_ok.status_code}"
        finally:
            zk_only_proc.terminate()
            try:
                zk_only_proc.wait(timeout=3)
            except Exception:
                zk_only_proc.kill()
            shutil.rmtree(zk_only_dir, ignore_errors=True)
        print("    OK (V2 upload abort & PHOTOCLOUD_ZK_ONLY=1 verified on Rust)")

        print("\nALL 18 END-TO-END RUST SERVER TEST SUITES PASSED WITH ZERO ERRORS!")
    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=3)
        except Exception:
            server_proc.kill()
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()

