package com.valerio.photocloud

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.TimeUnit

data class AppUpdateManifest(
    val versionName: String,
    val versionCode: Int,
    val apkDownloadUrl: String,
    val apkFilename: String,
    val fileSizeBytes: Long,
    val sha256: String,
    val changelog: List<String>
)

enum class AppUpdateStatus {
    IDLE,
    CHECKING,
    UP_TO_DATE,
    DOWNLOADING,
    VERIFYING,
    READY_TO_INSTALL,
    PERMISSION_REQUIRED,
    CANCELLED,
    ERROR
}

data class AppUpdateState(
    val status: AppUpdateStatus = AppUpdateStatus.IDLE,
    val showModal: Boolean = false,
    val manifest: AppUpdateManifest? = null,
    val downloadedBytes: Long = 0L,
    val totalBytes: Long = 0L,
    val speedBytesPerSec: Long = 0L,
    val verifiedApkFile: File? = null,
    val errorMessage: String? = null
) {
    val progressFraction: Float
        get() = if (totalBytes > 0L) {
            (downloadedBytes.toFloat() / totalBytes.toFloat()).coerceIn(0f, 1f)
        } else {
            0f
        }

    val progressPercent: Int
        get() = (progressFraction * 100f).toInt().coerceIn(0, 100)
}

data class ApkVerificationResult(
    val isValid: Boolean,
    val errorReason: String? = null,
    /** VersionName/versionCode dichiarati nell'APK scaricato (dal suo AndroidManifest). */
    val apkVersionName: String? = null,
    val apkVersionCode: Int = 0
)

/**
 * Automatic In-App Update Manager for PhotoCloud Android APK.
 *
 * - Checks on app launch against GitHub Releases (`ValerioMassimoDeCecco/PhotoCloud`) with automatic
 *   fallback to the connected PhotoCloud server (`/api/android/update-manifest` & `/release/photocloud-release-build.json`).
 * - Remains completely silent (`showModal = false`) when no newer version is available.
 * - When a newer version is detected, automatically downloads the APK in-app showing version, file size,
 *   progress bar, percentage, live transfer speed, and cancel button.
 * - Verifies SHA-256 digest and X.509 digital signature compatibility against the installed app before
 *   opening the official Android system package installer.
 */
object AppAutoUpdater {

    private const val TAG = "AppAutoUpdater"
    private const val UPDATES_CACHE_DIR = "updates"

    const val GITHUB_LATEST_RELEASE_API =
        "https://api.github.com/repos/ValerioMassimoDeCecco/PhotoCloud/releases/latest"
    const val GITHUB_RAW_MANIFEST_URL =
        "https://raw.githubusercontent.com/ValerioMassimoDeCecco/PhotoCloud/main/release/photocloud-release-build.json"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private val _state = MutableStateFlow(AppUpdateState())
    val state: StateFlow<AppUpdateState> = _state.asStateFlow()

    @Volatile
    private var activeJob: Job? = null

    @Volatile
    private var activeCall: Call? = null

    @Volatile
    private var hasCheckedSinceProcessStart: Boolean = false

    fun checkForUpdatesOnLaunch(context: Context, serverUrl: String?) {
        if (hasCheckedSinceProcessStart) return
        hasCheckedSinceProcessStart = true
        checkForUpdates(context = context, serverUrl = serverUrl, silentIfUpToDate = true)
    }

