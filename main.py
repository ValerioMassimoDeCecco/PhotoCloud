import os
import secrets
import hashlib
import io
import string
import random
import psutil
import uuid
import zipfile
# import json # Rimosso: non usiamo più clients.json
from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify, send_from_directory, after_this_request, session # Aggiunto 'session'
from werkzeug.utils import secure_filename
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
app.secret_key = secrets.token_hex(16) # Riattivato: usiamo sessioni Flask basate su cookie
app.config['UPLOAD_FOLDER'] = 'user_media'
app.config['TEMP_ZIP_FOLDER'] = 'temp_zips'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024   # 500MB

# Nuovi file di persistenza (USERS_FILE rimane, SESSIONS_FILE e CLIENTS_FILE rimossi)
USERS_FILE = 'users.txt' # username_hash:api_key_hash

# Creazione delle cartelle e file necessari
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['TEMP_ZIP_FOLDER'], exist_ok=True)
if not os.path.exists(USERS_FILE):
    open(USERS_FILE, 'a').close()
# Rimosso: if not os.path.exists(SESSIONS_FILE): open(SESSIONS_FILE, 'a').close()
# Rimosso: if not os.path.exists(CLIENTS_FILE): with open(CLIENTS_FILE, 'w') as f: json.dump({}, f)

# Dizionario per tenere traccia dei processi di zippatura in background
ZIP_TASKS = {}

# --- HELPERS DI GESTIONE THREAD E CPU ---

