import unittest
import os
import io
import json
import time
import shutil

import main


class PhotoCloudTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.app.config['TESTING'] = True
        cls.client = main.app.test_client()

    def setUp(self):
        self.test_username = f"test_qa_{int(time.time() * 1000)}"
        self.test_folder = os.path.join(main.app.config['UPLOAD_FOLDER'], self.test_username)

    def tearDown(self):
        # Clean user from users.txt
        if os.path.exists('users.txt'):
            with open('users.txt', 'r', encoding='utf-8') as f:
                lines = [l for l in f if not l.startswith(self.test_username + ':')]
            with open('users.txt', 'w', encoding='utf-8') as f:
                f.writelines(lines)

        # Clean user media folder
        if os.path.exists(self.test_folder):
            shutil.rmtree(self.test_folder, ignore_errors=True)

        if hasattr(main, 'LOGIN_ATTEMPTS'):
            main.LOGIN_ATTEMPTS.pop(self.test_username, None)
        if hasattr(main, 'TRUSTED_BROWSERS'):
            main.TRUSTED_BROWSERS.pop(self.test_username, None)

    def register_user(self, username, key_type='generate', custom_key=None):
        data = {'username': username, 'key_type': key_type}
        if custom_key:
            data['custom_key'] = custom_key
        return self.client.post('/register', data=data)

    def test_registration_and_validation(self):
        """Verifica la registrazione con chiave generata, personalizzata ed errori."""
        # 1. Registrazione con successo (generata)
        resp = self.register_user(self.test_username, 'generate')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get('Content-Type'), 'application/json')
        auth_data = json.loads(resp.data)
        self.assertEqual(auth_data['username'], self.test_username)
        self.assertTrue('api_key' in auth_data)

        # 2. Registrazione utente duplicato (409)
        resp_dup = self.register_user(self.test_username, 'generate')
        self.assertEqual(resp_dup.status_code, 409)

        # 3. Registrazione con chiave personalizzata troppo corta (400)
        short_user = self.test_username + "_short"
        resp_short = self.register_user(short_user, 'custom', 'short')
        self.assertEqual(resp_short.status_code, 400)

    def test_login_flow(self):
        """Verifica che il login con file di autenticazione valido reindirizzi alla galleria."""
        # Registra utente
        reg_resp = self.register_user(self.test_username, 'generate')
        auth_json = json.loads(reg_resp.data)

        # Login con file auth valido
        auth_file = (io.BytesIO(json.dumps(auth_json).encode('utf-8')), 'auth.json')
        login_resp = self.client.post('/login', data={'auth_file': auth_file}, content_type='multipart/form-data')

        # Deve reindirizzare alla home
        self.assertEqual(login_resp.status_code, 302)
        self.assertEqual(login_resp.headers.get('Location'), '/')

        # Visita home: deve essere autenticato (visualizza gallery, non login)
        home_resp = self.client.get('/')
        self.assertEqual(home_resp.status_code, 200)
        self.assertIn(b'Il tuo archivio', home_resp.data)

    def test_login_invalid_inputs(self):
        """Verifica la gestione di file non validi o credenziali errate."""
        # 1. File non JSON (deve dare 400, non 500)
        bad_file = (io.BytesIO(b'Questo non e un json'), 'auth.json')
        resp = self.client.post('/login', data={'auth_file': bad_file}, content_type='multipart/form-data')
        self.assertEqual(resp.status_code, 400)

        # 2. Credenziali errate (401)
        self.register_user(self.test_username, 'generate')
        wrong_auth = {'username': self.test_username, 'api_key': 'chiave_totalmente_errata_1234'}
        f = (io.BytesIO(json.dumps(wrong_auth).encode('utf-8')), 'auth.json')
        r = self.client.post('/login', data={'auth_file': f}, content_type='multipart/form-data')
        self.assertEqual(r.status_code, 401)

    def test_upload_and_media_decryption(self):
        """Verifica upload cifrato e decifratura sicura tramite /media/<filename>."""
        reg_resp = self.register_user(self.test_username, 'generate')
        auth_json = json.loads(reg_resp.data)
        api_key = auth_json['api_key']

        with self.client.session_transaction() as sess:
            sess['username'] = self.test_username
            sess['api_key'] = api_key

        photo_content = b'Immagine JPEG cifrata di test 1234567890'
        data = {
            'file[]': [(io.BytesIO(photo_content), 'vacanza.jpg')],
            'timestamp[]': ['1700000000000']
        }
        up_resp = self.client.post('/upload', data=data, content_type='multipart/form-data')
        self.assertEqual(up_resp.status_code, 200)

        # File salvato su disco deve essere cifrato (non uguale al plaintext)
        files = [f for f in os.listdir(self.test_folder) if f != 'trash']
        self.assertEqual(len(files), 1)
        filename = files[0]
        with open(os.path.join(self.test_folder, filename), 'rb') as f:
            disk_bytes = f.read()
        self.assertNotEqual(disk_bytes, photo_content)

        # Scaricamento tramite endpoint /media/ restituisce il plaintext corretto
        media_resp = self.client.get(f'/media/{filename}')
        self.assertEqual(media_resp.status_code, 200)
        self.assertEqual(media_resp.data, photo_content)

    def test_find_duplicates_resilience(self):
        """Verifica che /find_duplicates_server non vada in crash 500 se la cartella utente non esiste."""
        no_folder_user = self.test_username + "_no_media"
        with self.client.session_transaction() as sess:
            sess['username'] = no_folder_user
            sess['api_key'] = 'dummy'

        resp = self.client.post('/find_duplicates_server')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {'duplicates': []})

    def test_trash_batch_validation(self):
        """Verifica che /trash/batch gestisca file inesistenti senza generare errori 500."""
        reg_resp = self.register_user(self.test_username, 'generate')
        auth_json = json.loads(reg_resp.data)

        with self.client.session_transaction() as sess:
            sess['username'] = self.test_username
            sess['api_key'] = auth_json['api_key']

        # Carica un file valido
        data = {'file[]': [(io.BytesIO(b'foto valida'), 'foto.jpg')]}
        self.client.post('/upload', data=data, content_type='multipart/form-data')
        files = [f for f in os.listdir(self.test_folder) if f != 'trash']

        # Invio batch con file valido + file inesistente
        batch_resp = self.client.post('/trash/batch', json={'filenames': [files[0], 'inesistente.jpg']})
        # Deve completare l'operazione sui file validi senza andare in crash 500
        self.assertIn(batch_resp.status_code, [200, 207])
        self.assertTrue(os.path.exists(os.path.join(self.test_folder, 'trash', files[0])))

    def test_zip_creation_and_windows_download(self):
        """Verifica creazione ZIP e download su Windows senza errori di file lock (WinError 32)."""
        reg_resp = self.register_user(self.test_username, 'generate')
        auth_json = json.loads(reg_resp.data)

        with self.client.session_transaction() as sess:
            sess['username'] = self.test_username
            sess['api_key'] = auth_json['api_key']

        # Carica 2 file
        data = {
            'file[]': [
                (io.BytesIO(b'Foto Uno'), 'f1.jpg'),
                (io.BytesIO(b'Foto Due'), 'f2.jpg')
            ]
        }
        self.client.post('/upload', data=data, content_type='multipart/form-data')
        files = [f for f in os.listdir(self.test_folder) if f != 'trash']

        # Prepara zip
        prep_resp = self.client.post('/prepare-zip', json={'filenames': files})
        self.assertEqual(prep_resp.status_code, 200)
        task_id = prep_resp.get_json()['task_id']

        # Polling attesa completamento
        for _ in range(10):
            time.sleep(0.2)
            prog_resp = self.client.get(f'/zip-progress/{task_id}')
            if prog_resp.get_json().get('status') == 'complete':
                break

        prog_data = prog_resp.get_json()
        self.assertEqual(prog_data['status'], 'complete')
        zip_filename = prog_data['filename']

        # Download dello zip
        dl_resp = self.client.get(f'/download-zip/{zip_filename}')
        self.assertEqual(dl_resp.status_code, 200)
        self.assertTrue(len(dl_resp.data) > 0)

        # Su Windows il file su disco deve essere rimosso o pulito senza PermissionError
        zip_disk_path = os.path.join(main.app.config['TEMP_ZIP_FOLDER'], zip_filename)
        self.assertFalse(os.path.exists(zip_disk_path))


if __name__ == '__main__':
    unittest.main()
