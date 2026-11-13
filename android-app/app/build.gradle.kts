import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermission
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Properties

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
        versionCode = 30
        versionName = "1.4.0"

        buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://10.0.2.2:3000\"")
    }

    androidResources {
        noCompress += "tflite"
    }

    fun protectFilePermissions(target: File, isDirectory: Boolean) {
        try {
            val perms = if (isDirectory) {
                setOf(
                    PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.OWNER_EXECUTE
                )
            } else {
                setOf(
                    PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE
                )
            }
            Files.setPosixFilePermissions(target.toPath(), perms)
        } catch (_: Throwable) {
            target.setReadable(false, false)
            target.setReadable(true, true)
            target.setWritable(false, false)
            target.setWritable(true, true)
        }
    }

    val userHomeVaultDir = File(System.getProperty("user.home"), ".photocloud")
    val customPropsPath = System.getenv("PHOTOCLOUD_SIGNING_PROPERTIES")?.trim().orEmpty()
    val protectedSigningFile = if (customPropsPath.isNotBlank()) {
        File(customPropsPath)
    } else {
        File(userHomeVaultDir, "signing.properties")
    }
    val projectSigningFile = rootProject.file("signing.properties")

    fun loadPropsFile(propFile: File): Properties = Properties().apply {
        if (propFile.exists() && propFile.isFile) {
            propFile.inputStream().use { load(it) }
        }
    }

    val protectedSigningProps = loadPropsFile(protectedSigningFile)
    val projectSigningProps = loadPropsFile(projectSigningFile)

    fun resolveSigningValue(envPrimary: String, envFallback: String, propKey: String): String {
        val fromEnv = System.getenv(envPrimary)?.takeIf { it.isNotBlank() }
            ?: System.getenv(envFallback)?.takeIf { it.isNotBlank() }
        if (fromEnv != null) return fromEnv
        val fromGradle = (findProperty(envPrimary) as String?)?.takeIf { it.isNotBlank() }
            ?: (findProperty(envFallback) as String?)?.takeIf { it.isNotBlank() }
        if (fromGradle != null) return fromGradle
        val fromProtected = protectedSigningProps.getProperty(propKey)?.trim()?.takeIf { it.isNotBlank() }
        if (fromProtected != null) return fromProtected
        return projectSigningProps.getProperty(propKey)?.trim().orEmpty()
    }

    fun resolveKeystoreFile(rawPath: String): File? {
        if (rawPath.isBlank()) return null
        val direct = File(rawPath)
        if (direct.isAbsolute && direct.exists()) return direct
        val inUserVault = File(protectedSigningFile.parentFile ?: userHomeVaultDir, rawPath)
        if (inUserVault.exists()) return inUserVault
        val inModule = file(rawPath)
        if (inModule.exists()) return inModule
        val inRoot = rootProject.file(rawPath)
        if (inRoot.exists()) return inRoot
        return inModule
    }

    fun persistToProtectedSigningConfig(
        keystoreFile: File,
        storePass: String,
        alias: String,
        keyPass: String,
        storeTypeVal: String,
        certSha256: String? = null
    ) {
        val vaultDir = protectedSigningFile.parentFile ?: userHomeVaultDir
        if (!vaultDir.exists()) vaultDir.mkdirs()
        protectFilePermissions(vaultDir, isDirectory = true)

        val storedKeystore = if (keystoreFile.canonicalFile.parentFile == vaultDir.canonicalFile) {
            keystoreFile.canonicalFile
        } else {
            val dest = File(vaultDir, "release-signing.${keystoreFile.extension.ifBlank { "p12" }}")
            if (!dest.exists()) {
                keystoreFile.copyTo(dest, overwrite = false)
                protectFilePermissions(dest, isDirectory = false)
            }
            dest
        }

        val props = Properties().apply {
            setProperty("storeFile", storedKeystore.absolutePath.replace("\\", "/"))
            setProperty("storePassword", storePass)
            setProperty("keyAlias", alias)
            setProperty("keyPassword", keyPass)
            setProperty("storeType", storeTypeVal.ifBlank { "PKCS12" })
            if (!certSha256.isNullOrBlank()) {
                setProperty("certSha256", certSha256)
            }
        }
        protectedSigningFile.writer(Charsets.UTF_8).use { writer ->
            props.store(writer, "PhotoCloud Protected Persistent Release Signing (Auto-loaded; NEVER commit)")
        }
        protectFilePermissions(protectedSigningFile, isDirectory = false)
    }

    val isCiEnvironment = System.getenv("CI") == "true" || System.getenv("GITHUB_ACTIONS") == "true"
    val isReleasePackagingRequested = gradle.startParameter.taskNames.any { taskName ->
        val n = taskName.lowercase()
        (n.contains("assemblerelease") || n.contains("bundlerelease") || n.contains("packagerelease") || n == "release") &&
            !n.contains("compile")
    }

    var releaseKeystorePath = resolveSigningValue("PHOTOCLOUD_KEYSTORE_PATH", "KEYSTORE_PATH", "storeFile")
    var releaseStorePassword = resolveSigningValue("PHOTOCLOUD_KEYSTORE_PASSWORD", "KEYSTORE_PASSWORD", "storePassword")
    var releaseKeyAlias = resolveSigningValue("PHOTOCLOUD_KEY_ALIAS", "KEY_ALIAS", "keyAlias")
    var releaseKeyPassword = resolveSigningValue("PHOTOCLOUD_KEY_PASSWORD", "KEY_PASSWORD", "keyPassword")
    var releaseStoreType = resolveSigningValue("PHOTOCLOUD_KEYSTORE_TYPE", "KEYSTORE_TYPE", "storeType")
    var resolvedKeystoreFile = resolveKeystoreFile(releaseKeystorePath)

    val hasCompleteInitialCreds =
        resolvedKeystoreFile != null &&
            resolvedKeystoreFile.exists() &&
            releaseStorePassword.isNotBlank() &&
            releaseKeyAlias.isNotBlank() &&
            releaseKeyPassword.isNotBlank()

    // Persist env-supplied release credentials into ~/.photocloud/signing.properties on local machines
    // so subsequent builds reuse the exact same signature without manual re-entry.
    if (!isCiEnvironment && hasCompleteInitialCreds && resolvedKeystoreFile != null && !protectedSigningFile.exists()) {
        persistToProtectedSigningConfig(
            keystoreFile = resolvedKeystoreFile!!,
            storePass = releaseStorePassword,
            alias = releaseKeyAlias,
            keyPass = releaseKeyPassword,
            storeTypeVal = releaseStoreType
        )
    }

    // If building locally for release and no credentials exist anywhere yet, auto-initialize
    // a persistent keystore in ~/.photocloud/ so this build and all future builds share the same signature.
    if (!isCiEnvironment && isReleasePackagingRequested && !hasCompleteInitialCreds) {
        val vaultDir = protectedSigningFile.parentFile ?: userHomeVaultDir
        if (!vaultDir.exists()) vaultDir.mkdirs()
        protectFilePermissions(vaultDir, isDirectory = true)

        val autoKeystore = File(vaultDir, "release-signing.p12")
        if (!autoKeystore.exists()) {
            val rndBytes = ByteArray(24)
            SecureRandom().nextBytes(rndBytes)
            val generatedPass = rndBytes.joinToString("") { "%02x".format(it) }
            val generatedAlias = "photocloud-release-key"
            val keytoolExe = listOf(
                File(System.getProperty("java.home"), "bin/keytool"),
                File(System.getProperty("java.home"), "bin/keytool.exe")
            ).firstOrNull { it.exists() }?.absolutePath ?: "keytool"

            val genProc = ProcessBuilder(
                keytoolExe,
                "-genkeypair",
                "-keystore", autoKeystore.absolutePath,
                "-storetype", "PKCS12",
                "-alias", generatedAlias,
                "-keyalg", "RSA",
                "-keysize", "2048",
                "-validity", "10000",
                "-storepass", generatedPass,
                "-keypass", generatedPass,
                "-dname", "CN=PhotoCloud Persistent Release, OU=Mobile, O=ValerioMassimoDeCecco, L=Rome, ST=RM, C=IT"
            ).redirectErrorStream(true).start()
            val genOut = genProc.inputStream.bufferedReader().readText()
            if (genProc.waitFor() != 0) {
                throw GradleException("Impossibile generare keystore persistente in ~/.photocloud/: $genOut")
            }
            protectFilePermissions(autoKeystore, isDirectory = false)

            val certProc = ProcessBuilder(
                keytoolExe,
                "-exportcert",
                "-keystore", autoKeystore.absolutePath,
                "-alias", generatedAlias,
                "-storepass", generatedPass
            ).start()
            val certDer = certProc.inputStream.readBytes()
            val certSha256 = if (certProc.waitFor() == 0 && certDer.isNotEmpty()) {
                MessageDigest.getInstance("SHA-256").digest(certDer).joinToString("") { "%02x".format(it) }
            } else null

            persistToProtectedSigningConfig(
                keystoreFile = autoKeystore,
                storePass = generatedPass,
                alias = generatedAlias,
                keyPass = generatedPass,
                storeTypeVal = "PKCS12",
                certSha256 = certSha256
            )

            releaseKeystorePath = autoKeystore.absolutePath
            releaseStorePassword = generatedPass
            releaseKeyAlias = generatedAlias
            releaseKeyPassword = generatedPass
            releaseStoreType = "PKCS12"
            resolvedKeystoreFile = autoKeystore
        } else {
            throw GradleException(
                "Keystore esistente rilevato in ${autoKeystore.absolutePath} ma ${protectedSigningFile.absolutePath} non trovato. Ripristina signing.properties o rimuovi manualmente il vecchio keystore prima di rigenerarlo."
            )
        }
    }

    val hasReleaseSigningCredentials =
        resolvedKeystoreFile != null &&
            resolvedKeystoreFile!!.exists() &&
            releaseStorePassword.isNotBlank() &&
            releaseKeyAlias.isNotBlank() &&
            releaseKeyPassword.isNotBlank()

    signingConfigs {
        create("release") {
            if (hasReleaseSigningCredentials && resolvedKeystoreFile != null) {
                storeFile = resolvedKeystoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                if (releaseStoreType.isNotBlank()) {
                    storeType = releaseStoreType
                }
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
            if (hasReleaseSigningCredentials) {
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

    gradle.taskGraph.whenReady {
        val requiresSignedRelease = allTasks.any { task ->
            val n = task.name.lowercase()
            (n.contains("assemblerelease") || n.contains("bundlerelease") || n.contains("packagerelease")) &&
                !n.contains("compile")
        }
        if (requiresSignedRelease && !hasReleaseSigningCredentials) {
            throw GradleException(
                "Credenziali di firma release mancanti. Configura ~/.photocloud/signing.properties (esegui 'npm run android:signing:setup') oppure imposta PHOTOCLOUD_KEYSTORE_PATH, PHOTOCLOUD_KEYSTORE_PASSWORD, PHOTOCLOUD_KEY_ALIAS e PHOTOCLOUD_KEY_PASSWORD."
            )
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