def get_dynamic_executor() -> ThreadPoolExecutor:
    """
    Crea un ThreadPoolExecutor con un numero di worker che si adatta dinamicamente
    al carico attuale della CPU.
    """
    cpu_percent = psutil.cpu_percent(interval=None)
    
    if cpu_percent > 80:
        max_workers = 1
    elif cpu_percent > 60:
        max_workers = max(1, os.cpu_count() // 2)
    else:
        max_workers = os.cpu_count()
        
    return ThreadPoolExecutor(max_workers=max_workers)

# --- FUNZIONI DI CRITTOGRAFIA E UTENTI ---
def generate_random_string(length=32):
    characters = string.ascii_letters + string.digits
    return ''.join(random.SystemRandom().choice(characters) for _ in range(length))

def generate_api_key(length=32):
    characters = string.ascii_letters + string.digits + string.punctuation
    while True:
        key = ''.join(random.SystemRandom().choice(characters) for _ in range(length))
        if (any(c.islower() for c in key) and any(c.isupper() for c in key) and
            any(c.isdigit() for c in key) and any(c in string.punctuation for c in key)):
            return key

def hash_data(data):
    """
    Genera un hash SHA256 dei dati forniti.
    """
    return hashlib.sha256(data.encode()).hexdigest()

def verify_hash(data, stored_hash):
    """
    Verifica se i dati forniti corrispondono a un hash memorizzato.
    """
    return hash_data(data) == stored_hash

def derive_key(key: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
        backend=default_backend()
    )
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

def save_user(hashed_username, key_hash):
    """
    Salva l'hash dell'username e l'hash della chiave API nel file degli utenti.
    """
    with open(USERS_FILE, 'a') as f:
        f.write(f"{hashed_username}:{key_hash}\n")

def find_user(username):
    """
    Trova l'hash della chiave API di un utente dato il suo username.
    L'username viene prima hashato per il confronto.
    """
    hashed_username_to_find = hash_data(username)
    if not os.path.exists(USERS_FILE):
        return None
    with open(USERS_FILE, 'r') as f:
        for line in f.readlines():
            parts = line.strip().split(':')
            if len(parts) == 2:
                stored_hashed_username, stored_key_hash = parts
                if stored_hashed_username == hashed_username_to_find:
                    return stored_key_hash
    return None

# --- NUOVE FUNZIONI DI GESTIONE CLIENTS E SESSIONS (RIMOSSE/SOSTITUITE) ---
# Rimosso: load_clients, save_clients, add_session, remove_session, find_session_client_id_hash

# Decorator per la verifica dell'autenticazione
def login_required(f):
    def wrap(*args, **kwargs):
        if 'username' not in session:
            print("User not in session, redirecting to home.")
            return redirect(url_for('home'))
        
        # L'API key è necessaria per le operazioni di crittografia/decrittografia,
        # e non viene salvata nella sessione. Deve essere fornita dal client.
        # Per le rotte che richiedono la api_key, la si recupera dalla richiesta.
        # Non è più necessaria `request.current_client_id` o `request.current_session_id`.
        
        return f(*args, **kwargs)
    wrap.__name__ = f.__name__ # Necessario per Flask per distinguere le rotte
    return wrap

# --- LOGICA DI BUSINESS (ESEGUITA IN THREAD SEPARATI) ---

def do_registration(username, upload_folder, key_type, custom_key=None):
    """
    Gestisce la logica di registrazione di un nuovo utente.
    """
    if find_user(username):
        raise ValueError("Username già esistente!")

    if key_type == 'generate':
        key_to_save = generate_api_key()
    elif key_type == 'custom':
        if not custom_key or len(custom_key) < 8:
            raise ValueError("La chiave personalizzata deve avere almeno 8 caratteri.")
        key_to_save = custom_key
    else:
        raise ValueError("Tipo di chiave non valido.")

    # Hash dell'username prima di salvarlo
    hashed_username = hash_data(username)
    save_user(hashed_username, hash_data(key_to_save)) # Salva l'hash dell'username e l'hash della chiave
    user_folder = os.path.join(upload_folder, username) # La cartella dell'utente continua a usare l'username in chiaro
    os.makedirs(user_folder, exist_ok=True)
    
    # Restituisce la chiave solo se è stata generata, altrimenti None
    return key_to_save if key_type == 'generate' else None

def do_login(username, api_key): # Rimosso client_id
    """
    Gestisce la logica di login di un utente.
    """
    stored_hash = find_user(username)
    if not (stored_hash and verify_hash(api_key, stored_hash)):
        return False # Login fallito
    
    # Login riuscito: Imposta l'username nella sessione di Flask
    session['username'] = username 
    
    return True # Ritorna solo il successo del login

def do_upload(file_data, api_key, user_folder, original_filename, client_mtime_sec):
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

    # Imposta la data di ultima modifica del file usando il timestamp del client
    if client_mtime_sec:
        try:
            # os.utime imposta (access_time, modified_time) in secondi
            os.utime(filepath, (client_mtime_sec, client_mtime_sec))
        except Exception as e:
            # Logga l'errore se non è possibile impostare il timestamp, ma non bloccare l'upload
            print(f"Attenzione: impossibile impostare il timestamp per {filename}. Errore: {e}")

    return True

def do_media_decryption(filepath, api_key):
    with open(filepath, 'rb') as f:
        encrypted_data = f.read()
    return decrypt_file(encrypted_data, api_key)

def do_delete(filepath):
    os.remove(filepath)
    return True

def calculate_file_hash(filepath, api_key):
    try:
        decrypted_data = do_media_decryption(filepath, api_key)
        sha256_hash = hashlib.sha256(decrypted_data).hexdigest()
        return os.path.basename(filepath), sha256_hash
    except Exception as e:
        print(f"Errore durante l'hashing di {os.path.basename(filepath)}: {e}")
        return os.path.basename(filepath), None

def do_create_zip(task_id, filenames, user_folder, temp_zip_folder, api_key):
    try:
        zip_filename = f"{task_id}.zip"
        zip_filepath = os.path.join(temp_zip_folder, zip_filename)
        total_files = len(filenames)

        with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
            for i, filename in enumerate(filenames):
                progress = int((i / total_files) * 100)
                ZIP_TASKS[task_id] = {'status': 'processing', 'progress': progress, 'filename': None}

                source_filepath = os.path.join(user_folder, filename)
                if os.path.exists(source_filepath):
                    decrypted_data = do_media_decryption(source_filepath, api_key)
                    zf.writestr(filename, decrypted_data)
        
        ZIP_TASKS[task_id] = {'status': 'complete', 'progress': 100, 'filename': zip_filename}

    except Exception as e:
        print(f"Errore durante la creazione dello ZIP (task {task_id}): {e}")
        ZIP_TASKS[task_id] = {'status': 'error', 'progress': 0, 'filename': None, 'error': str(e)}


# --- ROTTE FLASK ---
@app.route('/')
def home():
    # Se l'utente è già loggato (username in sessione), reindirizza alla galleria
    if 'username' in session:
        return redirect(url_for('gallery'))
    return render_template('login.html')

@app.route('/gallery')
@login_required
def gallery():
    username_from_session = session.get('username')
    if not username_from_session:
        # Questo caso dovrebbe essere già gestito da @login_required, ma è un fallback
        return redirect(url_for('home'))

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], username_from_session)
    media_items = []
    if os.path.exists(user_folder):
        allowed_extensions = ('.jpg', '.jpeg', '.png', '.mp4', '.mov')
        for filename in os.listdir(user_folder):
            if filename.lower().endswith(allowed_extensions):
                filepath = os.path.join(user_folder, filename)
                try:
                    timestamp = os.path.getmtime(filepath)
                    media_items.append({
                        "filename": filename,
                        "upload_date": timestamp
                    })
                except FileNotFoundError:
                    continue
    
    media_items.sort(key=lambda x: x['upload_date'], reverse=True)
    return render_template('gallery.html', media_items=media_items, username=username_from_session)

