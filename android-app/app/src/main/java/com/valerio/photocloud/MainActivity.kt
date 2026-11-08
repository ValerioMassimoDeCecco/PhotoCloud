package com.valerio.photocloud

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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

/**
 * PhotoCloud Native Android Client
 * Connects directly to the local PhotoCloud server (Flask / Node on LAN or localhost)
 * and provides native Android file pickers for photocloud_auth_*.json login and media batch uploads.
 */
class MainActivity : ComponentActivity() {
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

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
                                webViewClient = object : WebViewClient() {
                                    override fun shouldOverrideUrlLoading(
                                        view: WebView?,
                                        request: WebResourceRequest?
                                    ): Boolean = false
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
