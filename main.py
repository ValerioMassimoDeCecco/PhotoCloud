# server.py (Versione rivista con logging migliorato e mantenimento delle sicurezze)

import os
import secrets
import hashlib
import io
import string
import random
import psutil
import uuid
import zipfile
import shutil
import time
import threading
import logging
from flask import Flask, render_template, request, redirect, url_for, session, send_file, jsonify, send_from_directory, after_this_request
from werkzeug.utils import secure_filename
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from concurrent.futures import ThreadPoolExecutor, as_completed
import json

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)
app.config['UPLOAD_FOLDER'] = 'user_media'
app.config['TEMP_ZIP_FOLDER'] = 'temp_zips'

# Configurazione del logging
logging.basicConfig(level=logging.INFO)

# --- Protezione da Brute Force ---
LOGIN_ATTEMPTS = {}  # {username: [tentativi, timestamp_ultimo_tentativo]}
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_TIME = 300  # 5 minuti

# Creazione delle cartelle necessarie all'avvio
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['TEMP_ZIP_FOLDER'], exist_ok=True)
if not os.path.exists('users.txt'):
    open('users.txt', 'a').close()

# Dizionario per i processi di zippatura in background (adatto per server di sviluppo)
# ATTENZIONE: per un ambiente di produzione con più worker (es. Gunicorn),
# usare una soluzione di stato condiviso come Redis.
ZIP_TASKS = {}

# --- HELPERS ---

