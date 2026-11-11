plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.valerio.photocloud"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.valerio.photocloud"
        minSdk = 26
        targetSdk = 35
        versionCode = 25
        versionName = "1.2.8"

        buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://10.0.2.2:5000\"")
    }

    androidResources {
        noCompress += "tflite"
    }

    signingConfigs {
        create("release") {
            storeFile = file("photocloud-release-key.jks")
            storePassword = System.getenv("KEYSTORE_PASSWORD") ?: "photocloud_release_2026"
            keyAlias = "photocloud-release-key"
            keyPassword = System.getenv("KEY_PASSWORD") ?: "photocloud_release_2026"
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
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

    // On-Device AI Categorization (MediaPipe Tasks Vision + WorkManager + Room + ExifInterface)
    implementation("com.google.mediapipe:tasks-vision:0.10.14")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
}
