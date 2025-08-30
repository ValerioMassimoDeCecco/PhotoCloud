# server.py - File completo con tutte le funzionalità

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
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, session, send_file, jsonify, send_from_directory, after_this_request
from flask_socketio import SocketIO, emit, join_room, leave_room
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

# Inizializzazione WebSocket per 2FA
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Configurazione del logging
logging.basicConfig(level=logging.INFO)

# --- Protezione da Brute Force ---
LOGIN_ATTEMPTS = {}  # {username: [tentativi, timestamp_ultimo_tentativo]}
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_TIME = 300  # 5 minuti

# --- Strutture dati per 2FA ---
TRUSTED_BROWSERS = {}  # {username: {browser_id: browser_info}}
PENDING_LOGINS = {}    # {request_id: login_request_data}
ACTIVE_SESSIONS = {}   # {session_id: session_data}
BROWSER_CACHE = {}     # Cache per dati browser

# Creazione delle cartelle necessarie all'avvio
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['TEMP_ZIP_FOLDER'], exist_ok=True)
if not os.path.exists('users.txt'):
    open('users.txt', 'a').close()

# Dizionario per i processi di zippatura in background
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

# --- FUNZIONI 2FA ---

def get_browser_fingerprint(request):
    """Ottiene un fingerprint del browser per il 2FA."""
    user_agent = request.headers.get('User-Agent', 'Unknown')
    return {
        'user_agent': user_agent,
        'ip': request.remote_addr,
        'platform': request.user_agent.platform if request.user_agent else 'Unknown',
        'browser': request.user_agent.browser if request.user_agent else 'Unknown',
        'version': request.user_agent.version if request.user_agent else 'Unknown',
        'first_seen': time.time(),
        'last_used': time.time()
    }

def is_trusted_browser(username, browser_id):
    """Verifica se un browser è fidato per un utente."""
    if username not in TRUSTED_BROWSERS:
        return False
    if browser_id not in TRUSTED_BROWSERS[username]:
        return False
    # Aggiorna ultimo utilizzo
    TRUSTED_BROWSERS[username][browser_id]['last_used'] = time.time()
    return True

def clean_expired_2fa_requests():
    """Pulisce le richieste 2FA scadute."""
    current_time = time.time()
    expired = [rid for rid, req in PENDING_LOGINS.items() 
               if req['expires_at'] < current_time]
    for rid in expired:
        del PENDING_LOGINS[rid]
        app.logger.info(f"Rimossa richiesta 2FA scaduta: {rid}")

# --- FUNZIONI DI CRITTOGRAFIA E UTENTI ---

def generate_api_key(length=32):
    characters = string.ascii_letters + string.digits + string.punctuation
    while True:
        key = ''.join(random.SystemRandom().choice(characters) for _ in range(length))
        if (any(c.islower() for c in key) and any(c.isupper() for c in key) and 
            any(c.isdigit() for c in key) and any(c in string.punctuation for c in key)):
            return key

def hash_key(key):
    return hashlib.sha256(key.encode()).hexdigest()

def verify_key(key, stored_hash):
    return hash_key(key) == stored_hash

def derive_key(key: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, 
                     iterations=100000, backend=default_backend())
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
    if not os.path.exists('users.txt'): 
        return None
    with open('users.txt', 'r') as f:
        for line in f.readlines():
            if line.startswith(username + ':'): 
                return line.split(':')[1].strip()
    return None

# --- LOGICA DI BUSINESS ---

def do_registration(username, api_key, upload_folder):
    if find_user(username): 
        raise ValueError("Username già esistente!")
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
        if not os.path.exists(filepath): 
            break
    encrypted_data = encrypt_file(file_data, api_key)
    with open(filepath, 'wb') as f: 
        f.write(encrypted_data)
    if last_modified:
        try:
            mtime = float(last_modified) / 1000.0
            os.utime(filepath, (mtime, mtime))
        except Exception as e: 
            app.logger.warning(f"Errore impostando mtime per {filepath}: {e}")
    return True

