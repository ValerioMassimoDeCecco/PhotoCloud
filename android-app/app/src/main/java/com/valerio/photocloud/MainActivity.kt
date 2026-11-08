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
import android.view.View
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
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.File
import java.io.FileOutputStream

/**
 * PhotoCloud Native Android Client v1.0.1
 * - 120Hz High Refresh Rate display mode & hardware-accelerated WebView
 * - Material You (Material 3 Dynamic Color) minimalist shell
 * - Fixed Lightbox photo preview (resolving object/string filenames & DOM image sources)
 * - Material You 120Hz Floating Bar post-login interface
 * - Native registration key download (POST /register -> MediaStore.Downloads)
 */
class MainActivity : ComponentActivity() {
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var lastSavedKeyMessage by mutableStateOf<String?>(null)
    private var isLoginScreen by mutableStateOf(true)

    private fun enableHighRefreshRate120Hz() {
        try {
            val params = window.attributes
            params.preferredRefreshRate = 120f
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                @Suppress("DEPRECATION")
                val display = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    this.display
                } else {
                    windowManager.defaultDisplay
                }
                val modes = display?.supportedModes
                val bestMode = modes?.maxByOrNull { it.refreshRate }
                if (bestMode != null) {
                    params.preferredDisplayModeId = bestMode.modeId
                }
            }
            window.attributes = params
        } catch (_: Exception) {
        }
    }

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

        @JavascriptInterface
        fun setAuthScreenState(onLogin: Boolean) {
            runOnUiThread {
                isLoginScreen = onLogin
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableHighRefreshRate120Hz()

        val prefs = getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        val savedUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL) ?: BuildConfig.DEFAULT_SERVER_URL

        setContent {
            val ctx = LocalContext.current
            val darkTheme = isSystemInDarkTheme()
            val colorScheme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (darkTheme) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
            } else {
                if (darkTheme) darkColorScheme() else lightColorScheme()
            }

            MaterialTheme(colorScheme = colorScheme) {
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

                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    Box(modifier = Modifier.fillMaxSize()) {
                        AndroidView(
                            modifier = Modifier.fillMaxSize(),
                            factory = { viewCtx ->
                                WebView(viewCtx).apply {
                                    setLayerType(View.LAYER_TYPE_HARDWARE, null)
                                    isVerticalScrollBarEnabled = false
                                    isHorizontalScrollBarEnabled = false
                                    CookieManager.getInstance().setAcceptCookie(true)
                                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                                    settings.javaScriptEnabled = true
                                    settings.domStorageEnabled = true
                                    settings.allowFileAccess = true
                                    settings.allowContentAccess = true
                                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

                                    addJavascriptInterface(AndroidBridge(viewCtx), "AndroidApp")

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
                                                val dm = viewCtx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                                                dm.enqueue(request)
                                                Toast.makeText(viewCtx, "Download avviato: $fileName", Toast.LENGTH_LONG).show()
                                            }
                                        } catch (e: Exception) {
                                            Toast.makeText(
                                                viewCtx,
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
                                            val jsEnhancer = """
                                                (function() {
                                                    // 1. Detect login vs post-login gallery/trash state
                                                    var isAuthPage = !!document.querySelector('.auth-container');
                                                    if (window.AndroidApp && window.AndroidApp.setAuthScreenState) {
                                                        window.AndroidApp.setAuthScreenState(isAuthPage);
                                                    }

                                                    // 2. Intercept POST /register so the JSON key downloads via MediaStore.Downloads
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
                                                                if (loginTab) loginTab.click();
                                                            } catch (err) {
                                                                alert('Errore durante la registrazione: ' + err);
                                                            }
                                                        }, true);
                                                    }

                                                    // 3. Fix Lightbox photo display & swipe navigation on any PhotoCloud server version
                                                    function resolveUrl(item) {
                                                        if (!item) return '';
                                                        var raw = '';
                                                        if (typeof item === 'string') raw = item;
                                                        else if (typeof item === 'object') raw = item.filename || item.url || item.src || '';
                                                        raw = String(raw).trim();
                                                        if (!raw || raw === '[object Object]') return '';
                                                        if (raw.indexOf('/media/') === 0 || raw.indexOf('http') === 0) return raw.split('#')[0];
                                                        return '/media/' + encodeURIComponent(raw);
                                                    }

                                                    function collectCardsUrls() {
                                                        var cards = Array.from(document.querySelectorAll('.clickable-media, .media-card'));
                                                        return cards.map(function(c) {
                                                            var df = c.getAttribute('data-filename');
                                                            if (df) return '/media/' + encodeURIComponent(df);
                                                            var img = c.querySelector('img');
                                                            if (img && img.getAttribute('src')) return img.getAttribute('src');
                                                            var vsrc = c.querySelector('video source');
                                                            if (vsrc && vsrc.getAttribute('src')) return vsrc.getAttribute('src').split('#')[0];
                                                            return '';
                                                        }).filter(Boolean);
                                                    }

                                                    window.__m3LightboxList = [];
                                                    window.__m3LightboxIdx = 0;

                                                    function renderLightboxAt(idx) {
                                                        var lb = document.getElementById('lightbox');
                                                        var lbImg = document.getElementById('lightbox-img');
                                                        var lbVid = document.getElementById('lightbox-video');
                                                        var lbVidSrc = lbVid ? lbVid.querySelector('source') : null;
                                                        var lbCounter = document.getElementById('lightbox-counter');
                                                        if (!lb || !window.__m3LightboxList.length) return;

                                                        var mediaUrl = resolveUrl(window.__m3LightboxList[idx]);
                                                        if (!mediaUrl) return;
                                                        var clean = mediaUrl.split('?')[0].split('#')[0];
                                                        var isVid = /\.(mp4|mov|webm|mkv|avi)$/i.test(clean);

                                                        if (lbCounter) {
                                                            lbCounter.textContent = (idx + 1) + ' / ' + window.__m3LightboxList.length;
                                                        }
                                                        if (lbVid) lbVid.pause();

                                                        if (isVid && lbVid) {
                                                            if (lbImg) lbImg.style.display = 'none';
                                                            lbVid.style.display = 'block';
                                                            if (lbVidSrc) lbVidSrc.setAttribute('src', mediaUrl);
                                                            else lbVid.setAttribute('src', mediaUrl);
                                                            lbVid.load();
                                                            lbVid.play().catch(function(){});
                                                        } else if (lbImg) {
                                                            if (lbVid) lbVid.style.display = 'none';
                                                            lbImg.style.display = 'block';
                                                            lbImg.style.maxWidth = '96vw';
                                                            lbImg.style.maxHeight = '84dvh';
                                                            lbImg.style.width = 'auto';
                                                            lbImg.style.height = 'auto';
                                                            lbImg.style.objectFit = 'contain';
                                                            lbImg.setAttribute('src', mediaUrl);
                                                        }
                                                    }

                                                    window.openLightbox = function(url, isVideo, index, allMedia) {
                                                        var lb = document.getElementById('lightbox');
                                                        if (!lb) return;
                                                        var domUrls = collectCardsUrls();
                                                        var parsedList = Array.isArray(allMedia) ? allMedia.map(resolveUrl).filter(Boolean) : [];
                                                        window.__m3LightboxList = parsedList.length ? parsedList : domUrls;

                                                        var target = resolveUrl(url);
                                                        if (!target && typeof index === 'number' && domUrls[index]) {
                                                            target = domUrls[index];
                                                        }
                                                        var found = target ? window.__m3LightboxList.findIndex(function(u) {
                                                            return decodeURIComponent(u) === decodeURIComponent(target);
                                                        }) : -1;

                                                        if (found !== -1) {
                                                            window.__m3LightboxIdx = found;
                                                        } else if (typeof index === 'number' && index >= 0 && index < window.__m3LightboxList.length) {
                                                            window.__m3LightboxIdx = index;
                                                        } else if (target) {
                                                            window.__m3LightboxList = [target].concat(window.__m3LightboxList);
                                                            window.__m3LightboxIdx = 0;
                                                        } else {
                                                            window.__m3LightboxIdx = 0;
                                                        }

                                                        lb.style.display = 'flex';
                                                        lb.classList.add('active');
                                                        renderLightboxAt(window.__m3LightboxIdx);
                                                    };

                                                    window.navigateMedia = function(direction, event) {
                                                        if (event) event.stopPropagation();
                                                        if (!window.__m3LightboxList.length) return;
                                                        window.__m3LightboxIdx += direction;
                                                        if (window.__m3LightboxIdx >= window.__m3LightboxList.length) window.__m3LightboxIdx = 0;
                                                        if (window.__m3LightboxIdx < 0) window.__m3LightboxIdx = window.__m3LightboxList.length - 1;
                                                        renderLightboxAt(window.__m3LightboxIdx);
                                                    };

                                                    window.closeLightbox = function() {
                                                        var lb = document.getElementById('lightbox');
                                                        var lbImg = document.getElementById('lightbox-img');
                                                        var lbVid = document.getElementById('lightbox-video');
                                                        if (!lb) return;
                                                        lb.classList.remove('active');
                                                        lb.style.display = 'none';
                                                        if (lbVid) { lbVid.pause(); lbVid.style.display = 'none'; }
                                                        if (lbImg) { lbImg.style.display = 'none'; }
                                                    };

                                                    // Capture-phase click handler on galleryGrid so clicking any photo ALWAYS opens Lightbox with its real src
                                                    var galleryGrid = document.querySelector('.gallery-grid');
                                                    if (galleryGrid && !galleryGrid.dataset.m3LightboxHooked) {
                                                        galleryGrid.dataset.m3LightboxHooked = 'true';
                                                        galleryGrid.addEventListener('click', function(ev) {
                                                            var card = ev.target.closest('.clickable-media, .media-card');
                                                            if (!card) return;
                                                            if (ev.target.closest('.delete-form') || ev.target.closest('.media-actions') || ev.target.matches('.media-checkbox')) {
                                                                return;
                                                            }
                                                            ev.stopPropagation();
                                                            var allCards = Array.from(galleryGrid.querySelectorAll('.clickable-media, .media-card'));
                                                            var allUrls = collectCardsUrls();
                                                            var idx = Math.max(0, allCards.indexOf(card));
                                                            var imgEl = card.querySelector('img');
                                                            var vidSrcEl = card.querySelector('video source');
                                                            var directUrl = (imgEl && imgEl.getAttribute('src'))
                                                                ? imgEl.getAttribute('src')
                                                                : (vidSrcEl && vidSrcEl.getAttribute('src') ? vidSrcEl.getAttribute('src').split('#')[0] : allUrls[idx]);
                                                            if (directUrl) {
                                                                var isVid = /\.(mp4|mov|webm|mkv|avi)$/i.test(directUrl.split('?')[0]);
                                                                window.openLightbox(directUrl, isVid, idx, allUrls);
                                                            }
                                                        }, true);
                                                    }

                                                    // 4. Upgrade older server gallery/trash DOM to Material You 120Hz Floating Bar if not already present
                                                    if (!isAuthPage && !document.querySelector('.m3-floating-bar') && document.querySelector('.gallery-container')) {
                                                        var styleEl = document.createElement('style');
                                                        styleEl.textContent = `
                                                            body { padding: 0 !important; background: #0e0e11 !important; color: #e3e2e6 !important; font-family: system-ui, -apple-system, sans-serif !important; }
                                                            .container { max-width: 100% !important; padding: 0 !important; }
                                                            .gallery-container { border: none !important; border-radius: 0 !important; background: #0e0e11 !important; min-height: 100dvh !important; padding-bottom: 110px !important; }
                                                            .gallery-header { position: sticky !important; top: 0 !important; z-index: 100 !important; background: rgba(14,14,17,0.84) !important; backdrop-filter: blur(20px) saturate(160%) !important; padding: 14px 16px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; }
                                                            .header-content { flex-direction: row !important; justify-content: space-between !important; align-items: center !important; }
                                                            .header-content h1 { font-size: 20px !important; font-weight: 600 !important; letter-spacing: -0.02em !important; color: #e3e2e6 !important; }
                                                            #media-count { font-size: 12px !important; color: #c4c6d0 !important; margin: 0 !important; }
                                                            .gallery-grid { padding: 6px !important; background: transparent !important; }
                                                            .gallery-grid .media-group-grid { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 3px !important; }
                                                            .media-card-wrapper, .media-card { border-radius: 10px !important; border: none !important; background: #1c1c22 !important; }
                                                            .media-card:active { transform: scale(0.96) !important; }
                                                            .header-actions {
                                                                position: fixed !important;
                                                                bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important;
                                                                left: 50% !important;
                                                                transform: translateX(-50%) !important;
                                                                width: auto !important;
                                                                max-width: calc(100vw - 24px) !important;
                                                                height: 62px !important;
                                                                padding: 0 10px !important;
                                                                border-radius: 9999px !important;
                                                                background: rgba(28, 28, 34, 0.88) !important;
                                                                backdrop-filter: blur(28px) saturate(190%) !important;
                                                                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                                                                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55) !important;
                                                                z-index: 950 !important;
                                                                display: flex !important;
                                                                flex-wrap: nowrap !important;
                                                                align-items: center !important;
                                                                gap: 6px !important;
                                                            }
                                                            .header-actions .btn, .header-actions a.btn {
                                                                border-radius: 9999px !important;
                                                                height: 44px !important;
                                                                min-width: 44px !important;
                                                                padding: 0 12px !important;
                                                                border: none !important;
                                                                background: transparent !important;
                                                                color: #c4c6d0 !important;
                                                            }
                                                            .header-actions #upload-label {
                                                                background: #0842a0 !important;
                                                                color: #d3e3fd !important;
                                                                padding: 0 16px !important;
                                                                font-weight: 600 !important;
                                                            }
                                                            .grouping-controls {
                                                                background: #25262e !important;
                                                                border-radius: 9999px !important;
                                                                height: 38px !important;
                                                                padding: 0 12px !important;
                                                                border: none !important;
                                                            }
                                                            .grouping-controls::after { display: none !important; }
                                                        `;
                                                        document.head.appendChild(styleEl);
                                                    }
                                                })();
                                            """.trimIndent()
                                            view?.evaluateJavascript(jsEnhancer, null)
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

                        // Minimalist floating Server Endpoint button shown only on the Login/Register screen
                        if (isLoginScreen) {
                            FilledTonalIconButton(
                                onClick = {
                                    tempUrlInput = serverUrl
                                    showServerDialog = true
                                },
                                shape = CircleShape,
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .statusBarsPadding()
                                    .padding(14.dp)
                                    .size(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Dns,
                                    contentDescription = "Configura Server Locale"
                                )
                            }
                        }
                    }
                }

                if (lastSavedKeyMessage != null) {
                    AlertDialog(
                        onDismissRequest = { lastSavedKeyMessage = null },
                        shape = RoundedCornerShape(28.dp),
                        title = { Text("Chiave Salvata in Download") },
                        text = { Text(lastSavedKeyMessage ?: "") },
                        confirmButton = {
                            FilledTonalButton(onClick = { lastSavedKeyMessage = null }) {
                                Text("Perfetto")
                            }
                        }
                    )
                }

                if (showServerDialog) {
                    AlertDialog(
                        onDismissRequest = { showServerDialog = false },
                        shape = RoundedCornerShape(28.dp),
                        title = { Text("Server PhotoCloud") },
                        text = {
                            OutlinedTextField(
                                value = tempUrlInput,
                                onValueChange = { tempUrlInput = it },
                                label = { Text("Indirizzo (es. http://192.168.1.100:5000)") },
                                singleLine = true,
                                shape = RoundedCornerShape(16.dp),
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
                                Text("Connetti")
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