    fun checkForUpdates(
        context: Context,
        serverUrl: String?,
        silentIfUpToDate: Boolean,
        onManualResult: ((String) -> Unit)? = null
    ) {
        val appCtx = context.applicationContext
        if (activeJob?.isActive == true) return

        if (!isNetworkAvailable(appCtx)) {
            if (!silentIfUpToDate) {
                onManualResult?.invoke("Connessione Internet assente. Impossibile verificare gli aggiornamenti.")
            }
            return
        }

        activeJob = scope.launch {
            if (!silentIfUpToDate) {
                _state.value = _state.value.copy(
                    status = AppUpdateStatus.CHECKING,
                    errorMessage = null
                )
            }

            val manifest = fetchLatestManifest(serverUrl)
            if (manifest == null) {
                _state.value = _state.value.copy(status = AppUpdateStatus.IDLE)
                if (!silentIfUpToDate) {
                    onManualResult?.invoke("Server aggiornamenti temporaneamente non raggiungibile.")
                }
                return@launch
            }

            // Se il versionCode remoto non è più nuovo dell'app installata non c'è nulla da fare.
            val isNewer = isRemoteVersionNewer(
                installedVersionName = BuildConfig.VERSION_NAME,
                installedVersionCode = BuildConfig.VERSION_CODE,
                remoteVersionName = manifest.versionName,
                remoteVersionCode = manifest.versionCode
            )

            if (!isNewer) {
                _state.value = AppUpdateState(
                    status = AppUpdateStatus.UP_TO_DATE,
                    showModal = false,
                    manifest = manifest
                )
                if (!silentIfUpToDate) {
                    onManualResult?.invoke("Hai già l'ultima versione installata (v${BuildConfig.VERSION_NAME}).")
                }
                return@launch
            }

            // Newer version found! Check if already downloaded and verified in cache to avoid duplicate downloads
            val targetApkFile = getTargetApkFile(appCtx, manifest)
            if (targetApkFile.exists() && targetApkFile.length() > 100_000L) {
                val cachedVerification = verifyDownloadedApk(appCtx, targetApkFile, manifest)
                if (cachedVerification.isValid) {
                    _state.value = AppUpdateState(
                        status = AppUpdateStatus.READY_TO_INSTALL,
                        showModal = true,
                        manifest = manifest,
                        downloadedBytes = targetApkFile.length(),
                        totalBytes = targetApkFile.length(),
                        speedBytesPerSec = 0L,
                        verifiedApkFile = targetApkFile,
                        errorMessage = null
                    )
                    promptInstallApk(appCtx, targetApkFile)
                    return@launch
                } else {
                    try {
                        targetApkFile.delete()
                    } catch (_: Throwable) {
                    }
                }
            }

            // Anti-loop guard lato release: se la release annuncia la versione X ma l'APK
            // pubblicato è ancora una versione vecchia già installata, inutile scaricare decine
            // di MB per poi riproporre lo stesso aggiornamento ad ogni avvio.
            if (isPublishedApkOlderThanInstalled(manifest)) {
                _state.value = AppUpdateState(
                    status = AppUpdateStatus.UP_TO_DATE,
                    showModal = false,
                    manifest = null
                )
                if (!silentIfUpToDate) {
                    onManualResult?.invoke(renderStaleReleaseNotice(manifest))
                }
                return@launch
            }

            downloadAndVerifyUpdateInternal(appCtx, manifest)
        }
    }

    fun retryDownload(context: Context) {
        val manifest = _state.value.manifest ?: return
        if (activeJob?.isActive == true) return
        val appCtx = context.applicationContext
        activeJob = scope.launch {
            downloadAndVerifyUpdateInternal(appCtx, manifest)
        }
    }

    fun cancelUpdateDownload() {
        try {
            activeCall?.cancel()
        } catch (_: Throwable) {
        }
        activeJob?.cancel()
        activeJob = null
        _state.value = _state.value.copy(
            status = AppUpdateStatus.CANCELLED,
            showModal = false,
            speedBytesPerSec = 0L,
            errorMessage = null
        )
    }

    fun dismissModal() {
        if (_state.value.status == AppUpdateStatus.DOWNLOADING) {
            cancelUpdateDownload()
        } else {
            _state.value = _state.value.copy(showModal = false)
        }
    }