@app.route('/register', methods=['POST'])
def register():
    username = request.form.get('username', '').strip()
    key_type = request.form.get('key_type')
    custom_key = request.form.get('custom_key', '').strip()
    # Rimosso: client_id = request.form.get('client_id') 

    # Rimosso: if not client_id: return "Client ID mancante!", 400
    if not username:
        return "Username non valido!", 400
    if key_type not in ['generate', 'custom']:
        return "Scelta del tipo di chiave non valida", 400
    if key_type == 'custom' and not custom_key:
        return "La chiave personalizzata non può essere vuota", 400

    try:
        with get_dynamic_executor() as executor:
            future = executor.submit(do_registration, username, app.config['UPLOAD_FOLDER'], key_type, custom_key)
            generated_key = future.result()
        
        return render_template('key_display.html', username=username, api_key=generated_key)
            
    except ValueError as e:
        return str(e), 400
    except Exception as e:
        return f"Errore durante la registrazione: {str(e)}", 500

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username'].strip()
    api_key = request.form['api_key'].strip()
    # Rimosso: client_id = request.form.get('client_id') 

    # Rimosso: if not client_id: return jsonify({"error": "Client ID mancante."}), 400

    # Rimosso: client_id_hash = hash_data(client_id)
    # Rimosso: clients = load_clients()

    # Rimosso: if client_id_hash in clients and clients[client_id_hash].get('banned'): return jsonify({"redirect": url_for('banned')})

    with get_dynamic_executor() as executor:
        # Chiamata a do_login senza client_id
        is_valid = executor.submit(do_login, username, api_key).result()
    
    if is_valid:
        # Flask gestisce il cookie di sessione. Reindirizziamo direttamente.
        # L'username è già stato salvato in sessione da do_login.
        return jsonify({"success": True, "redirect": url_for('gallery')})
    else:
        # Rimosso: ban logic on failed login
        return jsonify({"success": False, "error": "Credenziali non valide!"}), 401

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    # Rimosso: client_id e session_id
    session.clear() # Cancella tutti i dati dalla sessione
    
    return jsonify({"success": True, "message": "Logout effettuato con successo.", "redirect": url_for('home')})

@app.route('/upload', methods=['POST'])
@login_required
def upload():
    username = session.get('username') # Ottieni username dalla sessione
    if not username:
        return jsonify({"error": "Sessione utente non valida, riprovare il login."}), 401
    
    files = request.files.getlist("file[]")
    timestamps_ms = request.form.getlist("timestamps[]")
    api_key = request.form.get('api_key') # L'API key deve essere ancora passata qui

    if not files or files[0].filename == '':
        return jsonify({"error": "Nessun file selezionato"}), 400
    
    if len(files) != len(timestamps_ms):
        return jsonify({"error": "Discordanza tra numero di file e timestamp."}), 400

    if not api_key:
        return jsonify({"error": "Chiave API mancante."}), 400

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], username)
    
    try:
        with get_dynamic_executor() as executor:
            futures = []
            for file, timestamp_str in zip(files, timestamps_ms):
                original_filename = secure_filename(file.filename)
                file_data = file.read()
                
                client_mtime_sec = float(timestamp_str) / 1000.0
                
                futures.append(executor.submit(do_upload, file_data, api_key, user_folder, original_filename, client_mtime_sec))
            
            for future in as_completed(futures):
                future.result()

    except Exception as e:
        return jsonify({"error": f"Errore durante il caricamento: {str(e)}"}), 500
    
    return jsonify({"success": True, "message": f"{len(files)} file caricati con successo."})

@app.route('/media/<filename>')
@login_required
def media(filename):
    username = session.get('username') # Ottieni username dalla sessione
    api_key = request.args.get('api_key') # API Key dalla query string (ancora necessaria)

    if not username:
        return "Sessione utente non valida, riprovare il login.", 401
    if not api_key:
        return "Chiave API mancante.", 400

    filepath = os.path.join(app.config['UPLOAD_FOLDER'], username, filename)
    if not os.path.exists(filepath): return "File non trovato", 404
    try:
        with get_dynamic_executor() as executor:
            decrypted_data = executor.submit(do_media_decryption, filepath, api_key).result()
    except Exception as e:
        return f"Errore durante la decrittografia: {str(e)}", 500
    ext = filename.split('.')[-1].lower()
    mime_type = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'mp4': 'video/mp4', 'mov': 'video/mp4'}.get(ext, 'application/octet-stream')
    return send_file(io.BytesIO(decrypted_data), mimetype=mime_type)

