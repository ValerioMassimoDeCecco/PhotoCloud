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
    id("com.google.devtools.ksp")
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

        buildConfigField("String", "DEFAULT_SERVER_URL", "\\"${safeServerUrl}\\"")
        buildConfigField("String", "SERVER_URL", "\\"${safeServerUrl}\\"")
        buildConfigField("boolean", "ENABLE_BIOMETRIC", "${Boolean(config.enableBiometricLock)}")
        buildConfigField("boolean", "ENABLE_OFFLINE_CACHE", "${Boolean(config.enableOfflineCache)}")
        buildConfigField("boolean", "ZK_V2_DEFAULT", "true")
    }

    androidResources {
        noCompress += "tflite"
    }

    val userProtectedProps = java.util.Properties().apply {
        val customPath = System.getenv("PHOTOCLOUD_SIGNING_PROPERTIES")?.trim().orEmpty()
        val f = if (customPath.isNotBlank()) java.io.File(customPath) else java.io.File(System.getProperty("user.home"), ".photocloud/signing.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    val localSigningProps = java.util.Properties().apply {
        val f = rootProject.file("signing.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    val releaseKeystorePath = System.getenv("PHOTOCLOUD_KEYSTORE_PATH") ?: System.getenv("KEYSTORE_PATH") ?: userProtectedProps.getProperty("storeFile") ?: localSigningProps.getProperty("storeFile") ?: ""
    val releaseStorePassword = System.getenv("PHOTOCLOUD_KEYSTORE_PASSWORD") ?: System.getenv("KEYSTORE_PASSWORD") ?: userProtectedProps.getProperty("storePassword") ?: localSigningProps.getProperty("storePassword") ?: ""
    val releaseKeyAlias = System.getenv("PHOTOCLOUD_KEY_ALIAS") ?: userProtectedProps.getProperty("keyAlias") ?: localSigningProps.getProperty("keyAlias") ?: "${safeAlias}"
    val releaseKeyPassword = System.getenv("PHOTOCLOUD_KEY_PASSWORD") ?: System.getenv("KEY_PASSWORD") ?: userProtectedProps.getProperty("keyPassword") ?: localSigningProps.getProperty("keyPassword") ?: ""
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
            isMinifyEnabled = false
            isShrinkResources = false
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
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Zero-Knowledge v2 Cryptography (Argon2id + HKDF-SHA256 + AES-256-GCM)
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")

    // On-Device AI Categorization (MediaPipe Tasks Vision + WorkManager + Room + ExifInterface)
    implementation("com.google.mediapipe:tasks-vision:0.10.14")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
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
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * ${safeAppName} - Native Android Client + Zero-Knowledge E2EE Vault (v2)
 * Version: ${safeVersionName} (Code ${Number(config.versionCode)})
 * Endpoint: ${safeServerUrl}/v2
 */
class MainActivity : ComponentActivity() {
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                var webViewRef by remember { mutableStateOf<WebView?>(null) }
                var currentTab by remember { mutableStateOf("vault_zk") }

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
                                selected = true,
                                onClick = {
                                    webViewRef?.loadUrl("${safeServerUrl}/v2")
                                },
                                icon = { Icon(Icons.Default.Lock, contentDescription = "Vault E2EE") },
                                label = { Text("Vault E2EE") }
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
                                loadUrl("${safeServerUrl}/v2")
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
         * Zero-Knowledge v2 AES-256-GCM AEAD decryption helper (12-byte nonce + 128-bit GCM tag)
         * aligned with PhotoCloud PCZK v1 specification (Argon2id + HKDF-SHA256 + AES-256-GCM).
         */
        fun decryptAesGcmChunk(
            ciphertextWithTag: ByteArray,
            fileKey32: ByteArray,
            nonce12: ByteArray,
            aad: ByteArray
        ): ByteArray {
            require(fileKey32.size == 32) { "AES-256 key must be 32 bytes" }
            require(nonce12.size == 12) { "GCM nonce must be 12 bytes" }
            val secretKey = SecretKeySpec(fileKey32, "AES")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, nonce12))
            cipher.updateAAD(aad)
            return cipher.doFinal(ciphertextWithTag)
        }
    }
}
`;
}
