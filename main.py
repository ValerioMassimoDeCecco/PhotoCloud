import os
import secrets
import hashlib
import io
import string
import random
import psutil
from flask import Flask, render_template, request, redirect, url_for, session, send_file, jsonify
from werkzeug.utils import secure_filename
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)
app.config['UPLOAD_FOLDER'] = 'user_media'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

# Creazione delle cartelle necessarie
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
if not os.path.exists('users.txt'):
    open('users.txt', 'a').close()

# --- HELPERS DI GESTIONE THREAD E CPU ---

def get_dynamic_executor() -> ThreadPoolExecutor:
    """
    Crea un ThreadPoolExecutor con un numero di worker che si adatta dinamicamente
    al carico attuale della CPU.
    """
    # Usiamo interval=None per una lettura non bloccante
    cpu_percent = psutil.cpu_percent(interval=None)
    
    if cpu_percent > 80:
        max_workers = 1  # Limita a 1 thread se la CPU è molto carica
    elif cpu_percent > 60:
        # Usa metà dei core disponibili se il carico è moderato
        max_workers = max(1, os.cpu_count() // 2)
    else:
        # Usa tutti i core disponibili se la CPU è libera
        max_workers = os.cpu_count()
        
    return ThreadPoolExecutor(max_workers=max_workers)

# --- FUNZIONI DI SUPPORTO E CRITTOGRAFIA ---

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

# --- GESTIONE DATABASE UTENTI ---

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
    if stored_hash and verify_key(api_key, stored_hash):
        return True
    return False

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

# --- ROTTE FLASK (CONTROLLER) ---

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
    if not username:
        return "Username non valido!", 400
        
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
        future = executor.submit(do_login, username, api_key)
        is_valid = future.result()
        
    if is_valid:
        session['username'] = username
        session['api_key'] = api_key
        return redirect(url_for('home'))
    
    return "Credenziali non valide!", 401

@app.route('/logout', methods=['POST'])
def logout():
    session.pop('username', None)
    session.pop('api_key', None)
    return redirect(url_for('home'))

@app.route('/upload', methods=['POST'])
def upload():
    if 'username' not in session:
        return redirect(url_for('home'))
    
    if 'file' not in request.files:
        return "Nessun file selezionato", 400
    
    file = request.files['file']
    if file.filename == '':
        return "Nome file non valido", 400
    
    original_filename = secure_filename(file.filename)
    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    
    try:
        file_data = file.read()
        with get_dynamic_executor() as executor:
            future = executor.submit(do_upload, file_data, session['api_key'], user_folder, original_filename)
            future.result() # Attende il completamento
    except Exception as e:
        return f"Errore durante il caricamento: {str(e)}", 500
    
    return redirect(url_for('home'))

@app.route('/media/<filename>')
def media(filename):
    if 'username' not in session:
        return "Accesso negato", 403
    
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], session['username'], filename)
    if not os.path.exists(filepath):
        return "File non trovato", 404
    
    try:
        with get_dynamic_executor() as executor:
            future = executor.submit(do_media_decryption, filepath, session['api_key'])
            decrypted_data = future.result()
    except Exception as e:
        return f"Errore durante la decrittografia: {str(e)}", 500
    
    ext = filename.split('.')[-1].lower()
    mime_type = {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'mp4': 'video/mp4', 'mov': 'video/mp4'
    }.get(ext, 'application/octet-stream')
    
    return send_file(io.BytesIO(decrypted_data), mimetype=mime_type)

@app.route('/delete/<filename>', methods=['POST'])
def delete(filename):
    if 'username' not in session:
        return jsonify({"error": "Accesso negato"}), 403

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    filepath = os.path.join(user_folder, filename)

    if not os.path.abspath(filepath).startswith(os.path.abspath(user_folder)):
        return jsonify({"error": "Percorso non valido"}), 400

    if os.path.exists(filepath):
        try:
            with get_dynamic_executor() as executor:
                future = executor.submit(do_delete, filepath)
                future.result()
            return jsonify({'success': True, 'filename': filename})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    return jsonify({'success': False, 'error': 'File not found'}), 404

@app.route('/find_duplicates_server', methods=['POST'])
def find_duplicates_server():
    if 'username' not in session:
        return jsonify({"error": "Accesso negato"}), 403

    user_folder = os.path.join(app.config['UPLOAD_FOLDER'], session['username'])
    if not os.path.exists(user_folder):
        return jsonify({"error": "Cartella utente non trovata"}), 404

    media_files = [os.path.join(user_folder, f) for f in os.listdir(user_folder) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.mp4', '.mov'))]
    
    if len(media_files) < 2:
        return jsonify({"duplicates": []})

    hashes = {}
    # Utilizza il gestore dinamico di thread anche qui per coerenza
    with get_dynamic_executor() as executor:
        future_to_file = {executor.submit(calculate_file_hash, filepath, session['api_key']): filepath for filepath in media_files}
        for future in as_completed(future_to_file):
            filename, file_hash = future.result()
            if file_hash:
                if file_hash not in hashes:
                    hashes[file_hash] = []
                hashes[file_hash].append(filename)

    duplicates = [files for files in hashes.values() if len(files) > 1]
    
    return jsonify({"duplicates": duplicates})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)