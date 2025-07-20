# server.py (versione aggiornata - limite dimensioni rimosso, con pulizia automatica del cestino dopo 30 giorni e temp_zips dopo 1 giorno)

import os
import secrets
import hashlib
import io
import string
import random
import psutil
import uuid
import zipfile
import shutil  # --- NUOVO: Necessario per svuotare il cestino
import time  # --- NUOVO: Per gestione timestamp e sleep
import threading  # --- NUOVO: Per thread di pulizia in background
from flask import Flask, render_template, request, redirect, url_for, session, send_file, jsonify, send_from_directory, after_this_request
from werkzeug.utils import secure_filename
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from concurrent.futures import ThreadPoolExecutor, as_completed
import json  # <-- AGGIUNGI QUESTA RIGA

app = Flask(__name__)  # --- MODIFICA: Corretto __name__
app.secret_key = secrets.token_hex(16)
app.config['UPLOAD_FOLDER'] = 'user_media'
app.config['TEMP_ZIP_FOLDER'] = 'temp_zips'
# RIMOSSO: app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024 # 500MB (ora non c'è limite esplicito sulle dimensioni)

# Creazione delle cartelle necessarie
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['TEMP_ZIP_FOLDER'], exist_ok=True)
if not os.path.exists('users.txt'):
    open('users.txt', 'a').close()

# Dizionario per tenere traccia dei processi di zippatura in background
ZIP_TASKS = {}

# --- HELPERS DI GESTIONE THREAD E CPU ---

