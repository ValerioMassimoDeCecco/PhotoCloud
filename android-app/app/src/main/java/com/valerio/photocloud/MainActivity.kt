package com.valerio.photocloud

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.File
import java.io.FileOutputStream

/**
 * PhotoCloud Native Android Client v1.0.1
 * Connects directly to the local PhotoCloud server and supports:
 * - Native registration key download (POST /register -> MediaStore.Downloads / Download folder)
 * - Native ZIP/media file downloads via DownloadManager with session cookies
 * - Native file picker for photocloud_auth_*.json login and multi-photo uploads
 */
class MainActivity : ComponentActivity() {
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var lastSavedKeyMessage by mutableStateOf<String?>(null)

    inner class AndroidBridge(private val context: Context) {
        @JavascriptInterface
        fun saveDownloadedFile(filename: String, content: String, mimeType: String?) {
            val safeName = filename.ifBlank { "photocloud_auth_key.json" }
            val resolvedMime = if (mimeType.isNullOrBlank()) "application/json" else mimeType
            val bytes = content.toByteArray(Charsets.UTF_8)

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                        put(MediaStore.Downloads.MIME_TYPE, resolvedMime)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val resolver = context.contentResolver
                    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: throw IllegalStateException("Impossibile creare il file in Download")

                    resolver.openOutputStream(uri)?.use { out ->
                        out.write(bytes)
                        out.flush()
                    }

                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                } else {
                    @Suppress("DEPRECATION")
                    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (!downloadsDir.exists()) {
                        downloadsDir.mkdirs()
                    }
                    val outFile = File(downloadsDir, safeName)
                    FileOutputStream(outFile).use { out ->
                        out.write(bytes)
                        out.flush()
                    }
                }

                runOnUiThread {
                    lastSavedKeyMessage = "Il file chiave \"$safeName\" è stato salvato nella cartella Download del dispositivo. Ora puoi caricarlo nella scheda Accedi."
                    Toast.makeText(
                        context,
                        "Chiave salvata in Download: $safeName",
                        Toast.LENGTH_LONG
                    ).show()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(
                        context,
                        "Errore salvataggio chiave: ${e.localizedMessage}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        val savedUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL) ?: BuildConfig.DEFAULT_SERVER_URL

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                var serverUrl by remember { mutableStateOf(savedUrl) }
                var showServerDialog by remember { mutableStateOf(false) }
                var tempUrlInput by remember { mutableStateOf(serverUrl) }
                var webViewInstance by remember { mutableStateOf<WebView?>(null) }

                val filePickerLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.GetMultipleContents()
                ) { uris ->
                    fileUploadCallback?.onReceiveValue(uris.toTypedArray())
                    fileUploadCallback = null
                }

                Scaffold(
                    topBar = {
                        TopAppBar(
                            title = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Cloud, contentDescription = null)
                                    Spacer(Modifier.width(8.dp))
                                    Text("PhotoCloud")
                                }
                            },
                            actions = {
                                IconButton(onClick = { webViewInstance?.reload() }) {
                                    Icon(Icons.Default.Refresh, contentDescription = "Ricarica")
                                }
                                IconButton(onClick = {
                                    tempUrlInput = serverUrl
                                    showServerDialog = true
                                }) {
                                    Icon(Icons.Default.Settings, contentDescription = "Configura Server Locale")
                                }
                            }
                        )
                    }
                ) { innerPadding ->
                    AndroidView(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding),
                        factory = { ctx ->
                            WebView(ctx).apply {
                                CookieManager.getInstance().setAcceptCookie(true)
                                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.allowFileAccess = true
                                settings.allowContentAccess = true
                                settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

                                addJavascriptInterface(AndroidBridge(ctx), "AndroidApp")

                                setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
                                    try {
                                        if (url.startsWith("http://") || url.startsWith("https://")) {
                                            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                                            val request = DownloadManager.Request(Uri.parse(url)).apply {
                                                setMimeType(mimeType)
                                                val cookie = CookieManager.getInstance().getCookie(url)
                                                if (!cookie.isNullOrBlank()) {
                                                    addRequestHeader("Cookie", cookie)
                                                }
                                                if (!userAgent.isNullOrBlank()) {
                                                    addRequestHeader("User-Agent", userAgent)
                                                }
                                                setDescription("Download file da PhotoCloud...")
                                                setTitle(fileName)
                                                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                                            }
                                            val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                                            dm.enqueue(request)
                                            Toast.makeText(ctx, "Download avviato: $fileName", Toast.LENGTH_LONG).show()
                                        }
                                    } catch (e: Exception) {
                                        Toast.makeText(
                                            ctx,
                                            "Errore durante il download: ${e.localizedMessage}",
                                            Toast.LENGTH_LONG
                                        ).show()
                                    }
                                }

                                webViewClient = object : WebViewClient() {
                                    override fun shouldOverrideUrlLoading(
                                        view: WebView?,
                                        request: WebResourceRequest?
                                    ): Boolean = false

                                    override fun onPageFinished(view: WebView?, url: String?) {
                                        super.onPageFinished(view, url)
                                        // Intercept POST /register form inside WebView so the JSON key attachment
                                        // is fetched via AJAX and saved directly to Android Downloads via AndroidBridge
                                        val jsInterceptor = """
                                            (function() {
                                                var regForm = document.getElementById('actual-register-form');
                                                if (regForm && !regForm.dataset.androidRegisterHooked) {
                                                    regForm.dataset.androidRegisterHooked = 'true';
                                                    regForm.addEventListener('submit', async function(e) {
                                                        e.preventDefault();
                                                        e.stopImmediatePropagation();
                                                        try {
                                                            var formData = new FormData(regForm);
                                                            var actionUrl = regForm.getAttribute('action') || '/register';
                                                            var response = await fetch(actionUrl, {
                                                                method: 'POST',
                                                                body: formData
                                                            });
                                                            var bodyText = await response.text();
                                                            if (!response.ok) {
                                                                alert(bodyText || 'Errore durante la registrazione.');
                                                                return;
                                                            }
                                                            var disp = response.headers.get('Content-Disposition') || '';
                                                            var match = disp.match(/filename="?([^";]+)"?/i);
                                                            var uInput = document.getElementById('register-username');
                                                            var rawUser = uInput ? uInput.value.trim() : 'user';
                                                            var safeUser = rawUser.replace(/[^a-zA-Z0-9_-]/g, '_') || 'user';
                                                            var filename = (match && match[1]) ? match[1] : ('photocloud_auth_' + safeUser + '.json');
                                                            if (window.AndroidApp && window.AndroidApp.saveDownloadedFile) {
                                                                window.AndroidApp.saveDownloadedFile(filename, bodyText, 'application/json');
                                                            }
                                                            regForm.reset();
                                                            var loginTab = document.getElementById('login-tab');
                                                            if (loginTab) {
                                                                loginTab.click();
                                                            }
                                                        } catch (err) {
                                                            alert('Errore durante la registrazione: ' + err);
                                                        }
                                                    }, true);
                                                }
                                            })();
                                        """.trimIndent()
                                        view?.evaluateJavascript(jsInterceptor, null)
                                    }
                                }

                                webChromeClient = object : WebChromeClient() {
                                    override fun onShowFileChooser(
                                        webView: WebView?,
                                        filePathCallback: ValueCallback<Array<Uri>>?,
                                        fileChooserParams: FileChooserParams?
                                    ): Boolean {
                                        fileUploadCallback?.onReceiveValue(null)
                                        fileUploadCallback = filePathCallback
                                        filePickerLauncher.launch("*/*")
                                        return true
                                    }
                                }
                                loadUrl(serverUrl)
                                webViewInstance = this
                            }
                        }
                    )
                }

                if (lastSavedKeyMessage != null) {
                    AlertDialog(
                        onDismissRequest = { lastSavedKeyMessage = null },
                        title = { Text("Chiave Salvata in Download") },
                        text = { Text(lastSavedKeyMessage ?: "") },
                        confirmButton = {
                            Button(onClick = { lastSavedKeyMessage = null }) {
                                Text("OK")
                            }
                        }
                    )
                }

                if (showServerDialog) {
                    AlertDialog(
                        onDismissRequest = { showServerDialog = false },
                        title = { Text("Indirizzo Server PhotoCloud Locale") },
                        text = {
                            OutlinedTextField(
                                value = tempUrlInput,
                                onValueChange = { tempUrlInput = it },
                                label = { Text("URL Server (es. http://192.168.1.100:5000)") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                        },
                        confirmButton = {
                            Button(onClick = {
                                val cleaned = tempUrlInput.trim().removeSuffix("/")
                                serverUrl = cleaned
                                prefs.edit().putString("server_url", cleaned).apply()
                                webViewInstance?.loadUrl(cleaned)
                                showServerDialog = false
                            }) {
                                Text("Salva e Connetti")
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { showServerDialog = false }) {
                                Text("Annulla")
                            }
                        }
                    )
                }

                BackHandler(enabled = webViewInstance?.canGoBack() == true) {
                    webViewInstance?.goBack()
                }
            }
        }
    }
}