    private suspend fun downloadAndVerifyUpdateInternal(
        appCtx: Context,
        manifest: AppUpdateManifest
    ) {
        val freeSpace = getAvailableCacheSpaceBytes(appCtx)
        val requiredBytes = (if (manifest.fileSizeBytes > 0L) manifest.fileSizeBytes else 25_000_000L) + 10_000_000L
        if (freeSpace in 1 until requiredBytes) {
            _state.value = AppUpdateState(
                status = AppUpdateStatus.ERROR,
                showModal = true,
                manifest = manifest,
                errorMessage = "Spazio di archiviazione insufficiente per scaricare l'aggiornamento (${PhotoCloudApiClient.formatBytesHuman(freeSpace)} liberi)."
            )
            return
        }

        val targetApkFile = getTargetApkFile(appCtx, manifest)
        val tempApkFile = File(targetApkFile.parentFile, "${targetApkFile.name}.part")

        _state.value = AppUpdateState(
            status = AppUpdateStatus.DOWNLOADING,
            showModal = true,
            manifest = manifest,
            downloadedBytes = 0L,
            totalBytes = manifest.fileSizeBytes,
            speedBytesPerSec = 0L,
            errorMessage = null
        )

        try {
            val existingOffset = if (tempApkFile.exists()) tempApkFile.length() else 0L
            val reqBuilder = Request.Builder()
                .url(manifest.apkDownloadUrl)
                .header("User-Agent", "PhotoCloud-Android-Updater/${BuildConfig.VERSION_NAME}")
            if (existingOffset > 0L) {
                reqBuilder.header("Range", "bytes=$existingOffset-")
            }

            val call = httpClient.newCall(reqBuilder.build())
            activeCall = call

            call.execute().use { resp ->
                if (!resp.isSuccessful && resp.code != 206) {
                    _state.value = _state.value.copy(
                        status = AppUpdateStatus.ERROR,
                        speedBytesPerSec = 0L,
                        errorMessage = "Impossibile scaricare l'aggiornamento (HTTP ${resp.code})."
                    )
                    return
                }

                val isResumed = resp.code == 206 && existingOffset > 0L
                val startBytes = if (isResumed) existingOffset else 0L
                val body = resp.body ?: run {
                    _state.value = _state.value.copy(
                        status = AppUpdateStatus.ERROR,
                        speedBytesPerSec = 0L,
                        errorMessage = "Risposta vuota dal server durante il download dell'APK."
                    )
                    return
                }

                val contentLen = body.contentLength()
                val totalExpected = when {
                    contentLen > 0L -> startBytes + contentLen
                    manifest.fileSizeBytes > 0L -> manifest.fileSizeBytes
                    else -> 0L
                }

                FileOutputStream(tempApkFile, isResumed).use { out ->
                    val buffer = ByteArray(32 * 1024)
                    val stream = body.byteStream()
                    var downloaded = startBytes
                    var windowStartMs = System.currentTimeMillis()
                    var windowBytes = 0L

                    while (scope.isActive) {
                        val read = stream.read(buffer)
                        if (read == -1) break
                        out.write(buffer, 0, read)
                        downloaded += read
                        windowBytes += read

                        val now = System.currentTimeMillis()
                        val elapsedMs = now - windowStartMs
                        if (elapsedMs >= 200L) {
                            val speed = (windowBytes * 1000L) / elapsedMs.coerceAtLeast(1L)
                            _state.value = _state.value.copy(
                                status = AppUpdateStatus.DOWNLOADING,
                                downloadedBytes = downloaded,
                                totalBytes = maxOf(totalExpected, downloaded),
                                speedBytesPerSec = speed,
                                errorMessage = null
                            )
                            windowStartMs = now
                            windowBytes = 0L
                        }
                    }
                    out.flush()
                }
            }

            _state.value = _state.value.copy(
                status = AppUpdateStatus.VERIFYING,
                downloadedBytes = tempApkFile.length(),
                totalBytes = maxOf(manifest.fileSizeBytes, tempApkFile.length()),
                speedBytesPerSec = 0L
            )

            if (targetApkFile.exists()) {
                targetApkFile.delete()
            }
            if (!tempApkFile.renameTo(targetApkFile)) {
                tempApkFile.copyTo(targetApkFile, overwrite = true)
                tempApkFile.delete()
            }

            val verification = verifyDownloadedApk(appCtx, targetApkFile, manifest)
            if (!verification.isValid) {
                try {
                    targetApkFile.delete()
                } catch (_: Throwable) {
                }
                _state.value = _state.value.copy(
                    status = AppUpdateStatus.ERROR,
                    speedBytesPerSec = 0L,
                    verifiedApkFile = null,
                    errorMessage = verification.errorReason ?: "File APK corrotto o firma non valida."
                )
                return
            }

            _state.value = _state.value.copy(
                status = AppUpdateStatus.READY_TO_INSTALL,
                speedBytesPerSec = 0L,
                verifiedApkFile = targetApkFile,
                errorMessage = null
            )

            promptInstallApk(appCtx, targetApkFile)
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            Log.w(TAG, "Error downloading APK update: ${t.message}")
            val errMsg = when {
                t.message?.contains("ENOSPC", ignoreCase = true) == true ||
                    t.message?.contains("No space left", ignoreCase = true) == true ->
                    "Spazio di archiviazione esaurito durante il download dell'APK."
                else -> "Download interrotto: ${t.localizedMessage ?: "errore di connessione"}."
            }
            _state.value = _state.value.copy(
                status = AppUpdateStatus.ERROR,
                speedBytesPerSec = 0L,
                errorMessage = errMsg
            )
        } finally {
            activeCall = null
        }
    }