def get_dynamic_executor() -> ThreadPoolExecutor:
    cpu_percent = psutil.cpu_percent(interval=None)
    if cpu_percent > 80:
        max_workers = 1
    elif cpu_percent > 60:
        max_workers = max(1, os.cpu_count() // 2)
    else:
        max_workers = os.cpu_count()
    return ThreadPoolExecutor(max_workers=max_workers)

# --- FUNZIONI DI CRITTOGRAFIA E UTENTI ---
# (Nessuna modifica in questa sezione, la lascio per completezza)
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

# --- LOGICA DI BUSINESS (ESEGUITA IN THREAD SEPARATI) ---

def do_registration(username, api_key, upload_folder):
    if find_user(username): raise ValueError("Username già esistente!")
    save_user(username, hash_key(api_key))
    user_folder = os.path.join(upload_folder, username)
    os.makedirs(user_folder, exist_ok=True)
    os.makedirs(os.path.join(user_folder, 'trash'), exist_ok=True) # --- NUOVO: Crea la cartella trash
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
        except Exception as e: print(f"Errore impostando mtime per {filepath}: {e}")
    return True

def do_media_decryption(filepath, api_key):
    with open(filepath, 'rb') as f: encrypted_data = f.read()
    return decrypt_file(encrypted_data, api_key)

# --- NUOVE FUNZIONI PER IL CESTINO ---
def do_trash_item(user_folder, filename):
    """Sposta un file nel cestino e aggiorna il timestamp per tracciare il tempo di permanenza."""
    source_path = os.path.join(user_folder, filename)
    trash_folder = os.path.join(user_folder, 'trash')
    destination_path = os.path.join(trash_folder, filename)
    
    os.makedirs(trash_folder, exist_ok=True)
    os.rename(source_path, destination_path)
    
    # --- NUOVO: Imposta timestamp corrente per tracciare quando è stato spostato nel cestino
    current_time = time.time()
    os.utime(destination_path, (current_time, current_time))
    
    return True

def do_restore_item(user_folder, filename):
    """Ripristina un file dal cestino."""
    trash_folder = os.path.join(user_folder, 'trash')
    source_path = os.path.join(trash_folder, filename)
    destination_path = os.path.join(user_folder, filename)
    
    os.rename(source_path, destination_path)
    return True

def do_permanent_delete(user_folder, filename):
    """Elimina definitivamente un file dal cestino."""
    filepath = os.path.join(user_folder, 'trash', filename)
    os.remove(filepath)
    return True

def do_empty_trash(user_folder):
    """Svuota l'intero cestino di un utente."""
    trash_folder = os.path.join(user_folder, 'trash')
    if os.path.exists(trash_folder):
        shutil.rmtree(trash_folder)
        os.makedirs(trash_folder) # Ricrea la cartella vuota
    return True
# --- FINE NUOVE FUNZIONI ---

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

# --- NUOVA FUNZIONE PER PULIZIA AUTOMATICA ---
def clean_trash_and_zips():
    now = time.time()
    
    # Pulisci temp_zips (file più vecchi di 1 giorno)
    temp_folder = app.config['TEMP_ZIP_FOLDER']
    for f in os.listdir(temp_folder):
        filepath = os.path.join(temp_folder, f)
        if os.path.isfile(filepath) and os.path.getmtime(filepath) < now - 86400:  # 1 giorno in secondi
            try:
                os.remove(filepath)
                print(f"Eliminato ZIP temporaneo: {filepath}")
            except Exception as e:
                print(f"Errore eliminando {filepath}: {e}")
    
    # Pulisci trash per tutti gli utenti (file più vecchi di 30 giorni)
    upload_folder = app.config['UPLOAD_FOLDER']
    for user in os.listdir(upload_folder):
        user_folder = os.path.join(upload_folder, user)
        if os.path.isdir(user_folder):
            trash_folder = os.path.join(user_folder, 'trash')
            if os.path.exists(trash_folder):
                for tf in os.listdir(trash_folder):
                    tfilepath = os.path.join(trash_folder, tf)
                    if os.path.isfile(tfilepath) and os.path.getmtime(tfilepath) < now - 30 * 86400:  # 30 giorni in secondi
                        try:
                            os.remove(tfilepath)
                            print(f"Eliminato file dal cestino di {user}: {tf}")
                        except Exception as e:
                            print(f"Errore eliminando {tfilepath}: {e}")

def background_cleaner():
    while True:
        clean_trash_and_zips()
        time.sleep(3600)  # Esegui ogni ora

# --- ROTTE FLASK ---

@app.route('/')
def home():
    if 'username' in session:
        user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
        media_files_details = []
        if os.path.exists(user_folder):
            valid_extensions = ('.jpg', '.jpeg', '.png', '.mp4', '.mov')
            # --- MODIFICA: Assicurati di leggere solo file, ignorando la cartella 'trash'
            filenames = [f for f in os.listdir(user_folder) 
                         if os.path.isfile(os.path.join(user_folder, f)) and f.lower().endswith(valid_extensions)]
            for f in filenames:
                filepath = os.path.join(user_folder, f)
                media_files_details.append({ 'filename': f, 'timestamp': os.path.getmtime(filepath) })
            media_files_details.sort(key=lambda x: x['timestamp'], reverse=True)
        return render_template('gallery.html', media_files=media_files_details)
    return render_template('login.html')

# SOSTITUISCI LA VECCHIA ROTTA /register CON QUESTA
@app.route('/register', methods=['POST'])
def register():
    username = request.form['username'].strip()
    key_type = request.form.get('key_type', 'generate')
    api_key = ""

    if not username:
        return "Username non valido!", 400

    if find_user(username):
        return "Username già esistente!", 409

    if key_type == 'custom':
        api_key = request.form.get('custom_key')
        if not api_key or len(api_key) < 8:
            return "La chiave personalizzata deve avere almeno 8 caratteri.", 400
    else:
        api_key = generate_api_key()

    try:
        # 1. Esegui la registrazione (salva l'hash della chiave sul server)
        with get_dynamic_executor() as executor:
            final_key = executor.submit(do_registration, username, api_key, app.config['UPLOAD_FOLDER']).result()

        # 2. Prepara il file di autenticazione da far scaricare all'utente
        session_id = str(uuid.uuid4())
        timestamp = time.time()
        
        # Il file contiene la CHIAVE REALE, non l'hash, per permettere la crittografia dei file
        auth_data = {
            "username": username,
            "api_key": final_key,
            "session_id": session_id,
            "created_at": timestamp,
            "hash_of_key": hash_key(final_key)
        }

        # 3. Crea un file JSON in memoria e invialo all'utente per il download
        buffer = io.BytesIO()
        buffer.write(json.dumps(auth_data, indent=2).encode('utf-8'))
        buffer.seek(0)
        
        download_name = f'photocloud_auth_{secure_filename(username)}.json'

        return send_file(
            buffer,
            as_attachment=True,
            download_name=download_name,
            mimetype='application/json'
        )

    except Exception as e:
        return str(e), 400

# SOSTITUISCI LA VECCHIA ROTTA /login CON QUESTA
@app.route('/login', methods=['POST'])
def login():
    if 'auth_file' not in request.files:
        return "File di autenticazione non trovato nel form.", 400

    auth_file = request.files['auth_file']
    if auth_file.filename == '':
        return "Nessun file selezionato.", 400

    try:
        # 1. Leggi e analizza il file JSON caricato
        content = auth_file.read().decode('utf-8')
        auth_data = json.loads(content)
        
        username = auth_data.get('username')
        api_key = auth_data.get('api_key')

        if not username or not api_key:
            return "File di autenticazione non valido o corrotto.", 400

        # 2. Verifica le credenziali confrontando l'hash della chiave con quello memorizzato
        with get_dynamic_executor() as executor:
            is_valid = executor.submit(do_login, username, api_key).result()
        
        # 3. Se valide, crea la sessione utente
        if is_valid:
            session['username'] = username
            session['api_key'] = api_key # Salva la chiave reale per la crittografia dei file
            return redirect(url_for('home'))
        else:
            return "Credenziali non valide! Il file potrebbe essere obsoleto o non corrispondere a un utente registrato.", 401

    except json.JSONDecodeError:
        return "Formato del file non valido. Assicurati di caricare il file JSON corretto.", 400
    except Exception as e:
        return f"Si è verificato un errore durante l'autenticazione: {str(e)}", 500

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/upload', methods=['POST'])
def upload():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    files = request.files.getlist("file[]")
    timestamps = request.form.getlist("timestamp[]")
    if not files or files[0].filename == '': return jsonify({"error": "Nessun file selezionato"}), 400
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    api_key = session['api_key']
    try:
        with get_dynamic_executor() as executor:
            futures = []
            for i, file in enumerate(files):
                original_filename = secure_filename(file.filename)
                file_data = file.read()
                last_modified = timestamps[i] if i < len(timestamps) else None
                futures.append(executor.submit(
                    do_upload, file_data, api_key, user_folder, original_filename, last_modified
                ))
            for future in as_completed(futures): future.result()
    except Exception as e: return jsonify({"error": f"Errore durante il caricamento: {str(e)}"}), 500
    return jsonify({"success": True, "message": f"{len(files)} file caricati con successo."})

@app.route('/media/<filename>')
def media(filename):
    if 'username' not in session: return "Accesso negato", 403
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    from_trash = request.args.get('from_trash') == 'true'
    
    if from_trash:
        base_path = os.path.join(user_folder, 'trash')
    else:
        base_path = user_folder

    # --- MITIGATION FOR PATH TRAVERSAL ---
    
    # 1. Get the absolute, canonical path of the intended base directory.
    safe_base_path = os.path.abspath(base_path)
    
    # 2. Construct the requested file path and get its absolute, canonical path.
    filepath = os.path.join(safe_base_path, filename)
    safe_filepath = os.path.abspath(filepath)

    # 3. Check if the requested file's path starts with the base directory's path.
    #    This ensures the file is *within* the allowed directory.
    if not safe_filepath.startswith(safe_base_path):
        return "Accesso non autorizzato.", 403
        
    # --- END MITIGATION ---

    if not os.path.exists(safe_filepath): return "File non trovato", 404

    try:
        # Use the validated path from now on
        with get_dynamic_executor() as executor:
            decrypted_data = executor.submit(do_media_decryption, safe_filepath, session['api_key']).result()
    except Exception as e:
        return f"Errore durante la decrittografia: {str(e)}", 500
    
    ext = filename.split('.')[-1].lower()
    mime_type = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'mp4': 'video/mp4', 'mov': 'video/mp4'}.get(ext, 'application/octet-stream')
    return send_file(io.BytesIO(decrypted_data), mimetype=mime_type)

