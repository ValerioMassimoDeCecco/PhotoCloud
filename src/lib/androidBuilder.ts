import { AndroidBuildConfig } from '../types';

function escapeXmlAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeKotlinString(str: string): string {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\r/g, '')
    .replace(/\n/g, '');
}

export function validateAndroidConfig(config: AndroidBuildConfig): string | null {
  if (!config || typeof config !== 'object') {
    return 'Configurazione Android non valida.';
  }
  if (!config.appName || typeof config.appName !== 'string' || !config.appName.trim() || config.appName.length > 64) {
    return "Il nome dell'applicazione Android è obbligatorio (max 64 caratteri).";
  }
  if (typeof config.packageName !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(config.packageName.trim())) {
    return 'Il Package Name deve avere il formato valido (es. com.valerio.photocloud).';
  }
  if (typeof config.versionName !== 'string' || !/^\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?$/.test(config.versionName.trim())) {
    return 'La Version Name deve essere in formato semantico (es. 1.0.0).';
  }
  if (typeof config.versionCode !== 'number' || config.versionCode < 1 || !Number.isInteger(config.versionCode)) {
    return 'Il Version Code deve essere un numero intero positivo.';
  }
  if (config.serverUrl !== undefined && (typeof config.serverUrl !== 'string' || !/^https?:\/\/[^\s"'<>\\]+$/i.test(config.serverUrl.trim()))) {
    return "L'URL del server deve iniziare con http:// o https://.";
  }
  if (config.keystoreAlias !== undefined && (typeof config.keystoreAlias !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(config.keystoreAlias.trim()))) {
    return 'Il Keystore Alias contiene caratteri non validi.';
  }
  return null;
}

export function generateAndroidManifestXml(config: AndroidBuildConfig): string {
  const safePkg = escapeXmlAttr(config.packageName.trim());
  const safeAppName = escapeXmlAttr(config.appName.trim());
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${safePkg}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    ${config.enableBiometricLock ? '<uses-permission android:name="android.permission.USE_BIOMETRIC" />' : ''}

    <application
        android:allowBackup="${Boolean(config.enableAutoBackup)}"
        android:icon="@mipmap/ic_launcher"
        android:label="${safeAppName}"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/Theme.PhotoCloud">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden"
            android:theme="@style/Theme.PhotoCloud">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="photocloud.local" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}

export function generateAppBuildGradleKts(config: AndroidBuildConfig): string {
  const safePkg = escapeKotlinString(config.packageName.trim());
  const safeVersionName = escapeKotlinString(config.versionName.trim());
  const safeServerUrl = escapeKotlinString(config.serverUrl || 'http://10.0.2.2:3000');
  const safeAlias = escapeKotlinString(config.keystoreAlias || 'photocloud-release-key');
  const minSdk = Number.isInteger(config.minSdk) ? config.minSdk : 26;
  const targetSdk = Number.isInteger(config.targetSdk) ? config.targetSdk : 35;

  return `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "${safePkg}"
    compileSdk = ${targetSdk}

    defaultConfig {
        applicationId = "${safePkg}"
        minSdk = ${minSdk}
        targetSdk = ${targetSdk}
        versionCode = ${Number(config.versionCode)}
        versionName = "${safeVersionName}"

        buildConfigField("String", "SERVER_URL", "\\"${safeServerUrl}\\"")
        buildConfigField("boolean", "ENABLE_BIOMETRIC", "${Boolean(config.enableBiometricLock)}")
        buildConfigField("boolean", "ENABLE_OFFLINE_CACHE", "${Boolean(config.enableOfflineCache)}")
    }

    val releaseKeystorePath = System.getenv("PHOTOCLOUD_KEYSTORE_PATH") ?: System.getenv("KEYSTORE_PATH") ?: ""
    val releaseStorePassword = System.getenv("PHOTOCLOUD_KEYSTORE_PASSWORD") ?: System.getenv("KEYSTORE_PASSWORD") ?: ""
    val releaseKeyAlias = System.getenv("PHOTOCLOUD_KEY_ALIAS") ?: "${safeAlias}"
    val releaseKeyPassword = System.getenv("PHOTOCLOUD_KEY_PASSWORD") ?: System.getenv("KEY_PASSWORD") ?: ""
    val hasSigningSecrets = releaseKeystorePath.isNotBlank() && file(releaseKeystorePath).exists() && releaseStorePassword.isNotBlank() && releaseKeyPassword.isNotBlank()

    signingConfigs {
        create("release") {
            if (hasSigningSecrets) {
                storeFile = file(releaseKeystorePath)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (hasSigningSecrets) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlinOptions {
        jvmTarget = "21"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation(platform("androidx.compose:compose-bom:2025.01.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    ${config.enableBiometricLock ? 'implementation("androidx.biometric:biometric:1.2.0-alpha05")' : ''}
}
`;
}

export function generateMainActivityKt(config: AndroidBuildConfig): string {
  const safePkg = config.packageName.trim();
  const safeAppName = escapeKotlinString(config.appName.trim());
  const safeVersionName = escapeKotlinString(config.versionName.trim());
  const safeServerUrl = escapeKotlinString(config.serverUrl || 'http://10.0.2.2:3000');

  return `package ${safePkg}

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
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
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * ${safeAppName} - Native Android Client + Hybrid Encrypted Vault
 * Version: ${safeVersionName} (Code ${Number(config.versionCode)})
 * Endpoint: ${safeServerUrl}
 */
class MainActivity : ComponentActivity() {
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                var webViewRef by remember { mutableStateOf<WebView?>(null) }
                var currentTab by remember { mutableStateOf("gallery") }

                val filePicker = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.GetMultipleContents()
                ) { uris ->
                    filePathCallback?.onReceiveValue(uris.toTypedArray())
                    filePathCallback = null
                }

                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            NavigationBarItem(
                                selected = currentTab == "gallery",
                                onClick = {
                                    currentTab = "gallery"
                                    webViewRef?.loadUrl("${safeServerUrl}/")
                                },
                                icon = { Icon(Icons.Default.PhotoLibrary, contentDescription = "Galleria") },
                                label = { Text("Galleria") }
                            )
                            NavigationBarItem(
                                selected = currentTab == "trash",
                                onClick = {
                                    currentTab = "trash"
                                    webViewRef?.loadUrl("${safeServerUrl}/trash")
                                },
                                icon = { Icon(Icons.Default.DeleteOutline, contentDescription = "Cestino") },
                                label = { Text("Cestino") }
                            )
                            NavigationBarItem(
                                selected = currentTab == "security",
                                onClick = {
                                    currentTab = "security"
                                    webViewRef?.loadUrl("${safeServerUrl}/security")
                                },
                                icon = { Icon(Icons.Default.Security, contentDescription = "Sicurezza") },
                                label = { Text("Sicurezza") }
                            )
                        }
                    }
                ) { innerPadding ->
                    AndroidView(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding),
                        factory = { context ->
                            WebView(context).apply {
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.allowFileAccess = false
                                settings.allowContentAccess = false
                                settings.cacheMode = ${config.enableOfflineCache ? 'WebSettings.LOAD_DEFAULT' : 'WebSettings.LOAD_NO_CACHE'}
                                webViewClient = WebViewClient()
                                webChromeClient = object : WebChromeClient() {
                                    override fun onShowFileChooser(
                                        webView: WebView?,
                                        callback: ValueCallback<Array<Uri>>?,
                                        params: FileChooserParams?
                                    ): Boolean {
                                        filePathCallback?.onReceiveValue(null)
                                        filePathCallback = callback
                                        filePicker.launch("*/*")
                                        return true
                                    }
                                }
                                loadUrl("${safeServerUrl}")
                                webViewRef = this
                            }
                        }
                    )
                }

                BackHandler(enabled = webViewRef?.canGoBack() == true) {
                    webViewRef?.goBack()
                }
            }
        }
    }

    companion object {
        /**
         * Native Kotlin implementation of PhotoCloud AES-256-CFB + PBKDF2-HMAC-SHA256
         * matching main.py decrypt_file(encrypted_data, key).
         */
        fun decryptMedia(encryptedData: ByteArray, apiKey: String): ByteArray {
            val salt = encryptedData.copyOfRange(0, 16)
            val iv = encryptedData.copyOfRange(16, 32)
            val ciphertext = encryptedData.copyOfRange(32, encryptedData.size)

            val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val spec = PBEKeySpec(apiKey.toCharArray(), salt, 100000, 256)
            val secretKey = SecretKeySpec(factory.generateSecret(spec).encoded, "AES")

            val cipher = Cipher.getInstance("AES/CFB/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey, IvParameterSpec(iv))
            return cipher.doFinal(ciphertext)
        }
    }
}
`;
}
