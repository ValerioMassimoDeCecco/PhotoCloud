import os
import secrets
import hashlib
import io
import string
import random
import psutil
import uuid
import zipfile
from flask import Flask, render_template, request, redirect, url_for, session, send_file, jsonify, send_from_directory, after_this_request
from werkzeug.utils import secure_filename
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)
app.config['UPLOAD_FOLDER'] = 'user_media'
app.config['TEMP_ZIP_FOLDER'] = 'temp_zips'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

# Creazione delle cartelle necessarie
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['TEMP_ZIP_FOLDER'], exist_ok=True)
if not os.path.exists('users.txt'):
    open('users.txt', 'a').close()

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

# --- LOGICA DI BUSINESS (ESEGUITA IN THREAD SEPARATI) ---

def do_registration(username, upload_folder):
    if find_user(username):
        raise ValueError("Username già esistente!")
    api_key = generate_api_key()
    save_user(username, hash_key(api_key))
    user_folder = os.path.join(upload_folder, username)
    os.makedirs(user_folder, exist_ok=True)
    return api_key

def do_login(username, api_key):
    stored_hash = find_user(username)
    return stored_hash and verify_key(api_key, stored_hash)

def do_upload(file_data, api_key, user_folder, original_filename):
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
    """
    Decripta i file e li comprime in un archivio ZIP, aggiornando lo stato.
    """
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
    if 'username' in session:
        user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
        media_files = []
        if os.path.exists(user_folder):
            media_files = sorted([f for f in os.listdir(user_folder) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.mp4', '.mov'))])
        return render_template('gallery.html', media_files=media_files)
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    username = request.form['username'].strip()
    if not username: return "Username non valido!", 400
    try:
        with get_dynamic_executor() as executor:
            future = executor.submit(do_registration, username, app.config['UPLOAD_FOLDER'])
            api_key = future.result()
        return render_template('key_display.html', username=username, api_key=api_key)
    except Exception as e:
        return str(e), 400

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username'].strip()
    api_key = request.form['api_key'].strip()
    with get_dynamic_executor() as executor:
        is_valid = executor.submit(do_login, username, api_key).result()
    if is_valid:
        session['username'] = username
        session['api_key'] = api_key
        return redirect(url_for('home'))
    return "Credenziali non valide!", 401

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/upload', methods=['POST'])
def upload():
    if 'username' not in session: 
        return jsonify({"error": "Accesso negato"}), 403
    
    files = request.files.getlist("file[]") # Ottieni la lista di file
    if not files or files[0].filename == '':
        return jsonify({"error": "Nessun file selezionato"}), 400

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    api_key = session['api_key']
    
    try:
        with get_dynamic_executor() as executor:
            futures = []
            for file in files:
                original_filename = secure_filename(file.filename)
                file_data = file.read()
                # Sottomette ogni upload come un task separato al thread pool
                futures.append(executor.submit(do_upload, file_data, api_key, user_folder, original_filename))
            
            # Aspetta che tutti i caricamenti siano completati
            for future in as_completed(futures):
                future.result() # Puoi controllare i risultati se do_upload restituisse qualcosa di utile

    except Exception as e:
        return jsonify({"error": f"Errore durante il caricamento: {str(e)}"}), 500
    
    return jsonify({"success": True, "message": f"{len(files)} file caricati con successo."})


@app.route('/media/<filename>')
def media(filename):
    if 'username' not in session: return "Accesso negato", 403
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], session['username'], filename)
    if not os.path.exists(filepath): return "File non trovato", 404
    try:
        with get_dynamic_executor() as executor:
            decrypted_data = executor.submit(do_media_decryption, filepath, session['api_key']).result()
    except Exception as e:
        return f"Errore durante la decrittografia: {str(e)}", 500
    ext = filename.split('.')[-1].lower()
    mime_type = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'mp4': 'video/mp4', 'mov': 'video/mp4'}.get(ext, 'application/octet-stream')
    return send_file(io.BytesIO(decrypted_data), mimetype=mime_type)

@app.route('/delete/<filename>', methods=['POST'])
def delete(filename):
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
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
def find_duplicates_server():
    if 'username' not in session: return jsonify({"error": "Accesso negato"}), 403
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    if not os.path.exists(user_folder): return jsonify({"error": "Cartella utente non trovata"}), 404
    media_files = [os.path.join(user_folder, f) for f in os.listdir(user_folder) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.mp4', '.mov'))]
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

# --- ROTTE PER DOWNLOAD ZIP ---

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
    
    with ThreadPoolExecutor(max_workers=1) as executor:
        executor.submit(do_create_zip, task_id, filenames, user_folder, app.config['TEMP_ZIP_FOLDER'], session['api_key'])
        
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)