# --- MODIFICA: La vecchia rotta /delete diventa /trash per spostare nel cestino ---
@app.route('/trash/<filename>', methods=['POST'])
def trash_item(filename):
    if 'username' not in session: return jsonify({"error": "Accesso negato", "success": False}), 403

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    filepath = os.path.join(user_folder, filename)
    
    safe_user_folder = os.path.abspath(user_folder)
    safe_filepath = os.path.abspath(filepath)

    if not safe_filepath.startswith(safe_user_folder) or 'trash' in safe_filepath:
        return jsonify({"error": "Percorso non valido", "success": False}), 400
        
    if os.path.exists(safe_filepath):
        try:
            with get_dynamic_executor() as executor:
                executor.submit(do_trash_item, user_folder, filename).result()
            return jsonify({'success': True, 'filename': filename})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
            
    return jsonify({'success': False, 'error': 'File non trovato'}), 404

# (Nessuna modifica a /find_duplicates_server e alle rotte ZIP)
@app.route('/find_duplicates_server', methods=['POST'])
def find_duplicates_server():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    if not os.path.exists(user_folder): return jsonify({"error": "Cartella utente non trovata"}), 404
    media_files = [os.path.join(user_folder, f) for f in os.listdir(user_folder) if os.path.isfile(os.path.join(user_folder, f)) and f.lower().endswith(('.jpg', '.jpeg', '.png', '.mp4', '.mov'))]
    if len(media_files) < 2: return jsonify({"duplicates": []})
    hashes = {}
    with get_dynamic_executor() as executor:
        future_to_file = {executor.submit(calculate_file_hash, filepath, session['api_key']): filepath for filepath in media_files}
        for future in as_completed(future_to_file):
            filename, file_hash = future.result()
            if file_hash:
                if file_hash not in hashes: hashes[file_hash] = []
                hashes[file_hash].append(filename)
    duplicates = [files for files in hashes.values() if len(files) > 1]
    return jsonify({"duplicates": duplicates})