def do_media_decryption(filepath, api_key):
    with open(filepath, 'rb') as f: 
        encrypted_data = f.read()
    return decrypt_file(encrypted_data, api_key)

# --- FUNZIONI CESTINO ---

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
        app.logger.info(f"Task ZIP {task_id}: Avvio creazione archivio con {total_files} file.")
        
        with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
            for i, filename in enumerate(filenames):
                progress = int(((i + 1) / total_files) * 100)
                ZIP_TASKS[task_id] = {'status': 'processing', 'progress': progress, 'filename': None}
                
                source_filepath = os.path.join(user_folder, filename)
                if os.path.exists(source_filepath) and os.path.abspath(source_filepath).startswith(os.path.abspath(user_folder)):
                    try:
                        decrypted_data = do_media_decryption(source_filepath, api_key)
                        zf.writestr(filename, decrypted_data)
                    except Exception as e:
                        app.logger.error(f"Task ZIP {task_id}: Errore con file '{filename}': {e}")
                else:
                    app.logger.warning(f"Task ZIP {task_id}: File non autorizzato: '{filename}'")

        ZIP_TASKS[task_id] = {'status': 'complete', 'progress': 100, 'filename': zip_filename}
        app.logger.info(f"Task ZIP {task_id}: Completato.")
    except Exception as e:
        app.logger.error(f"Task ZIP {task_id}: Errore critico: {e}")
        ZIP_TASKS[task_id] = {'status': 'error', 'progress': 0, 'filename': None, 'error': str(e)}

def check_file_in_trash(user_folder, filename):
    """Funzione di sicurezza per verificare che un file sia nel cestino dell'utente."""
    safe_trash_folder = os.path.abspath(os.path.join(user_folder, 'trash'))
    safe_filepath = os.path.abspath(os.path.join(safe_trash_folder, filename))
    if not safe_filepath.startswith(safe_trash_folder):
        app.logger.warning(f"Tentativo IDOR su file '{filename}' nel cestino.")
        return None
    return safe_filepath if os.path.exists(safe_filepath) else None

# --- PROCESSO DI PULIZIA IN BACKGROUND ---

def clean_trash_and_zips():
    """Pulisce i vecchi file ZIP temporanei e i file nel cestino."""
    now = time.time()
    
    # Pulisci ZIP temporanei più vecchi di 24 ore
    temp_folder = app.config['TEMP_ZIP_FOLDER']
    if os.path.exists(temp_folder):
        for f in os.listdir(temp_folder):
            filepath = os.path.join(temp_folder, f)
            if os.path.isfile(filepath) and os.path.getmtime(filepath) < now - 86400:
                try:
                    os.remove(filepath)
                    app.logger.info(f"Pulizia: Eliminato ZIP scaduto: {filepath}")
                except Exception as e:
                    app.logger.error(f"Pulizia: Errore eliminando {filepath}: {e}")
    
    # Pulisci richieste 2FA scadute
    clean_expired_2fa_requests()
    
    # Pulisci cestini utenti (file più vecchi di 30 giorni)
    upload_folder = app.config['UPLOAD_FOLDER']
    if os.path.exists(upload_folder):
        for user in os.listdir(upload_folder):
            user_folder = os.path.join(upload_folder, user)
            if os.path.isdir(user_folder):
                trash_folder = os.path.join(user_folder, 'trash')
                if os.path.exists(trash_folder):
                    for tf in os.listdir(trash_folder):
                        tfilepath = os.path.join(trash_folder, tf)
                        if os.path.isfile(tfilepath) and os.path.getmtime(tfilepath) < now - 30 * 86400:
                            try:
                                os.remove(tfilepath)
                                app.logger.info(f"Pulizia: Eliminato file scaduto: {tf}")
                            except Exception as e:
                                app.logger.error(f"Pulizia: Errore eliminando {tfilepath}: {e}")