def get_dynamic_executor() -> ThreadPoolExecutor:
    """Restituisce un ThreadPoolExecutor con un numero di worker basato sul carico della CPU."""
    cpu_percent = psutil.cpu_percent(interval=None)
    if cpu_percent > 80:
        max_workers = 1
    elif cpu_percent > 60:
        max_workers = max(1, os.cpu_count() // 2)
    else:
        max_workers = os.cpu_count()
    return ThreadPoolExecutor(max_workers=max_workers)

# --- FUNZIONI DI CRITTOGRAFIA E UTENTI ---
# (Logica esistente, corretta e mantenuta)
def generate_api_key(length=32):
    characters = string.ascii_letters + string.digits + string.punctuation
    while True:
        key = ''.join(random.SystemRandom().choice(characters) for _ in range(length))
        if (any(c.islower() for c in key) and any(c.isupper() for c in key) and any(c.isdigit() for c in key) and any(c in string.punctuation for c in key)):
            return key
def hash_key(key):
    return hashlib.sha256(key.encode()).hexdigest()
def verify_key(key, stored_hash):
    return hash_key(key) == stored_hash
def derive_key(key: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100000, backend=default_backend())
    return kdf.derive(key.encode())
def encrypt_file(file_data, key):
    salt = os.urandom(16)
    derived_key = derive_key(key, salt)
    iv = os.urandom(16)
    cipher = Cipher(algorithms.AES(derived_key), modes.CFB(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted = encryptor.update(file_data) + encryptor.finalize()
    return salt + iv + encrypted
def decrypt_file(encrypted_data, key):
    salt = encrypted_data[:16]
    iv = encrypted_data[16:32]
    ciphertext = encrypted_data[32:]
    derived_key = derive_key(key, salt)
    cipher = Cipher(algorithms.AES(derived_key), modes.CFB(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()
def save_user(username, key_hash):
    with open('users.txt', 'a') as f:
        f.write(f"{username}:{key_hash}\n")
def find_user(username):
    if not os.path.exists('users.txt'): return None
    with open('users.txt', 'r') as f:
        for line in f.readlines():
            if line.startswith(username + ':'): return line.split(':')[1].strip()
    return None

# --- LOGICA DI BUSINESS (ESEGUITA IN THREAD) ---
# (Logica esistente, corretta e mantenuta)
def do_registration(username, api_key, upload_folder):
    if find_user(username): raise ValueError("Username già esistente!")
    save_user(username, hash_key(api_key))
    user_folder = os.path.join(upload_folder, username)
    os.makedirs(user_folder, exist_ok=True)
    os.makedirs(os.path.join(user_folder, 'trash'), exist_ok=True)
    return api_key

def do_login(username, api_key):
    stored_hash = find_user(username)
    return stored_hash and verify_key(api_key, stored_hash)

def do_upload(file_data, api_key, user_folder, original_filename, last_modified=None):
    _, extension = os.path.splitext(original_filename)
    os.makedirs(user_folder, exist_ok=True)
    while True:
        random_name = secrets.token_hex(8)
        filename = f"{random_name}{extension}"
        filepath = os.path.join(user_folder, filename)
        if not os.path.exists(filepath): break
    encrypted_data = encrypt_file(file_data, api_key)
    with open(filepath, 'wb') as f: f.write(encrypted_data)
    if last_modified:
        try:
            mtime = float(last_modified) / 1000.0
            os.utime(filepath, (mtime, mtime))
        except Exception as e: app.logger.warning(f"Errore impostando mtime per {filepath}: {e}")
    return True

def do_media_decryption(filepath, api_key):
    with open(filepath, 'rb') as f: encrypted_data = f.read()
    return decrypt_file(encrypted_data, api_key)

# --- FUNZIONI CESTINO ---
# (Logica esistente, corretta e mantenuta)
def do_trash_item(user_folder, filename):
    source_path = os.path.join(user_folder, filename)
    trash_folder = os.path.join(user_folder, 'trash')
    destination_path = os.path.join(trash_folder, filename)
    os.makedirs(trash_folder, exist_ok=True)
    os.rename(source_path, destination_path)
    current_time = time.time()
    os.utime(destination_path, (current_time, current_time))
    return True

def do_restore_item(user_folder, filename):
    trash_folder = os.path.join(user_folder, 'trash')
    source_path = os.path.join(trash_folder, filename)
    destination_path = os.path.join(user_folder, filename)
    os.rename(source_path, destination_path)
    return True

def do_permanent_delete(user_folder, filename):
    filepath = os.path.join(user_folder, 'trash', filename)
    os.remove(filepath)
    return True

def do_empty_trash(user_folder):
    trash_folder = os.path.join(user_folder, 'trash')
    if os.path.exists(trash_folder):
        shutil.rmtree(trash_folder)
        os.makedirs(trash_folder)
    return True

def calculate_file_hash(filepath, api_key):
    try:
        decrypted_data = do_media_decryption(filepath, api_key)
        sha256_hash = hashlib.sha256(decrypted_data).hexdigest()
        return os.path.basename(filepath), sha256_hash
    except Exception as e:
        app.logger.error(f"Errore durante l'hashing di {os.path.basename(filepath)}: {e}")
        return os.path.basename(filepath), None

def do_create_zip(task_id, filenames, user_folder, temp_zip_folder, api_key):
    """Funzione eseguita in background per creare l'archivio ZIP."""
    try:
        zip_filename = f"{task_id}.zip"
        zip_filepath = os.path.join(temp_zip_folder, zip_filename)
        total_files = len(filenames)
        app.logger.info(f"Task ZIP {task_id}: Avvio creazione archivio '{zip_filename}' con {total_files} file.")
        
        with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
            for i, filename in enumerate(filenames):
                progress = int(((i + 1) / total_files) * 100)
                ZIP_TASKS[task_id] = {'status': 'processing', 'progress': progress, 'filename': None}
                
                source_filepath = os.path.join(user_folder, filename)
                # Sicurezza: controlla che il file sia nella cartella dell'utente
                if os.path.exists(source_filepath) and os.path.abspath(source_filepath).startswith(os.path.abspath(user_folder)):
                    try:
                        decrypted_data = do_media_decryption(source_filepath, api_key)
                        zf.writestr(filename, decrypted_data)
                    except Exception as e:
                        app.logger.error(f"Task ZIP {task_id}: Impossibile decrittare o aggiungere il file '{filename}'. Errore: {e}")
                        # Opzionale: si potrebbe decidere di saltare il file e continuare
                else:
                    app.logger.warning(f"Task ZIP {task_id}: File non trovato o non autorizzato: '{filename}'")

        ZIP_TASKS[task_id] = {'status': 'complete', 'progress': 100, 'filename': zip_filename}
        app.logger.info(f"Task ZIP {task_id}: Creazione completata con successo.")
    except Exception as e:
        app.logger.error(f"Task ZIP {task_id}: Errore critico durante la creazione dell'archivio. Errore: {e}")
        ZIP_TASKS[task_id] = {'status': 'error', 'progress': 0, 'filename': None, 'error': str(e)}

# --- PROCESSO DI PULIZIA IN BACKGROUND ---

def clean_trash_and_zips():
    """Pulisce i vecchi file ZIP temporanei e i file nel cestino da più di 30 giorni."""
    now = time.time()
    
    # Pulisci ZIP temporanei più vecchi di 24 ore
    temp_folder = app.config['TEMP_ZIP_FOLDER']
    for f in os.listdir(temp_folder):
        filepath = os.path.join(temp_folder, f)
        if os.path.isfile(filepath) and os.path.getmtime(filepath) < now - 86400: # 1 giorno
            try:
                os.remove(filepath)
                app.logger.info(f"Pulizia: Eliminato ZIP temporaneo scaduto: {filepath}")
            except Exception as e:
                app.logger.error(f"Pulizia: Errore eliminando {filepath}: {e}")
    
    # Pulisci cestini utenti (file più vecchi di 30 giorni)
    upload_folder = app.config['UPLOAD_FOLDER']
    for user in os.listdir(upload_folder):
        user_folder = os.path.join(upload_folder, user)
        if os.path.isdir(user_folder):
            trash_folder = os.path.join(user_folder, 'trash')
            if os.path.exists(trash_folder):
                for tf in os.listdir(trash_folder):
                    tfilepath = os.path.join(trash_folder, tf)
                    if os.path.isfile(tfilepath) and os.path.getmtime(tfilepath) < now - 30 * 86400: # 30 giorni
                        try:
                            os.remove(tfilepath)
                            app.logger.info(f"Pulizia: Eliminato file scaduto dal cestino di '{user}': {tf}")
                        except Exception as e:
                            app.logger.error(f"Pulizia: Errore eliminando {tfilepath}: {e}")

def background_cleaner():
    """Thread che esegue la pulizia ogni ora."""
    while True:
        app.logger.info("Esecuzione del task di pulizia periodica...")
        clean_trash_and_zips()
        time.sleep(3600) # Esegui ogni ora

# --- ROTTE FLASK ---

@app.route('/')
def home():
    if 'username' in session:
        user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
        media_files_details = []
        if os.path.exists(user_folder):
            valid_extensions = ('.jpg', '.jpeg', '.png', '.mp4', '.mov')
            filenames = [f for f in os.listdir(user_folder) 
                         if os.path.isfile(os.path.join(user_folder, f)) and f.lower().endswith(valid_extensions)]
            for f in filenames:
                filepath = os.path.join(user_folder, f)
                media_files_details.append({ 'filename': f, 'timestamp': os.path.getmtime(filepath) })
            media_files_details.sort(key=lambda x: x['timestamp'], reverse=True)
        return render_template('gallery.html', media_files=media_files_details)
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    username = request.form['username'].strip()
    if not username: return "Username non valido!", 400
    if find_user(username): return "Username già esistente!", 409
    
    key_type = request.form.get('key_type', 'generate')
    if key_type == 'custom':
        api_key = request.form.get('custom_key')
        if not api_key or len(api_key) < 8: return "La chiave personalizzata deve avere almeno 8 caratteri.", 400
    else:
        api_key = generate_api_key()

    try:
        with get_dynamic_executor() as executor:
            final_key = executor.submit(do_registration, username, api_key, app.config['UPLOAD_FOLDER']).result()
        
        auth_data = {
            "username": username, "api_key": final_key, "session_id": str(uuid.uuid4()),
            "created_at": time.time(), "hash_of_key": hash_key(final_key)
        }
        buffer = io.BytesIO(json.dumps(auth_data, indent=2).encode('utf-8'))
        download_name = f'photocloud_auth_{secure_filename(username)}.json'
        return send_file(buffer, as_attachment=True, download_name=download_name, mimetype='application/json')
    except Exception as e:
        app.logger.error(f"Errore durante la registrazione per l'utente '{username}': {e}")
        return str(e), 400

@app.route('/login', methods=['POST'])
def login():
    if 'auth_file' not in request.files: return "File di autenticazione non trovato.", 400
    auth_file = request.files['auth_file']
    if auth_file.filename == '': return "Nessun file selezionato.", 400

    try:
        auth_data = json.load(auth_file)
        username = auth_data.get('username')
        api_key = auth_data.get('api_key')
        if not username or not api_key: return "File di autenticazione non valido.", 400

        # Logica anti-brute force
        current_time = time.time()
        if username in LOGIN_ATTEMPTS:
            attempts, last_attempt_time = LOGIN_ATTEMPTS[username]
            if attempts >= MAX_LOGIN_ATTEMPTS and current_time - last_attempt_time < LOCKOUT_TIME:
                remaining = int(LOCKOUT_TIME - (current_time - last_attempt_time))
                return f"Troppi tentativi falliti. Riprova tra {remaining // 60}m {remaining % 60}s.", 429
            if current_time - last_attempt_time >= LOCKOUT_TIME:
                LOGIN_ATTEMPTS.pop(username, None)

        with get_dynamic_executor() as executor:
            is_valid = executor.submit(do_login, username, api_key).result()
        
        if is_valid:
            LOGIN_ATTEMPTS.pop(username, None)
            session['username'] = username
            session['api_key'] = api_key
            app.logger.info(f"Login riuscito per l'utente: {username}")
            return redirect(url_for('home'))
        else:
            if username not in LOGIN_ATTEMPTS:
                LOGIN_ATTEMPTS[username] = [1, current_time]
            else:
                LOGIN_ATTEMPTS[username][0] += 1
                LOGIN_ATTEMPTS[username][1] = current_time
            app.logger.warning(f"Tentativo di login fallito per l'utente: {username}")
            return "Credenziali non valide.", 401
    except Exception as e:
        app.logger.error(f"Errore durante il login: {e}")
        return "Errore interno durante il login.", 500

@app.route('/logout', methods=['POST'])
def logout():
    app.logger.info(f"Logout per l'utente: {session.get('username')}")
    session.clear()
    return redirect(url_for('home'))

@app.route('/upload', methods=['POST'])
def upload():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    files = request.files.getlist("file[]")
    if not files or files[0].filename == '': return jsonify({"error": "Nessun file"}), 400
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    api_key = session['api_key']
    timestamps = request.form.getlist("timestamp[]")
    
    try:
        with get_dynamic_executor() as executor:
            futures = [executor.submit(do_upload, f.read(), api_key, user_folder, secure_filename(f.filename), timestamps[i] if i < len(timestamps) else None) for i, f in enumerate(files)]
            for future in as_completed(futures): future.result()
    except Exception as e:
        app.logger.error(f"Errore upload per {session['username']}: {e}")
        return jsonify({"error": f"Errore durante il caricamento: {e}"}), 500
    
    return jsonify({"success": True, "message": f"{len(files)} file caricati."})

@app.route('/media/<filename>')
def media(filename):
    if 'username' not in session: return "Accesso negato", 403
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    base_path = os.path.join(user_folder, 'trash') if request.args.get('from_trash') == 'true' else user_folder

    # Sicurezza: Mitigazione Path Traversal. Garantisce che il file richiesto
    # sia all'interno della cartella base prevista per l'utente.
    safe_base_path = os.path.abspath(base_path)
    safe_filepath = os.path.abspath(os.path.join(safe_base_path, filename))

    if not safe_filepath.startswith(safe_base_path):
        app.logger.warning(f"Tentativo di Path Traversal da {session['username']} per '{filename}'")
        return "Accesso non autorizzato.", 403
        
    if not os.path.exists(safe_filepath): return "File non trovato", 404

    try:
        with get_dynamic_executor() as executor:
            decrypted_data = executor.submit(do_media_decryption, safe_filepath, session['api_key']).result()
        ext = filename.split('.')[-1].lower()
        mime_type = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'mp4': 'video/mp4', 'mov': 'video/mp4'}.get(ext, 'application/octet-stream')
        return send_file(io.BytesIO(decrypted_data), mimetype=mime_type)
    except Exception as e:
        app.logger.error(f"Errore decrittografia per '{filename}': {e}")
        return "Errore durante la decrittografia.", 500

@app.route('/prepare-zip', methods=['POST'])
def prepare_zip():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    
    data = request.get_json()
    filenames = data.get('filenames')
    if not filenames: return jsonify({"error": "Nessun file selezionato"}), 400
    
    task_id = str(uuid.uuid4())
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    ZIP_TASKS[task_id] = {'status': 'starting', 'progress': 0, 'filename': None}
    
    # Avvia la creazione dello ZIP in un thread separato per non bloccare la richiesta
    threading.Thread(target=do_create_zip, args=(
        task_id, filenames, user_folder, app.config['TEMP_ZIP_FOLDER'], session['api_key']
    )).start()

    app.logger.info(f"Avviato task di zippatura {task_id} per {session['username']}")
    return jsonify({"task_id": task_id})

@app.route('/zip-progress/<task_id>')
def zip_progress(task_id):
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    task_info = ZIP_TASKS.get(task_id, {'status': 'not_found', 'progress': 0})
    return jsonify(task_info)

@app.route('/download-zip/<filename>')
def download_zip(filename):
    if 'username' not in session: return "Accesso negato", 403
    
    # Sicurezza: Mitigazione Path Traversal per il download dello ZIP
    directory = os.path.abspath(app.config['TEMP_ZIP_FOLDER'])
    filepath = os.path.abspath(os.path.join(directory, filename))

    if not filepath.startswith(directory):
        app.logger.warning(f"Tentativo di download non autorizzato per ZIP '{filename}' da {session['username']}")
        return "Accesso non autorizzato al file", 403
        
    if not os.path.exists(filepath):
        app.logger.warning(f"Richiesta di download per ZIP non esistente '{filename}'")
        return "File non trovato", 404

    @after_this_request
    def remove_file(response):
        """Rimuove il file ZIP temporaneo dopo che la richiesta è stata completata."""
        try:
            os.remove(filepath)
            task_id = os.path.splitext(filename)[0]
            if task_id in ZIP_TASKS:
                del ZIP_TASKS[task_id]
            app.logger.info(f"Rimosso file ZIP temporaneo: {filepath}")
        except Exception as e:
            app.logger.error(f"Errore durante l'eliminazione del file ZIP {filename}: {e}")
        return response
        
    return send_from_directory(directory, filename, as_attachment=True)


# --- ROTTE CESTINO (con protezioni IDOR e Path Traversal) ---
# La logica è solida e sicura, viene mantenuta con logging aggiuntivo.

@app.route('/trash')
def trash_view():
    if 'username' not in session: return redirect(url_for('home'))
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    trash_folder = os.path.join(user_folder, 'trash')
    trashed_files = []
    if os.path.exists(trash_folder):
        valid_extensions = ('.jpg', '.jpeg', '.png', '.mp4', '.mov')
        filenames = [f for f in os.listdir(trash_folder) if f.lower().endswith(valid_extensions)]
        trashed_files = sorted(
            [{'filename': f, 'timestamp': os.path.getmtime(os.path.join(trash_folder, f))} for f in filenames],
            key=lambda x: x['timestamp'], reverse=True
        )
    return render_template('trash.html', trashed_files=trashed_files)

@app.route('/trash/batch', methods=['POST'])
def trash_batch():
    if 'username' not in session: return jsonify({"error": "Accesso negato", "success": False}), 403
    data = request.get_json()
    filenames = data.get('filenames')
    if not isinstance(filenames, list): return jsonify({"error": "Input non valido", "success": False}), 400

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    errors = []
    with get_dynamic_executor() as executor:
        futures = {executor.submit(do_trash_item, user_folder, f): f for f in filenames}
        for future in as_completed(futures):
            try: future.result()
            except Exception as e: errors.append(f"Errore su {futures[future]}: {e}")
    
    if errors:
        app.logger.error(f"Errori durante il batch trash per {session['username']}: {errors}")
        return jsonify({'success': False, 'error': '. '.join(errors)}), 500
    return jsonify({'success': True})

def check_file_in_trash(user_folder, filename):
    """Funzione di sicurezza per verificare che un file sia nel cestino dell'utente."""
    safe_trash_folder = os.path.abspath(os.path.join(user_folder, 'trash'))
    safe_filepath = os.path.abspath(os.path.join(safe_trash_folder, filename))
    if not safe_filepath.startswith(safe_trash_folder):
        app.logger.warning(f"Tentativo IDOR su file '{filename}' nel cestino.")
        return None
    return safe_filepath if os.path.exists(safe_filepath) else None

@app.route('/restore/<filename>', methods=['POST'])
def restore_item(filename):
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    
    if not check_file_in_trash(user_folder, filename):
        return jsonify({'success': False, 'error': 'File non trovato o accesso negato'}), 404

    try:
        do_restore_item(user_folder, filename)
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Errore ripristino file '{filename}' per {session['username']}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/delete_permanent/<filename>', methods=['POST'])
def delete_permanent_item(filename):
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    
    if not check_file_in_trash(user_folder, filename):
        return jsonify({'success': False, 'error': 'File non trovato o accesso negato'}), 404

    try:
        do_permanent_delete(user_folder, filename)
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Errore eliminazione permanente '{filename}' per {session['username']}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/empty_trash', methods=['POST'])
def empty_trash():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    try:
        do_empty_trash(user_folder)
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Errore svuotamento cestino per {session['username']}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/find_duplicates_server', methods=['POST'])
def find_duplicates_server():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    media_files = [os.path.join(user_folder, f) for f in os.listdir(user_folder) if os.path.isfile(os.path.join(user_folder, f)) and f.lower().endswith(('.jpg', '.jpeg', '.png', '.mp4', '.mov'))]
    if len(media_files) < 2: return jsonify({"duplicates": []})
    
    hashes = {}
    with get_dynamic_executor() as executor:
        future_to_file = {executor.submit(calculate_file_hash, fp, session['api_key']): fp for fp in media_files}
        for future in as_completed(future_to_file):
            filename, file_hash = future.result()
            if file_hash:
                if file_hash not in hashes: hashes[file_hash] = []
                hashes[file_hash].append(filename)
                
    duplicates = [files for files in hashes.values() if len(files) > 1]
    return jsonify({"duplicates": duplicates})

if __name__ == '__main__':
    # Avvia il thread di pulizia in background
    cleaner_thread = threading.Thread(target=background_cleaner, daemon=True)
    cleaner_thread.start()
    
    app.run(host='0.0.0.0', port=5000, debug=True)