@app.route('/prepare-zip', methods=['POST'])
def prepare_zip():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    data = request.get_json()
    filenames = data.get('filenames')
    if not filenames: return jsonify({"error": "Nessun file selezionato"}), 400
    task_id = str(uuid.uuid4())
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    ZIP_TASKS[task_id] = {'status': 'starting', 'progress': 0, 'filename': None}
    with ThreadPoolExecutor(max_workers=1) as executor:
        executor.submit(do_create_zip, task_id, filenames, user_folder, app.config['TEMP_ZIP_FOLDER'], session['api_key'])
    return jsonify({"task_id": task_id})

@app.route('/zip-progress/<task_id>')
def zip_progress(task_id):
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    task_info = ZIP_TASKS.get(task_id, {'status': 'not_found', 'progress': 0})
    return jsonify(task_info)

@app.route('/download-zip/<filename>')
def download_zip(filename):
    if 'username' not in session: return "Accesso negato", 403
    directory = os.path.abspath(app.config['TEMP_ZIP_FOLDER'])
    filepath = os.path.join(directory, filename)
    if not os.path.normpath(filepath).startswith(directory): return "Accesso non autorizzato al file", 403
    if not os.path.exists(filepath): return "File non trovato", 404
    @after_this_request
    def remove_file(response):
        try:
            os.remove(filepath)
            task_id = filename.split('.')[0]
            if task_id in ZIP_TASKS: del ZIP_TASKS[task_id]
        except Exception as e: app.logger.error(f"Errore durante l'eliminazione del file ZIP {filename}: {e}")
        return response
    return send_from_directory(directory, filename, as_attachment=True)

# --- NUOVE ROTTE PER IL CESTINO ---
@app.route('/trash')
def trash_view():
    if 'username' not in session: return redirect(url_for('home'))
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    trash_folder = os.path.join(user_folder, 'trash')
    trashed_files = []
    
    if os.path.exists(trash_folder):
        valid_extensions = ('.jpg', '.jpeg', '.png', '.mp4', '.mov')
        filenames = [f for f in os.listdir(trash_folder) if f.lower().endswith(valid_extensions)]
        for f in filenames:
            filepath = os.path.join(trash_folder, f)
            trashed_files.append({ 'filename': f, 'timestamp': os.path.getmtime(filepath) })
        trashed_files.sort(key=lambda x: x['timestamp'], reverse=True)
        
    return render_template('trash.html', trashed_files=trashed_files)

@app.route('/trash/batch', methods=['POST'])
def trash_batch():
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato", "success": False}), 403

    data = request.get_json()
    filenames = data.get('filenames')
    
    if not filenames or not isinstance(filenames, list):
        return jsonify({"error": "Nessun file valido selezionato", "success": False}), 400

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    errors = []
    
    with get_dynamic_executor() as executor:
        futures = {executor.submit(do_trash_item, user_folder, f): f for f in filenames}
        for future in as_completed(futures):
            filename = futures[future]
            try:
                future.result()
            except Exception as e:
                errors.append(f"Errore su {filename}: {str(e)}")
    
    if errors:
        return jsonify({'success': False, 'error': '. '.join(errors)}), 500

    return jsonify({'success': True})

@app.route('/restore/<filename>', methods=['POST'])
def restore_item(filename):
    if 'username' not in session: return jsonify({"error": "Accesso negato", "success": False}), 403
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    # Logica di sicurezza per evitare path traversal
    trash_path = os.path.abspath(os.path.join(user_folder, 'trash', filename))
    if not trash_path.startswith(os.path.abspath(os.path.join(user_folder, 'trash'))):
        return jsonify({"error": "Percorso non valido", "success": False}), 400

    try:
        do_restore_item(user_folder, filename)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/delete_permanent/<filename>', methods=['POST'])
def delete_permanent_item(filename):
    if 'username' not in session: return jsonify({"error": "Accesso negato", "success": False}), 403
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    # Logica di sicurezza per evitare path traversal
    trash_path = os.path.abspath(os.path.join(user_folder, 'trash', filename))
    if not trash_path.startswith(os.path.abspath(os.path.join(user_folder, 'trash'))):
        return jsonify({"error": "Percorso non valido", "success": False}), 400

    try:
        do_permanent_delete(user_folder, filename)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/empty_trash', methods=['POST'])
def empty_trash():
    if 'username' not in session: return jsonify({"error": "Accesso negato", "success": False}), 403
    
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    try:
        do_empty_trash(user_folder)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# --- FINE NUOVE ROTTE ---

if __name__ == '__main__':  # --- MODIFICA: Corretto __name__
    # Avvia il thread di pulizia in background
    threading.Thread(target=background_cleaner, daemon=True).start()
    app.run(host='0.0.0.0', port=5000, debug=True)