@app.route('/delete/<filename>', methods=['POST'])
@login_required
def delete(filename):
    username = session.get('username') # Ottieni username dalla sessione
    api_key = request.form.get('api_key') # API Key dal form (ancora necessaria)

    if not username:
        return jsonify({"error": "Sessione utente non valida, riprovare il login."}), 401
    if not api_key:
        return jsonify({"error": "Chiave API mancante."}), 400

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], username)
    filepath = os.path.join(user_folder, filename)
    if not os.path.abspath(filepath).startswith(os.path.abspath(user_folder)):
        return jsonify({"error": "Percorso non valido"}), 400
    if os.path.exists(filepath):
        try:
            with get_dynamic_executor() as executor:
                executor.submit(do_delete, filepath).result()
            return jsonify({'success': True, 'filename': filename})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    return jsonify({'success': False, 'error': 'File not found'}), 404

@app.route('/find_duplicates_server', methods=['POST'])
@login_required
def find_duplicates_server():
    username = session.get('username') # Ottieni username dalla sessione
    api_key = request.form.get('api_key') # API Key dal form (ancora necessaria)

    if not username:
        return jsonify({"error": "Sessione utente non valida, riprovare il login."}), 401
    if not api_key:
        return jsonify({"error": "Chiave API mancante."}), 400

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], username)
    if not os.path.exists(user_folder): return jsonify({"error": "Cartella utente non trovata"}), 404
    media_files = [os.path.join(user_folder, f) for f in os.listdir(user_folder) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.mp4', '.mov'))]
    if len(media_files) < 2: return jsonify({"duplicates": []})
    hashes = {}
    with get_dynamic_executor() as executor:
        future_to_file = {executor.submit(calculate_file_hash, filepath, api_key): filepath for filepath in media_files}
        for future in as_completed(future_to_file):
            filename, file_hash = future.result()
            if file_hash:
                if file_hash not in hashes: hashes[file_hash] = []
                hashes[file_hash].append(filename)
    duplicates = [files for files in hashes.values() if len(files) > 1]
    return jsonify({"duplicates": duplicates})

# --- ROTTE PER DOWNLOAD ZIP ---

@app.route('/prepare-zip', methods=['POST'])
@login_required
def prepare_zip():
    data = request.get_json()
    filenames = data.get('filenames')
    username = session.get('username') # Ottieni username dalla sessione
    api_key = data.get('api_key') # API Key dal JSON (ancora necessaria)

    if not filenames:
        return jsonify({"error": "Nessun file selezionato"}), 400
    if not username:
        return jsonify({"error": "Sessione utente non valida, riprovare il login."}), 401
    if not api_key:
        return jsonify({"error": "Chiave API mancante."}), 400

    task_id = str(uuid.uuid4())
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], username)
    
    ZIP_TASKS[task_id] = {'status': 'starting', 'progress': 0, 'filename': None}
    
    with ThreadPoolExecutor(max_workers=1) as executor:
        executor.submit(do_create_zip, task_id, filenames, user_folder, app.config['TEMP_ZIP_FOLDER'], api_key)
        
    return jsonify({"task_id": task_id})

@app.route('/zip-progress/<task_id>')
@login_required
def zip_progress(task_id):
    # Non richiede username o api_key in quanto il task_id è sufficiente
    # per identificare il progresso della zippatura, e la rotta è già protetta da login_required.
    task_info = ZIP_TASKS.get(task_id, {'status': 'not_found', 'progress': 0})
    return jsonify(task_info)

@app.route('/download-zip/<filename>')
@login_required
def download_zip(filename):
    # Non richiede username o api_key in quanto la rotta è già protetta da login_required.
    directory = os.path.abspath(app.config['TEMP_ZIP_FOLDER'])
    filepath = os.path.join(directory, filename)

    if not os.path.normpath(filepath).startswith(directory):
        return "Accesso non autorizzato al file", 403
        
    if not os.path.exists(filepath):
        return "File non trovato", 404

    @after_this_request
    def remove_file(response):
        try:
            os.remove(filepath)
            task_id = filename.split('.')[0]
            if task_id in ZIP_TASKS:
                del ZIP_TASKS[task_id]
        except Exception as e:
            app.logger.error(f"Errore durante l'eliminazione del file ZIP {filename}: {e}")
        return response

    return send_from_directory(directory, filename, as_attachment=True)

# Rimosso: @app.route('/banned')
# Rimosso: def banned(): return render_template('ban.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)