def background_cleaner():
    """Thread che esegue la pulizia ogni ora."""
    while True:
        app.logger.info("Esecuzione pulizia periodica...")
        clean_trash_and_zips()
        time.sleep(3600)

# --- WEBSOCKET HANDLERS PER 2FA ---

@socketio.on('connect')
def handle_connect():
    """Gestisce connessione WebSocket."""
    if 'username' in session:
        join_room(session['username'])
        emit('connected', {'status': 'success', 'username': session['username']})
        app.logger.info(f"WebSocket: {session['username']} connesso")

@socketio.on('disconnect')
def handle_disconnect():
    """Gestisce disconnessione WebSocket."""
    if 'username' in session:
        leave_room(session['username'])
        app.logger.info(f"WebSocket: {session['username']} disconnesso")

@socketio.on('join_dashboard')
def handle_join_dashboard(data):
    """Gestisce join alla dashboard per ricevere notifiche 2FA."""
    if 'username' in session:
        join_room(session['username'])
        
        # Invia richieste pendenti
        pending = [req for req in PENDING_LOGINS.values() 
                  if req['username'] == session['username'] and 
                  req['status'] == 'pending']
        
        emit('dashboard_joined', {
            'status': 'success',
            'pending_requests': pending
        })

@socketio.on('join_request')
def handle_join_request(data):
    """Il browser in attesa si unisce alla room della sua richiesta."""
    request_id = data.get('request_id')
    
    if request_id and request_id in PENDING_LOGINS:
        login_request = PENDING_LOGINS[request_id]
        
        # Verifica che sia l'utente corretto
        if session.get('pending_username') == login_request['username']:
            join_room(request_id)
            emit('request_joined', {
                'status': 'success',
                'request_id': request_id
            })
            app.logger.info(f"Browser unito alla room di attesa: {request_id}")

@socketio.on('leave_request')
def handle_leave_request(data):
    """Il browser lascia la room della richiesta."""
    request_id = data.get('request_id')
    if request_id:
        leave_room(request_id)
        app.logger.info(f"Browser ha lasciato la room: {request_id}")

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
                media_files_details.append({'filename': f, 'timestamp': os.path.getmtime(filepath)})
            media_files_details.sort(key=lambda x: x['timestamp'], reverse=True)
        return render_template('gallery.html', media_files=media_files_details)
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    username = request.form['username'].strip()
    if not username: 
        return "Username non valido!", 400
    if find_user(username): 
        return "Username già esistente!", 409
    
    key_type = request.form.get('key_type', 'generate')
    if key_type == 'custom':
        api_key = request.form.get('custom_key')
        if not api_key or len(api_key) < 8: 
            return "La chiave personalizzata deve avere almeno 8 caratteri.", 400
    else:
        api_key = generate_api_key()

    try:
        with get_dynamic_executor() as executor:
            final_key = executor.submit(do_registration, username, api_key, app.config['UPLOAD_FOLDER']).result()
        
        auth_data = {
            "username": username, 
            "api_key": final_key, 
            "session_id": str(uuid.uuid4()),
            "created_at": time.time(), 
            "hash_of_key": hash_key(final_key)
        }
        buffer = io.BytesIO(json.dumps(auth_data, indent=2).encode('utf-8'))
        download_name = f'photocloud_auth_{secure_filename(username)}.json'
        return send_file(buffer, as_attachment=True, download_name=download_name, mimetype='application/json')
    except Exception as e:
        app.logger.error(f"Errore registrazione per '{username}': {e}")
        return str(e), 400

