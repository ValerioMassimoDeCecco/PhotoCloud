import { AndroidBuildConfig } from '../types';

export function validateAndroidConfig(config: AndroidBuildConfig): string | null {
  if (!config.appName.trim()) {
    return 'Il nome dell\'applicazione Android è obbligatorio.';
  }
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(config.packageName.trim())) {
    return 'Il Package Name deve avere il formato valido (es. com.valerio.photocloud).';
  }
  if (!/^\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?$/.test(config.versionName.trim())) {
    return 'La Version Name deve essere in formato semantico (es. 1.0.0).';
  }
  if (config.versionCode < 1 || !Number.isInteger(config.versionCode)) {
    return 'Il Version Code deve essere un numero intero positivo.';
  }
  return null;
}

export function generateAndroidManifestXml(config: AndroidBuildConfig): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${config.packageName}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    ${config.enableBiometricLock ? '<uses-permission android:name="android.permission.USE_BIOMETRIC" />' : ''}

    <application
        android:allowBackup="${config.enableAutoBackup}"
        android:icon="@mipmap/ic_launcher"
        android:label="${config.appName}"
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
  return `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "${config.packageName}"
    compileSdk = ${config.targetSdk}

    defaultConfig {
        applicationId = "${config.packageName}"
        minSdk = ${config.minSdk}
        targetSdk = ${config.targetSdk}
        versionCode = ${config.versionCode}
        versionName = "${config.versionName}"

        buildConfigField("String", "SERVER_URL", "\\"${config.serverUrl}\\"")
        buildConfigField("boolean", "ENABLE_BIOMETRIC", "${config.enableBiometricLock}")
        buildConfigField("boolean", "ENABLE_OFFLINE_CACHE", "${config.enableOfflineCache}")
    }

    signingConfigs {
        create("release") {
            storeFile = file("photocloud-release-key.jks")
            storePassword = System.getenv("KEYSTORE_PASSWORD") ?: "photocloud_release_2026"
            keyAlias = "${config.keystoreAlias}"
            keyPassword = System.getenv("KEY_PASSWORD") ?: "photocloud_release_2026"
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
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
  return `package ${config.packageName}

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
 * ${config.appName} - Native Android Client + Hybrid Encrypted Vault
 * Version: ${config.versionName} (Code ${config.versionCode})
 * Endpoint: ${config.serverUrl}
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
                                    webViewRef?.loadUrl("${config.serverUrl}/")
                                },
                                icon = { Icon(Icons.Default.PhotoLibrary, contentDescription = "Galleria") },
                                label = { Text("Galleria") }
                            )
                            NavigationBarItem(
                                selected = currentTab == "trash",
                                onClick = {
                                    currentTab = "trash"
                                    webViewRef?.loadUrl("${config.serverUrl}/trash")
                                },
                                icon = { Icon(Icons.Default.DeleteOutline, contentDescription = "Cestino") },
                                label = { Text("Cestino") }
                            )
                            NavigationBarItem(
                                selected = currentTab == "security",
                                onClick = {
                                    currentTab = "security"
                                    webViewRef?.loadUrl("${config.serverUrl}/security")
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
                                settings.allowFileAccess = true
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
                                loadUrl("${config.serverUrl}")
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
