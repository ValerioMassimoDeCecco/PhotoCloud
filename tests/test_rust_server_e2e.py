import subprocess
import time
import requests
import sys
import os
import io

PORT = 8089
BASE_URL = f"http://127.0.0.1:{PORT}"
BINARY = os.path.abspath("rust/app/target/release/server.exe")

print(f"Starting Rust server on port {PORT} from {BINARY}...")
env = os.environ.copy()
env["PORT"] = str(PORT)

server_proc = subprocess.Popen([BINARY], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

time.sleep(1.0)

try:
    # 1. Unauthenticated root
    print("[1] Testing GET / (unauthenticated)...")
    r = requests.get(f"{BASE_URL}/")
    assert r.status_code == 200
    assert "Accedi al tuo Cloud" in r.text or "PhotoCloud" in r.text
    print("    OK")

    # 2. Unauthenticated session
    print("[2] Testing GET /api/session (unauthenticated)...")
    r = requests.get(f"{BASE_URL}/api/session")
    assert r.status_code == 200
    assert r.json() == {"authenticated": False}
    print("    OK")

    # 3. Register a test user
    test_user = f"testuser_{int(time.time())}"
    print(f"[3] Testing POST /register for user {test_user}...")
    r = requests.post(f"{BASE_URL}/register", json={"username": test_user, "key_type": "generate"})
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    auth_data = r.json()
    assert auth_data["username"] == test_user
    api_key = auth_data["api_key"]
    assert len(api_key) == 32
    print(f"    OK (generated API key: {api_key[:6]}...)")

    # 4. Login with JSON
    print(f"[4] Testing POST /login with API key...")
    session = requests.Session()
    r = session.post(
        f"{BASE_URL}/login",
        json={"username": test_user, "api_key": api_key},
        headers={"Accept": "application/json"}
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    assert r.json().get("success") is True
    assert "photocloud_sid" in session.cookies
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
    r = session.post(f"{BASE_URL}/api/albums/create", json={"name": "Vacanze 2026"})
    assert r.status_code == 200
    albums = r.json().get("albums", [])
    assert "Vacanze 2026" in albums
    print("    OK (album created)")

    # 7. File upload with encryption
    print("[7] Testing POST /upload (encrypted file storage)...")
    payload = b"Hello PhotoCloud Native Rust Server! Test payload 12345."
    files = {"file[]": ("test_doc.txt", io.BytesIO(payload), "text/plain")}
    data = {"album": "Vacanze 2026"}
    r = session.post(f"{BASE_URL}/upload", files=files, data=data)
    assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text}"
    upload_resp = r.json()
    assert upload_resp.get("success") is True
    uploaded_files = upload_resp.get("files", [])
    assert len(uploaded_files) == 1
    uploaded_filename = uploaded_files[0]
    print(f"    OK (uploaded and encrypted as: {uploaded_filename})")

    # 8. Check that file on disk is encrypted with PhotoCloud GCM v1 format
    user_media_path = os.path.join("user_media", test_user, uploaded_filename)
    assert os.path.exists(user_media_path)
    with open(user_media_path, "rb") as fp:
        raw_on_disk = fp.read()
    assert raw_on_disk.startswith(b"PhotoCloud-GCM-v1\x00")
    assert payload not in raw_on_disk  # Ciphertext cannot contain plaintext
    print(f"    OK (verified GCM v1 header and encryption on disk: {len(raw_on_disk)} bytes)")

    # 9. Download and decrypt file
    print(f"[9] Testing GET /media/{uploaded_filename} (decryption on the fly)...")
    r = session.get(f"{BASE_URL}/media/{uploaded_filename}")
    assert r.status_code == 200
    assert r.content == payload
    assert r.headers.get("Content-Type") == "text/plain; charset=utf-8"
    print("    OK (decrypted payload matches original exactly)")

    # 10. HTTP Range request decryption
    print(f"[10] Testing HTTP Range request on /media/{uploaded_filename}...")
    r = session.get(f"{BASE_URL}/media/{uploaded_filename}", headers={"Range": "bytes=6-15"})
    assert r.status_code == 206
    assert r.content == payload[6:16]
    assert r.headers.get("Content-Range") == f"bytes 6-15/{len(payload)}"
    print(f"    OK (range slice matched: {r.content})")

    # 11. Toggle favorite
    print(f"[11] Testing POST /api/favorites/toggle...")
    r = session.post(f"{BASE_URL}/api/favorites/toggle", json={"filename": uploaded_filename})
    assert r.status_code == 200
    assert r.json().get("isFavorite") is True
    assert uploaded_filename in r.json().get("favorites", [])
    print("    OK (favorited)")

    # 12. Search natural language query
    print(f"[12] Testing GET /api/search?q=test...")
    r = session.get(f"{BASE_URL}/api/search?q=test")
    assert r.status_code == 200
    results = r.json().get("results", [])
    assert len(results) >= 1
    assert any(item["filename"] == uploaded_filename for item in results)
    print("    OK (natural language search returned matches)")

    # 13. Move to trash and restore
    print(f"[13] Testing POST /trash/{uploaded_filename} and restore...")
    r = session.post(f"{BASE_URL}/trash/{uploaded_filename}")
    assert r.status_code == 200
    assert not os.path.exists(user_media_path)
    trash_path = os.path.join("user_media", test_user, "trash", uploaded_filename)
    assert os.path.exists(trash_path)

    r = session.post(f"{BASE_URL}/restore/{uploaded_filename}")
    assert r.status_code == 200
    assert os.path.exists(user_media_path)
    assert not os.path.exists(trash_path)
    print("    OK (trash and restore working perfectly)")

    # 14. Logout
    print("[14] Testing POST /logout...")
    r = session.post(f"{BASE_URL}/logout", headers={"Accept": "application/json"})
    assert r.status_code == 200
    assert r.json().get("success") is True

    r = session.get(f"{BASE_URL}/api/session")
    assert r.json() == {"authenticated": False}
    print("    OK (logged out and session invalidated)")

    print("\nALL 14 END-TO-END RUST SERVER TEST SUITES PASSED WITH ZERO ERRORS!")

finally:
    server_proc.terminate()
    try:
        server_proc.wait(timeout=3)
    except:
        server_proc.kill()