@app.route('/login', methods=['POST'])
def login():
    if 'auth_file' not in request.files: 
        return "File di autenticazione non trovato.", 400
    auth_file = request.files['auth_file']
    if auth_file.filename == '': 
        return "Nessun file selezionato.", 400

    try:
        auth_data = json.load(auth_file)
        username = auth_data.get('username')
        api_key = auth_data.get('api_key')
        if not username or not api_key: 
            return "File di autenticazione non valido.", 400

        # Logica anti-brute force
        current_time = time.time()
        if username in LOGIN_ATTEMPTS:
            attempts, last_attempt_time = LOGIN_ATTEMPTS[username]
            if attempts >= MAX_LOGIN_ATTEMPTS and current_time - last_attempt_time < LOCKOUT_TIME:
                remaining = int(LOCKOUT_TIME - (current_time - last_attempt_time))
                return f"Troppi tentativi. Riprova tra {remaining // 60}m {remaining % 60}s.", 429
            if current_time - last_attempt_time >= LOCKOUT_TIME:
                LOGIN_ATTEMPTS.pop(username, None)

        # Verifica credenziali
        with get_dynamic_executor() as executor:
            is_valid = executor.submit(do_login, username, api_key).result()
        
        if is_valid:
            LOGIN_ATTEMPTS.pop(username, None)
            
            # Ottieni fingerprint del browser
            browser_info = get_browser_fingerprint(request)
            browser_id = hashlib.sha256(json.dumps(browser_info, sort_keys=True).encode()).hexdigest()
            
            if is_trusted_browser(username, browser_id):
                # Browser fidato, login diretto
                session['username'] = username
                session['api_key'] = api_key
                session['browser_id'] = browser_id
                app.logger.info(f"Login riuscito (browser fidato) per: {username}")
                return redirect(url_for('home'))
            else:
                # Browser non fidato, richiedi approvazione 2FA
                session['pending_username'] = username
                session['pending_api_key'] = api_key
                session['browser_info'] = browser_info
                session['browser_id'] = browser_id
                
                # Crea richiesta 2FA
                request_id = str(uuid.uuid4())
                expiration = time.time() + 600  # 10 minuti
                
                PENDING_LOGINS[request_id] = {
                    'username': username,
                    'browser_info': browser_info,
                    'browser_id': browser_id,
                    'created_at': time.time(),
                    'expires_at': expiration,
                    'status': 'pending',
                    'ip_address': request.remote_addr
                }
                
                # Notifica tutti i browser fidati dell'utente
                socketio.emit('new_login_request', {
                    'request_id': request_id,
                    'username': username,
                    'browser_info': browser_info,
                    'ip_address': request.remote_addr,
                    'time': datetime.now().isoformat()
                }, room=username)
                
                app.logger.info(f"2FA richiesto per {username}, request_id: {request_id}")
                
                # Redirect alla pagina di attesa
                return redirect(url_for('login_wait', request_id=request_id))
        else:
            # Credenziali non valide
            if username not in LOGIN_ATTEMPTS:
                LOGIN_ATTEMPTS[username] = [1, current_time]
            else:
                LOGIN_ATTEMPTS[username][0] += 1
                LOGIN_ATTEMPTS[username][1] = current_time
            app.logger.warning(f"Login fallito per: {username}")
            return "Credenziali non valide.", 401
            
    except Exception as e:
        app.logger.error(f"Errore login: {e}")
        return "Errore interno durante il login.", 500

@app.route('/login_wait')
def login_wait():
    """Pagina di attesa per approvazione 2FA."""
    request_id = request.args.get('request_id')
    
    if not request_id or request_id not in PENDING_LOGINS:
        return redirect(url_for('home'))
    
    login_request = PENDING_LOGINS[request_id]
    
    # Verifica che sia l'utente corretto
    if session.get('pending_username') != login_request['username']:
        return redirect(url_for('home'))
    
    # Calcola tempo rimanente
    time_remaining = int(login_request['expires_at'] - time.time())
    
    return render_template('login_wait.html', 
                         request_id=request_id,
                         time_remaining=time_remaining,
                         browser_info=login_request['browser_info'])

@app.route('/logout', methods=['POST'])
def logout():
    app.logger.info(f"Logout per: {session.get('username')}")
    session.clear()
    return redirect(url_for('home'))