    /**
     * Verifies APK integrity (size + SHA-256 digest) and X.509 digital signature compatibility
     * against the currently installed application.
     */
    fun verifyDownloadedApk(
        context: Context,
        apkFile: File,
        manifest: AppUpdateManifest
    ): ApkVerificationResult {
        if (!apkFile.exists() || apkFile.length() < 100_000L) {
            return ApkVerificationResult(
                isValid = false,
                errorReason = "File APK incompleto o corrotto."
            )
        }

        if (manifest.fileSizeBytes > 0L && apkFile.length() != manifest.fileSizeBytes) {
            return ApkVerificationResult(
                isValid = false,
                errorReason = "Dimensione del file APK non corrispondente (${apkFile.length()} byte anziché ${manifest.fileSizeBytes})."
            )
        }

        // 1. SHA-256 checksum verification
        val expectedSha = manifest.sha256.trim().lowercase(Locale.ROOT)
        if (expectedSha.length == 64) {
            val actualSha = computeFileSha256(apkFile).lowercase(Locale.ROOT)
            if (actualSha != expectedSha) {
                return ApkVerificationResult(
                    isValid = false,
                    errorReason = "Verifica integrità SHA-256 fallita: il file APK è stato alterato o è incompleto."
                )
            }
        }

        // 2. Android Package Archive & Digital Signature Compatibility verification
        return try {
            val pm = context.packageManager
            val archiveFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageManager.GET_SIGNING_CERTIFICATES
            } else {
                @Suppress("DEPRECATION")
                PackageManager.GET_SIGNATURES
            }

            val archiveInfo: PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageArchiveInfo(
                    apkFile.absolutePath,
                    PackageManager.PackageInfoFlags.of(archiveFlags.toLong())
                )
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageArchiveInfo(apkFile.absolutePath, archiveFlags)
            } ?: return ApkVerificationResult(
                isValid = false,
                errorReason = "Archivio APK non valido o danneggiato."
            )

            val expectedBasePkg = context.packageName.removeSuffix(".debug")
            val archiveBasePkg = (archiveInfo.packageName ?: "").removeSuffix(".debug")
            if (archiveBasePkg != expectedBasePkg) {
                return ApkVerificationResult(
                    isValid = false,
                    errorReason = "Package ID dell'APK (${archiveInfo.packageName}) non compatibile con l'app installata."
                )
            }