@app.route('/upload', methods=['POST'])
def upload():
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
    files = request.files.getlist("file[]")
    if not files or files[0].filename == '': 
        return jsonify({"error": "Nessun file"}), 400
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    api_key = session['api_key']
    timestamps = request.form.getlist("timestamp[]")
    
    try:
        with get_dynamic_executor() as executor:
            futures = [executor.submit(do_upload, f.read(), api_key, user_folder, 
                      secure_filename(f.filename), timestamps[i] if i < len(timestamps) else None) 
                      for i, f in enumerate(files)]
            for future in as_completed(futures): 
                future.result()
    except Exception as e:
        app.logger.error(f"Errore upload per {session['username']}: {e}")
        return jsonify({"error": f"Errore durante il caricamento: {e}"}), 500
    
    return jsonify({"success": True, "message": f"{len(files)} file caricati."})

@app.route('/media/<filename>')
def media(filename):
    if 'username' not in session: 
        return "Accesso negato", 403
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    base_path = os.path.join(user_folder, 'trash') if request.args.get('from_trash') == 'true' else user_folder

    # Sicurezza: Mitigazione Path Traversal
    safe_base_path = os.path.abspath(base_path)
    safe_filepath = os.path.abspath(os.path.join(safe_base_path, filename))

    if not safe_filepath.startswith(safe_base_path):
        app.logger.warning(f"Tentativo di Path Traversal da {session['username']} per '{filename}'")
        return "Accesso non autorizzato.", 403
        
    if not os.path.exists(safe_filepath): 
        return "File non trovato", 404

    try:
        with get_dynamic_executor() as executor:
            decrypted_data = executor.submit(do_media_decryption, safe_filepath, session['api_key']).result()
        ext = filename.split('.')[-1].lower()
        mime_type = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 
                    'mp4': 'video/mp4', 'mov': 'video/mp4'}.get(ext, 'application/octet-stream')
        return send_file(io.BytesIO(decrypted_data), mimetype=mime_type)
    except Exception as e:
        app.logger.error(f"Errore decrittografia per '{filename}': {e}")
        return "Errore durante la decrittografia.", 500

@app.route('/prepare-zip', methods=['POST'])
def prepare_zip():
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
    
    data = request.get_json()
    filenames = data.get('filenames')
    if not filenames: 
        return jsonify({"error": "Nessun file selezionato"}), 400
    
    task_id = str(uuid.uuid4())
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    ZIP_TASKS[task_id] = {'status': 'starting', 'progress': 0, 'filename': None}
    
    # Avvia la creazione dello ZIP in un thread separato
    threading.Thread(target=do_create_zip, args=(
        task_id, filenames, user_folder, app.config['TEMP_ZIP_FOLDER'], session['api_key']
    )).start()

    app.logger.info(f"Avviato task di zippatura {task_id} per {session['username']}")
    return jsonify({"task_id": task_id})

@app.route('/zip-progress/<task_id>')
def zip_progress(task_id):
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
    task_info = ZIP_TASKS.get(task_id, {'status': 'not_found', 'progress': 0})
    return jsonify(task_info)

@app.route('/download-zip/<filename>')
def download_zip(filename):
    if 'username' not in session: 
        return "Accesso negato", 403
    
    # Sicurezza: Mitigazione Path Traversal
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

# --- ROTTE CESTINO ---

@app.route('/trash')
def trash_view():
    if 'username' not in session: 
        return redirect(url_for('home'))
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

@app.route('/trash/<filename>', methods=['POST'])
def trash_file(filename):
    """Route per cestinare un singolo file."""
    if 'username' not in session:
        return jsonify({"error": "Accesso negato", "success": False}), 403
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    
    # Sicurezza: verifica che il file sia nella cartella dell'utente
    safe_user_folder = os.path.abspath(user_folder)
    safe_filepath = os.path.abspath(os.path.join(safe_user_folder, filename))
    
    if not safe_filepath.startswith(safe_user_folder):
        app.logger.warning(f"Tentativo di Path Traversal da {session['username']} per cestinare '{filename}'")
        return jsonify({"error": "Accesso non autorizzato", "success": False}), 403
    
    if not os.path.exists(safe_filepath):
        app.logger.warning(f"Tentativo di cestinare file non esistente '{filename}' da {session['username']}")
        return jsonify({"error": "File non trovato", "success": False}), 404
    
    try:
        with get_dynamic_executor() as executor:
            executor.submit(do_trash_item, user_folder, filename).result()
        
        app.logger.info(f"File '{filename}' cestinato con successo per l'utente {session['username']}")
        return jsonify({'success': True, 'message': f'File {filename} spostato nel cestino'})
    except Exception as e:
        app.logger.error(f"Errore durante lo spostamento nel cestino del file '{filename}' per {session['username']}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/trash/batch', methods=['POST'])
def trash_batch():
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato", "success": False}), 403
    data = request.get_json()
    filenames = data.get('filenames')
    if not isinstance(filenames, list): 
        return jsonify({"error": "Input non valido", "success": False}), 400

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    errors = []
    with get_dynamic_executor() as executor:
        futures = {executor.submit(do_trash_item, user_folder, f): f for f in filenames}
        for future in as_completed(futures):
            try: 
                future.result()
            except Exception as e: 
                errors.append(f"Errore su {futures[future]}: {e}")
    
    if errors:
        app.logger.error(f"Errori durante il batch trash per {session['username']}: {errors}")
        return jsonify({'success': False, 'error': '. '.join(errors)}), 500
    return jsonify({'success': True})

@app.route('/restore/<filename>', methods=['POST'])
def restore_item(filename):
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
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
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
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
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    try:
        do_empty_trash(user_folder)
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"Errore svuotamento cestino per {session['username']}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/find_duplicates_server', methods=['POST'])
def find_duplicates_server():
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    media_files = [os.path.join(user_folder, f) for f in os.listdir(user_folder) 
                  if os.path.isfile(os.path.join(user_folder, f)) and 
                  f.lower().endswith(('.jpg', '.jpeg', '.png', '.mp4', '.mov'))]
    if len(media_files) < 2: 
        return jsonify({"duplicates": []})
    
    hashes = {}
    with get_dynamic_executor() as executor:
        future_to_file = {executor.submit(calculate_file_hash, fp, session['api_key']): fp for fp in media_files}
        for future in as_completed(future_to_file):
            filename, file_hash = future.result()
            if file_hash:
                if file_hash not in hashes: 
                    hashes[file_hash] = []
                hashes[file_hash].append(filename)
                
    duplicates = [files for files in hashes.values() if len(files) > 1]
    return jsonify({"duplicates": duplicates})

# --- ROTTE API 2FA ---

@app.route('/api/2fa/initiate', methods=['POST'])
def initiate_2fa():
    """Inizia processo 2FA."""
    if 'username' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    username = session['username']
    browser_info = get_browser_fingerprint(request)
    browser_id = session.get('browser_id', hashlib.sha256(
        json.dumps(browser_info, sort_keys=True).encode()).hexdigest())
    
    # Se già fidato
    if is_trusted_browser(username, browser_id):
        session.pop('needs_2fa', None)
        return jsonify({"status": "already_trusted"})
    
    # Crea richiesta pendente
    request_id = str(uuid.uuid4())
    expiration = time.time() + 600  # 10 minuti
    
    PENDING_LOGINS[request_id] = {
        'username': username,
        'browser_info': browser_info,
        'browser_id': browser_id,
        'created_at': time.time(),
        'expires_at': expiration,
        'status': 'pending'
    }
    
    # Notifica browser fidati
    socketio.emit('new_login_request', {
        'request_id': request_id,
        'username': username,
        'browser_info': browser_info,
        'time': datetime.now().isoformat()
    }, room=username)
    
    app.logger.info(f"2FA richiesto per {username}, request_id: {request_id}")
    
    return jsonify({
        "status": "pending",
        "request_id": request_id,
        "expires_at": expiration
    })

@app.route('/api/2fa/check-and-complete/<request_id>', methods=['GET'])
def check_and_complete_2fa(request_id):
    """Controlla lo stato del 2FA e completa il login se approvato."""
    if request_id not in PENDING_LOGINS:
        return jsonify({"error": "Invalid request ID"}), 404
    
    login_request = PENDING_LOGINS[request_id]
    
    # Verifica che sia l'utente corretto
    if session.get('pending_username') != login_request['username']:
        return jsonify({"error": "Unauthorized"}), 403
    
    # Verifica scadenza
    if login_request['expires_at'] < time.time():
        login_request['status'] = 'expired'
        # Pulisci sessione pendente
        session.pop('pending_username', None)
        session.pop('pending_api_key', None)
        session.pop('browser_info', None)
        return jsonify({
            "status": "expired",
            "redirect": url_for('home')
        })
    
    # Se approvato, completa il login
    if login_request['status'] == 'approved':
        session['username'] = session.pop('pending_username')
        session['api_key'] = session.pop('pending_api_key')
        
        # Se era stato richiesto di fidarsi del browser
        if login_request.get('trust_browser', False):
            browser_id = login_request['browser_id']
            username = session['username']
            if username not in TRUSTED_BROWSERS:
                TRUSTED_BROWSERS[username] = {}
            TRUSTED_BROWSERS[username][browser_id] = login_request['browser_info']
            app.logger.info(f"Browser aggiunto ai fidati per {username}")
        
        # Pulisci la richiesta
        del PENDING_LOGINS[request_id]
        
        app.logger.info(f"Login completato con 2FA per {session['username']}")
        
        return jsonify({
            "status": "approved",
            "redirect": url_for('home')
        })
    
    # Se rifiutato
    if login_request['status'] == 'rejected':
        # Pulisci sessione pendente
        session.pop('pending_username', None)
        session.pop('pending_api_key', None)
        session.pop('browser_info', None)
        
        # Pulisci la richiesta
        del PENDING_LOGINS[request_id]
        
        return jsonify({
            "status": "rejected",
            "redirect": url_for('home'),
            "message": "Accesso rifiutato dall'amministratore"
        })
    
    # Ancora in attesa
    return jsonify({
        "status": "pending",
        "expires_at": login_request['expires_at']
    })

@app.route('/api/2fa/approve', methods=['POST'])
def approve_login():
    """Approva richiesta 2FA."""
    if 'username' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    data = request.get_json()
    request_id = data.get('request_id')
    
    if request_id not in PENDING_LOGINS:
        return jsonify({"error": "Invalid request ID"}), 404
    
    login_request = PENDING_LOGINS[request_id]
    
    # Verifica permessi
    if session['username'] != login_request['username']:
        return jsonify({"error": "Unauthorized"}), 403
    
    # Controlla se già processato
    if login_request['status'] != 'pending':
        return jsonify({"error": "Request already processed"}), 400
    
    # Approva la richiesta
    login_request['status'] = 'approved'
    login_request['approved_at'] = time.time()
    login_request['approved_by'] = session.get('browser_id', 'unknown')
    login_request['trust_browser'] = data.get('trust_browser', False)
    
    # Notifica il browser in attesa
    socketio.emit('login_approved', {
        'request_id': request_id,
        'trust_browser': login_request['trust_browser']
    }, room=request_id)
    
    app.logger.info(f"Login approvato per richiesta {request_id} (trust: {login_request['trust_browser']})")
    
    return jsonify({
        "status": "approved",
        "message": "Login approvato con successo"
    })

@app.route('/api/2fa/reject', methods=['POST'])
def reject_login():
    """Rifiuta richiesta 2FA."""
    if 'username' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    data = request.get_json()
    request_id = data.get('request_id')
    
    if request_id not in PENDING_LOGINS:
        return jsonify({"error": "Invalid request ID"}), 404
    
    login_request = PENDING_LOGINS[request_id]
    
    if session['username'] != login_request['username']:
        return jsonify({"error": "Unauthorized"}), 403
    
    login_request['status'] = 'rejected'
    login_request['rejected_at'] = time.time()
    
    # Notifica browser
    socketio.emit('login_rejected', {
        'request_id': request_id
    }, room=request_id)
    
    app.logger.warning(f"2FA rifiutato per richiesta {request_id}")
    
    return jsonify({"status": "rejected"})

@app.route('/api/2fa/status/<request_id>', methods=['GET'])
def check_2fa_status(request_id):
    """Controlla stato richiesta 2FA."""
    if request_id not in PENDING_LOGINS:
        return jsonify({"error": "Invalid request ID"}), 404
    
    login_request = PENDING_LOGINS[request_id]
    
    # Verifica scadenza
    if login_request['expires_at'] < time.time():
        login_request['status'] = 'expired'
    
    return jsonify({
        "status": login_request['status'],
        "expires_at": login_request['expires_at']
    })

@app.route('/api/2fa/cancel', methods=['POST'])
def cancel_2fa():
    """Annulla una richiesta 2FA in corso."""
    data = request.get_json()
    request_id = data.get('request_id')
    
    if request_id in PENDING_LOGINS:
        login_request = PENDING_LOGINS[request_id]
        
        # Verifica che sia l'utente corretto
        if (session.get('pending_username') == login_request['username'] or 
            session.get('username') == login_request['username']):
            
            login_request['status'] = 'cancelled'
            
            # Notifica eventuali listener
            socketio.emit('login_cancelled', {
                'request_id': request_id
            }, room=login_request['username'])
            
            # Pulisci sessione pendente
            session.pop('pending_username', None)
            session.pop('pending_api_key', None)
            session.pop('browser_info', None)
            
            # Rimuovi la richiesta dopo un breve delay
            def cleanup():
                time.sleep(2)
                if request_id in PENDING_LOGINS:
                    del PENDING_LOGINS[request_id]
            
            threading.Thread(target=cleanup, daemon=True).start()
            
            app.logger.info(f"Richiesta 2FA {request_id} annullata")
            
            return jsonify({"status": "cancelled"})
    
    return jsonify({"error": "Request not found"}), 404

@app.route('/api/2fa/trusted-browsers', methods=['GET'])
def get_trusted_browsers():
    """Ottiene lista browser fidati."""
    if 'username' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    username = session['username']
    browsers = []
    
    if username in TRUSTED_BROWSERS:
        for browser_id, info in TRUSTED_BROWSERS[username].items():
            browsers.append({
                'id': browser_id[:8] + '...',
                'browser': info.get('browser', 'Unknown'),
                'platform': info.get('platform', 'Unknown'),
                'last_used': info.get('last_used', 0),
                'first_seen': info.get('first_seen', 0)
            })
    
    return jsonify({"browsers": browsers})

@app.route('/api/2fa/remove-browser', methods=['POST'])
def remove_trusted_browser():
    """Rimuove un browser dai fidati."""
    if 'username' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    data = request.get_json()
    browser_id_prefix = data.get('browser_id')
    
    username = session['username']
    if username in TRUSTED_BROWSERS:
        # Trova browser con prefisso corrispondente
        for bid in list(TRUSTED_BROWSERS[username].keys()):
            if bid.startswith(browser_id_prefix.replace('...', '')):
                del TRUSTED_BROWSERS[username][bid]
                app.logger.info(f"Rimosso browser {browser_id_prefix} per {username}")
                return jsonify({"status": "removed"})
    
    return jsonify({"error": "Browser not found"}), 404

if __name__ == '__main__':
    # Avvia thread di pulizia
    cleaner_thread = threading.Thread(target=background_cleaner, daemon=True)
    cleaner_thread.start()
    
    # Avvia server con WebSocket
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)