            val declaredVersionName = archiveInfo.versionName?.removePrefix("v")?.trim().orEmpty()
            val declaredVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                archiveInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                archiveInfo.versionCode.toLong()
            }

            // 3. Anti-loop guard: l'APK scaricato deve essere REALMENTE più nuovo dell'app installata.
            // Se la release annuncia una versione ma pubblica un APK vecchio (stesso versionCode o
            // inferiore), l'installazione non aggiornerebbe nulla e l'app riproporrebbe l'update
            // ad ogni avvio: blocchiamo subito con un errore esplicito.
            if (declaredVersionCode > 0L && declaredVersionCode <= BuildConfig.VERSION_CODE.toLong()) {
                return ApkVerificationResult(
                    isValid = false,
                    errorReason = "La release v${manifest.versionName} pubblica un APK con versione " +
                        "v${declaredVersionName.ifBlank { "?" }} (versionCode $declaredVersionCode), " +
                        "uguale o precedente a quella installata v${BuildConfig.VERSION_NAME} " +
                        "(versionCode ${BuildConfig.VERSION_CODE}). Aggiornamento annullato per evitare " +
                        "un ciclo di installazioni inutili: l'APK corretto non è ancora stato pubblicato.",
                    apkVersionName = declaredVersionName,
                    apkVersionCode = declaredVersionCode.toInt()
                )
            }

            if (manifest.versionCode > 0 && declaredVersionCode > 0L &&
                declaredVersionCode != manifest.versionCode.toLong()
            ) {
                return ApkVerificationResult(
                    isValid = false,
                    errorReason = "L'APK scaricato dichiara versionCode $declaredVersionCode ma la release " +
                        "annuncia versionCode ${manifest.versionCode}: file non corrispondente.",
                    apkVersionName = declaredVersionName,
                    apkVersionCode = declaredVersionCode.toInt()
                )
            }

            val archiveCertDigests = extractSigningCertificateDigests(archiveInfo)
            val installedInfo: PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(archiveFlags.toLong())
                )
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(context.packageName, archiveFlags)
            }
            val installedCertDigests = extractSigningCertificateDigests(installedInfo)

            // When both archive and installed package expose signing certificates, verify match
            // (Skip strict mismatch only on debug builds updating to release if packageName has .debug suffix)
            val isDebugInstalled = context.packageName.endsWith(".debug")
            if (!isDebugInstalled && archiveCertDigests.isNotEmpty() && installedCertDigests.isNotEmpty()) {
                val hasMatchingSignature = archiveCertDigests.any { it in installedCertDigests }
                if (!hasMatchingSignature) {
                    return ApkVerificationResult(
                        isValid = false,
                        errorReason = "Firma digitale dell'aggiornamento non corrispondente con l'app installata."
                    )
                }
            }

            ApkVerificationResult(
                isValid = true,
                apkVersionName = declaredVersionName,
                apkVersionCode = declaredVersionCode.toInt()
            )
        } catch (t: Throwable) {
            Log.w(TAG, "Signature verification error: ${t.message}", t)
            ApkVerificationResult(
                isValid = false,
                errorReason = "Errore durante la verifica della firma digitale dell'APK: ${t.localizedMessage}"
            )
        }
    }

    /**
     * Opens the official Android Package Installer screen (never installs silently).
     */
    fun promptInstallApk(context: Context, apkFile: File? = _state.value.verifiedApkFile) {
        val targetFile = apkFile ?: return
        if (!targetFile.exists()) {
            _state.value = _state.value.copy(
                status = AppUpdateStatus.ERROR,
                errorMessage = "Il file APK dell'aggiornamento non è più presente nella cache."
            )
            return
        }

        try {
            val pm = context.packageManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !pm.canRequestPackageInstalls()) {
                _state.value = _state.value.copy(
                    status = AppUpdateStatus.PERMISSION_REQUIRED,
                    showModal = true,
                    verifiedApkFile = targetFile,
                    errorMessage = "Autorizza l'installazione di aggiornamenti da questa sorgente nelle impostazioni di Android."
                )
                val permIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(permIntent)
                return
            }

            val apkUri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                targetFile
            )
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(installIntent)
        } catch (t: Throwable) {
            Log.e(TAG, "Unable to launch Android package installer: ${t.message}", t)
            _state.value = _state.value.copy(
                status = AppUpdateStatus.ERROR,
                showModal = true,
                errorMessage = "Impossibile avviare il programma di installazione di Android: ${t.localizedMessage}"
            )
        }
    }

    private fun extractSigningCertificateDigests(pkgInfo: PackageInfo): Set<String> {
        val digests = HashSet<String>()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val signingInfo = pkgInfo.signingInfo
                val sigs = if (signingInfo != null) {
                    if (signingInfo.hasMultipleSigners()) {
                        signingInfo.apkContentsSigners
                    } else {
                        signingInfo.signingCertificateHistory
                    }
                } else {
                    null
                }
                sigs?.forEach { sig ->
                    digests.add(sha256Hex(sig.toByteArray()))
                }
            } else {
                @Suppress("DEPRECATION")
                pkgInfo.signatures?.forEach { sig ->
                    digests.add(sha256Hex(sig.toByteArray()))
                }
            }
        } catch (_: Throwable) {
        }
        return digests
    }

    /**
     * Rileva il caso "release fantasma": il manifest annuncia un versionCode più alto di quello
     * installato, ma il nome file dell'APK pubblicato contiene ancora la versione installata
     * (es. tag v1.2.6 con asset `photocloud-release-v1.2.5-signed.apk`).
     *
     * In questa situazione ogni avvio proporrebbe un aggiornamento che non cambia la versione
     * dell'app: meglio non mostrare nulla (o avvisare in caso di controllo manuale).
     */
    fun isPublishedApkOlderThanInstalled(manifest: AppUpdateManifest): Boolean {
        if (manifest.apkDownloadUrl.isBlank()) return false
        val installed = BuildConfig.VERSION_NAME.trim().removePrefix("v")
        if (installed.isBlank()) return false
        val fileName = manifest.apkFilename.ifBlank { manifest.apkDownloadUrl.substringAfterLast('/') }
        if (fileName.isBlank() || !fileName.endsWith(".apk", ignoreCase = true)) return false

        // Estrae la versione (es. 1.2.5) dal nome asset `photocloud-release-v1.2.5-signed.apk`
        val versionInFileName = Regex("""v?(\d+(?:\.\d+)*)""").find(fileName)?.groupValues?.getOrNull(1)
            ?.trim()
            .orEmpty()
        if (versionInFileName.isBlank()) return false

        // L'asset pubblicato corrisponde alla versione già installata => nessun aggiornamento reale
        return compareSemanticVersions(versionInFileName, installed) <= 0 &&
            compareSemanticVersions(manifest.versionName, installed) > 0
    }

    fun renderStaleReleaseNotice(manifest: AppUpdateManifest): String {
        return "La release più recente (v${manifest.versionName}) contiene ancora l'APK della versione " +
            "installata (v${BuildConfig.VERSION_NAME}). Non c'è nulla da aggiornare: l'APK corretto " +
            "non è stato ancora pubblicato."
    }

    fun computeFileSha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { fis ->
            val buf = ByteArray(32 * 1024)
            while (true) {
                val r = fis.read(buf)
                if (r == -1) break
                md.update(buf, 0, r)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }

    fun isRemoteVersionNewer(
        installedVersionName: String,
        installedVersionCode: Int,
        remoteVersionName: String,
        remoteVersionCode: Int
    ): Boolean {
        if (remoteVersionCode > 0 && installedVersionCode > 0 && remoteVersionCode != installedVersionCode) {
            return remoteVersionCode > installedVersionCode
        }
        return compareSemanticVersions(remoteVersionName, installedVersionName) > 0
    }

    fun compareSemanticVersions(v1: String, v2: String): Int {
        val clean1 = v1.trim().removePrefix("v").removePrefix("V").split(Regex("[^0-9]+")).filter { it.isNotBlank() }
        val clean2 = v2.trim().removePrefix("v").removePrefix("V").split(Regex("[^0-9]+")).filter { it.isNotBlank() }
        val maxLen = maxOf(clean1.size, clean2.size)
        for (i in 0 until maxLen) {
            val n1 = clean1.getOrNull(i)?.toIntOrNull() ?: 0
            val n2 = clean2.getOrNull(i)?.toIntOrNull() ?: 0
            if (n1 != n2) return n1.compareTo(n2)
        }
        return 0
    }

    private fun fetchLatestManifest(serverUrl: String?): AppUpdateManifest? {
        // 1. Primary source: GitHub Releases API + raw manifest
        fetchFromGitHubReleases()?.let { return it }

        // 2. Fallback: Connected PhotoCloud Server (/api/android/update-manifest or /release/photocloud-release-build.json)
        val cleanedServer = serverUrl?.trim()?.removeSuffix("/")
        if (!cleanedServer.isNullOrBlank()) {
            fetchManifestFromJsonUrl(
                url = "$cleanedServer/api/android/update-manifest",
                baseServerUrl = cleanedServer
            )?.let { return it }

            fetchManifestFromJsonUrl(
                url = "$cleanedServer/release/photocloud-release-build.json",
                baseServerUrl = cleanedServer
            )?.let { return it }
        }
        return null
    }

    private fun fetchFromGitHubReleases(): AppUpdateManifest? {
        return try {
            val req = Request.Builder()
                .url(GITHUB_LATEST_RELEASE_API)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "PhotoCloud-Android/${BuildConfig.VERSION_NAME}")
                .build()

            httpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val rawBody = resp.body?.string() ?: return null
                val json = JSONObject(rawBody)
                val tagName = json.optString("tag_name", "").removePrefix("v").trim()
                if (tagName.isBlank()) return null

                val assets = json.optJSONArray("assets") ?: JSONArray()
                var apkUrl = ""
                var apkName = ""
                var apkSize = 0L
                var manifestAssetUrl = ""

                for (i in 0 until assets.length()) {
                    val asset = assets.optJSONObject(i) ?: continue
                    val name = asset.optString("name", "")
                    val downloadUrl = asset.optString("browser_download_url", "")
                    if (name.endsWith(".apk", ignoreCase = true) && downloadUrl.isNotBlank()) {
                        apkUrl = downloadUrl
                        apkName = name
                        apkSize = asset.optLong("size", 0L)
                    } else if (name == "photocloud-release-build.json" && downloadUrl.isNotBlank()) {
                        manifestAssetUrl = downloadUrl
                    }
                }

                // If a manifest JSON asset is attached or available in repo, enrich versionCode & sha256
                val extraManifest = if (manifestAssetUrl.isNotBlank()) {
                    fetchManifestFromJsonUrl(manifestAssetUrl, null)
                } else {
                    fetchManifestFromJsonUrl(GITHUB_RAW_MANIFEST_URL, null)
                }

                val finalApkUrl = apkUrl.ifBlank { extraManifest?.apkDownloadUrl.orEmpty() }
                if (finalApkUrl.isBlank()) return null

                val bodyLines = json.optString("body", "")
                    .lines()
                    .map { it.trim().removePrefix("- ").removePrefix("* ") }
                    .filter { it.isNotBlank() && !it.startsWith("#") }
                    .take(6)

                AppUpdateManifest(
                    // Il versionName ufficiale proviene dal manifest allegato alla release; il tag
                    // viene usato solo come fallback quando il manifest non è disponibile.
                    versionName = extraManifest?.versionName
                        ?.removePrefix("v")
                        ?.trim()
                        ?.takeIf { it.isNotBlank() }
                        ?: tagName,
                    versionCode = extraManifest?.versionCode?.takeIf { it > 0 } ?: 0,
                    apkDownloadUrl = finalApkUrl,
                    apkFilename = apkName.ifBlank { "photocloud-release-v$tagName-signed.apk" },
                    fileSizeBytes = if (apkSize > 0L) apkSize else (extraManifest?.fileSizeBytes ?: 0L),
                    sha256 = extraManifest?.sha256.orEmpty(),
                    changelog = extraManifest?.changelog?.takeIf { it.isNotEmpty() } ?: bodyLines
                )
            }
        } catch (t: Throwable) {
            Log.d(TAG, "GitHub release check fallback: ${t.message}")
            null
        }
    }

    private fun fetchManifestFromJsonUrl(url: String, baseServerUrl: String?): AppUpdateManifest? {
        return try {
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "PhotoCloud-Android/${BuildConfig.VERSION_NAME}")
                .build()
            httpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val raw = resp.body?.string() ?: return null
                val json = JSONObject(raw)
                val versionName = json.optString("versionName", "").removePrefix("v").trim()
                val versionCode = json.optInt("versionCode", 0)
                if (versionName.isBlank()) return null

                val apkFilename = json.optString(
                    "apkFilename",
                    "photocloud-release-v$versionName-signed.apk"
                )
                val rawApkUrl = json.optString("apkDownloadUrl", "")
                val resolvedApkUrl = when {
                    rawApkUrl.startsWith("http://") || rawApkUrl.startsWith("https://") -> rawApkUrl
                    !baseServerUrl.isNullOrBlank() && rawApkUrl.startsWith("/") -> "$baseServerUrl$rawApkUrl"
                    !baseServerUrl.isNullOrBlank() -> "$baseServerUrl/release/$apkFilename"
                    else -> ""
                }
                if (resolvedApkUrl.isBlank()) return null

                val sizeBytes = json.optLong("sizeBytes", json.optLong("apkSizeBytes", 0L))
                val sha256 = json.optString("sha256", json.optString("sha256Fingerprint", "")).trim()
                val changelogList = ArrayList<String>()
                val featuresArr = json.optJSONArray("changelog") ?: json.optJSONArray("features")
                if (featuresArr != null) {
                    for (i in 0 until featuresArr.length()) {
                        val item = featuresArr.optString(i, "").trim()
                        if (item.isNotBlank()) changelogList.add(item)
                    }
                }

                AppUpdateManifest(
                    versionName = versionName,
                    versionCode = versionCode,
                    apkDownloadUrl = resolvedApkUrl,
                    apkFilename = apkFilename,
                    fileSizeBytes = sizeBytes,
                    sha256 = sha256,
                    changelog = changelogList
                )
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun getTargetApkFile(context: Context, manifest: AppUpdateManifest): File {
        val dir = File(context.applicationContext.cacheDir, UPDATES_CACHE_DIR)
        if (!dir.exists()) {
            dir.mkdirs()
        }
        val safeName = manifest.apkFilename.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        return File(dir, safeName)
    }

    private fun getAvailableCacheSpaceBytes(context: Context): Long {
        return try {
            StatFs(context.applicationContext.cacheDir.absolutePath).availableBytes
        } catch (_: Throwable) {
            0L
        }
    }

    private fun isNetworkAvailable(context: Context): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return true
            val net = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(net) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Throwable) {
            true
        }
    }
}
