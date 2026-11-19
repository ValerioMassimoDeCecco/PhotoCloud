package com.valerio.photocloud.zk

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.launch
import java.io.File
import javax.crypto.Cipher

@Immutable
data class ZkV2LoginFormUiState(
    val serverUrl: String,
    val useRecoveryCodeTab: Boolean = false,
    val selectedKeyFileName: String? = null,
    val hasKeyFileLoaded: Boolean = false,
    val usernameInput: String = "",
    val recoveryCodeInput: String = "",
    val passphraseInput: String = "",
    val isBusy: Boolean = false,
    val errorMessage: String? = null,
    val kdfWarning: KdfChangeWarning? = null,
    val hasBiometricSavedVk: Boolean = false,
    val canUseStrongBiometrics: Boolean = false,
    val savedUsername: String? = null,
    val tofuChallenge: TofuPinChallenge? = null,
    val tofuMismatch: TofuPinMismatch? = null,
    val showRewrapDialog: Boolean = false,
    val rewrapOldPassphrase: String = "",
    val rewrapNewPassphrase: String = "",
    val rewrapConfirmPassphrase: String = "",
    val rewrapRecoveryCode: String = "",
    val rewrapError: String? = null
)

sealed interface ZkV2UiEvent {
    data class SelectAuthTab(val useRecoveryCode: Boolean) : ZkV2UiEvent
    data object PickKeyFile : ZkV2UiEvent
    data class UpdateUsername(val value: String) : ZkV2UiEvent
    data class UpdateRecoveryCode(val value: String) : ZkV2UiEvent
    data class UpdatePassphrase(val value: String) : ZkV2UiEvent
    data object SubmitLogin : ZkV2UiEvent
    data object UnlockWithBiometrics : ZkV2UiEvent
    data object ConfirmTofuCertificate : ZkV2UiEvent
    data object DismissTofuDialogs : ZkV2UiEvent
    data object DismissKdfWarning : ZkV2UiEvent
    data object EnrollBiometricUnlock : ZkV2UiEvent
    data class ToggleBackgroundBackupKey(val enabled: Boolean) : ZkV2UiEvent
    data class SetAutoLockConfig(val timeoutMs: Long, val lockOnBackground: Boolean) : ZkV2UiEvent
    data object LockNow : ZkV2UiEvent
    data object OpenRewrapDialog : ZkV2UiEvent
    data object DismissRewrapDialog : ZkV2UiEvent
    data class UpdateRewrapFields(
        val oldPass: String,
        val newPass: String,
        val confirmPass: String,
        val recoveryCode: String
    ) : ZkV2UiEvent
    data object SubmitRewrap : ZkV2UiEvent
    data object Logout : ZkV2UiEvent
    data object OpenServerConfig : ZkV2UiEvent
    data object ExitV2BetaToLegacy : ZkV2UiEvent
}

fun canUseStrongBiometricsOnly(activity: FragmentActivity): Boolean {
    val manager = BiometricManager.from(activity)
    return manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS
}

fun showV2StrongBiometricCryptoPrompt(
    activity: FragmentActivity,
    cipher: Cipher,
    title: String,
    subtitle: String,
    onSuccess: (Cipher) -> Unit,
    onError: (String) -> Unit
) {
    val executor = ContextCompat.getMainExecutor(activity)
    val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            super.onAuthenticationSucceeded(result)
            val unlocked = result.cryptoObject?.cipher
            if (unlocked != null) {
                onSuccess(unlocked)
            } else {
                onError("Cipher biometrico non restituito dal sistema.")
            }
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            super.onAuthenticationError(errorCode, errString)
            if (errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                errorCode != BiometricPrompt.ERROR_CANCELED
            ) {
                onError(errString.toString())
            }
        }
    }

    val prompt = BiometricPrompt(activity, executor, callback)
    val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle(subtitle)
        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        .setNegativeButtonText("Usa passphrase")
        .build()

    prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
}

@Composable
fun ZkV2AuthCoordinator(
    activity: FragmentActivity,
    sessionManager: ZkSessionManager,
    serverUrl: String,
    onOpenServerConfig: () -> Unit,
    onExitV2Mode: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session by sessionManager.sessionState.collectAsState()

    val spoolDir = remember(context) { File(context.cacheDir, "zk_upload_spool") }
    val resumableStore = remember(context) { PrefsResumableUploadStore(context) }
    val externalOpenHelper = remember(context) { ZkExternalOpenHelper(context.cacheDir) }
    val thumbCache = remember(context) { EncryptedThumbDiskCache(File(context.cacheDir, "zk_thumbs_enc")) }

    val vaultRepository = remember(sessionManager, thumbCache, externalOpenHelper) {
        ZkVaultRepository(
            apiClient = sessionManager.apiClient,
            sessionManager = sessionManager,
            thumbCache = thumbCache,
            externalOpenHelper = externalOpenHelper
        )
    }

    val uploadPipeline = remember(sessionManager, spoolDir, resumableStore) {
        ZkBlobUploadPipeline(
            apiClient = sessionManager.apiClient,
            spoolDir = spoolDir,
            resumableStore = resumableStore,
            fkProtector = BackgroundKeyStoreFkProtector(sessionManager.vaultKeyStore),
            thumbnailGenerator = AndroidZkThumbnailGenerator(context)
        )
    }

    val transferManager = remember(uploadPipeline, sessionManager, scope) {
        val savedParallelism = ZkAutoBackupPrefs.load(context).parallelism
        ZkTransferManager(
            pipeline = uploadPipeline,
            subkeysProvider = { sessionManager.getSubkeysOrNull() },
            scope = scope,
            initialParallelism = savedParallelism
        )
    }

    // Startup cleanup of orphaned ciphertext spool files and previous external-share temp files
    LaunchedEffect(Unit) {
        val activeSpools = resumableStore.listAll().map { it.spoolFileName }.toSet()
        ZkBlobUploadPipeline.cleanupOrphanSpoolFiles(spoolDir, activeSpools)
        externalOpenHelper.wipeAllExternalShareFiles()
    }

    // Wipe RAM thumbnail cache and external share files immediately whenever vault locks
    LaunchedEffect(session.isUnlocked) {
        if (!session.isUnlocked) {
            vaultRepository.onLockOrBackground()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            vaultRepository.onLockOrBackground()
        }
    }

    var keyFileJsonInMemory by remember { mutableStateOf<String?>(null) }
    var formState by remember(serverUrl) {
        mutableStateOf(
            ZkV2LoginFormUiState(
                serverUrl = serverUrl,
                hasBiometricSavedVk = session.isLockedWithSavedKeystore,
                canUseStrongBiometrics = canUseStrongBiometricsOnly(activity),
                savedUsername = session.username
            )
        )
    }

    // Keep session-derived flags synchronized cleanly
    val effectiveForm = formState.copy(
        serverUrl = serverUrl,
        hasBiometricSavedVk = session.isLockedWithSavedKeystore,
        canUseStrongBiometrics = canUseStrongBiometricsOnly(activity),
        savedUsername = session.username,
        kdfWarning = session.lastKdfChangeWarning
    )

    val safKeyFileLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        try {
            val rawText = context.contentResolver.openInputStream(uri)?.use {
                it.readBytes().toString(Charsets.UTF_8)
            }.orEmpty()
            val parsed = ZkAccountCredentialsCodec.parseKeyFileJson(rawText)
            keyFileJsonInMemory = rawText
            formState = formState.copy(
                selectedKeyFileName = uri.lastPathSegment?.substringAfterLast('/') ?: "photocloud_v2_key.json",
                hasKeyFileLoaded = true,
                usernameInput = parsed.username,
                errorMessage = null
            )
        } catch (_: Throwable) {
            keyFileJsonInMemory = null
            formState = formState.copy(
                hasKeyFileLoaded = false,
                selectedKeyFileName = null,
                errorMessage = UNIFORM_AUTH_ERROR_MESSAGE
            )
        }
    }

    fun executeLogin() {
        val current = formState
        if (current.useRecoveryCodeTab) {
            if (current.usernameInput.isBlank() || current.recoveryCodeInput.isBlank()) {
                formState = current.copy(errorMessage = UNIFORM_AUTH_ERROR_MESSAGE)
                return
            }
        } else if (keyFileJsonInMemory == null) {
            formState = current.copy(errorMessage = "Seleziona prima il File Chiave JSON v2.")
            return
        }

        formState = current.copy(isBusy = true, errorMessage = null, tofuChallenge = null, tofuMismatch = null)
        scope.launch {
            try {
                if (current.useRecoveryCodeTab) {
                    sessionManager.loginWithRecoveryCode(
                        username = current.usernameInput,
                        recoveryCode = current.recoveryCodeInput,
                        passphrase = current.passphraseInput
                    )
                } else {
                    sessionManager.loginWithKeyFileJson(
                        keyFileJson = keyFileJsonInMemory!!,
                        passphrase = current.passphraseInput
                    )
                }
                // Clear sensitive form text immediately upon login
                keyFileJsonInMemory = null
                formState = formState.copy(
                    isBusy = false,
                    passphraseInput = "",
                    recoveryCodeInput = "",
                    hasKeyFileLoaded = false,
                    selectedKeyFileName = null,
                    errorMessage = null
                )
            } catch (e: TofuConfirmationRequiredException) {
                formState = formState.copy(isBusy = false, tofuChallenge = e.challenge)
            } catch (e: TofuPinMismatchException) {
                formState = formState.copy(isBusy = false, tofuMismatch = e.mismatch)
            } catch (e: InsecureTransportException) {
                formState = formState.copy(isBusy = false, errorMessage = e.message)
            } catch (e: ZkUniformAuthException) {
                formState = formState.copy(isBusy = false, errorMessage = e.message)
            } catch (e: ZkCryptoException) {
                formState = formState.copy(
                    isBusy = false,
                    errorMessage = if (e.code == ZkErrorCode.INVALID_PARAMETER) {
                        e.message
                    } else {
                        UNIFORM_AUTH_ERROR_MESSAGE
                    }
                )
            } catch (t: Throwable) {
                formState = formState.copy(
                    isBusy = false,
                    errorMessage = "Errore di connessione v2: ${t.message ?: "riprova"}"
                )
            }
        }
    }

    fun executeBiometricUnlock() {
        try {
            val bioSession = sessionManager.prepareBiometricUnlockSession() as? AndroidBiometricCryptoSession
                ?: return
            showV2StrongBiometricCryptoPrompt(
                activity = activity,
                cipher = bioSession.cipher,
                title = "Sblocca Vault Zero-Knowledge",
                subtitle = "Usa Biometria Forte per decifrare la Vault Key dall'AndroidKeyStore",
                onSuccess = { unlockedCipher ->
                    try {
                        sessionManager.completeBiometricUnlock(AndroidBiometricCryptoSession(unlockedCipher))
                        formState = formState.copy(errorMessage = null)
                    } catch (e: VaultKeyStore.KeyInvalidatedException) {
                        sessionManager.vaultKeyStore.clearBiometricWrappedVk()
                        formState = formState.copy(
                            errorMessage = e.message
                        )
                    } catch (t: Throwable) {
                        formState = formState.copy(
                            errorMessage = "Impossibile sbloccare con biometria: ${t.message ?: "usa passphrase"}"
                        )
                    }
                },
                onError = { err ->
                    formState = formState.copy(errorMessage = err)
                }
            )
        } catch (e: VaultKeyStore.KeyInvalidatedException) {
            sessionManager.vaultKeyStore.clearBiometricWrappedVk()
            formState = formState.copy(errorMessage = e.message)
        } catch (t: Throwable) {
            formState = formState.copy(
                errorMessage = "Chiave biometrica non disponibile: effettua accesso con File Chiave o Recovery Code."
            )
        }
    }

    fun executeBiometricEnroll() {
        try {
            val bioSession = sessionManager.prepareBiometricEnrollmentSession() as? AndroidBiometricCryptoSession
                ?: return
            showV2StrongBiometricCryptoPrompt(
                activity = activity,
                cipher = bioSession.cipher,
                title = "Attiva Sblocco Biometrico v2",
                subtitle = "Proteggi la Vault Key in AndroidKeyStore (invalidata se cambia l'impronta)",
                onSuccess = { unlockedCipher ->
                    try {
                        val status = sessionManager.completeBiometricEnrollment(
                            AndroidBiometricCryptoSession(unlockedCipher)
                        )
                        val hwLabel = if (status.strongBoxBacked) "StrongBox" else "TEE Hardware"
                        Toast.makeText(
                            context,
                            "Sblocco biometrico attivato ($hwLabel)",
                            Toast.LENGTH_SHORT
                        ).show()
                    } catch (t: Throwable) {
                        Toast.makeText(
                            context,
                            "Errore attivazione biometria: ${t.message ?: "riprova"}",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                },
                onError = { err ->
                    Toast.makeText(context, err, Toast.LENGTH_SHORT).show()
                }
            )
        } catch (t: Throwable) {
            Toast.makeText(
                context,
                "Impossibile inizializzare KeyStore biometrico: ${t.message ?: "riprova"}",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    val handleEvent: (ZkV2UiEvent) -> Unit = { event ->
        when (event) {
            is ZkV2UiEvent.SelectAuthTab -> {
                formState = formState.copy(useRecoveryCodeTab = event.useRecoveryCode, errorMessage = null)
            }
            ZkV2UiEvent.PickKeyFile -> {
                safKeyFileLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
            }
            is ZkV2UiEvent.UpdateUsername -> {
                formState = formState.copy(usernameInput = event.value, errorMessage = null)
            }
            is ZkV2UiEvent.UpdateRecoveryCode -> {
                formState = formState.copy(recoveryCodeInput = event.value, errorMessage = null)
            }
            is ZkV2UiEvent.UpdatePassphrase -> {
                formState = formState.copy(passphraseInput = event.value, errorMessage = null)
            }
            ZkV2UiEvent.SubmitLogin -> executeLogin()
            ZkV2UiEvent.UnlockWithBiometrics -> executeBiometricUnlock()
            ZkV2UiEvent.ConfirmTofuCertificate -> {
                val challenge = formState.tofuChallenge
                if (challenge != null) {
                    sessionManager.apiClient.confirmTofuServer(challenge)
                    formState = formState.copy(tofuChallenge = null)
                    executeLogin()
                }
            }
            ZkV2UiEvent.DismissTofuDialogs -> {
                formState = formState.copy(tofuChallenge = null, tofuMismatch = null)
            }
            ZkV2UiEvent.DismissKdfWarning -> sessionManager.dismissKdfWarning()
            ZkV2UiEvent.EnrollBiometricUnlock -> {
                if (session.keyProtectionStatus?.biometricEnrolled == true) {
                    sessionManager.vaultKeyStore.clearBiometricWrappedVk()
                    sessionManager.lock("Sblocco biometrico rimosso. Riaccesso richiesto.")
                } else {
                    executeBiometricEnroll()
                }
            }
            is ZkV2UiEvent.ToggleBackgroundBackupKey -> {
                try {
                    if (event.enabled) {
                        sessionManager.enableBackgroundBackupKey()
                    } else {
                        sessionManager.disableBackgroundBackupKey()
                        ZkAutoBackupWorker.cancelAllWork(context)
                    }
                } catch (t: Throwable) {
                    Toast.makeText(context, t.message ?: "Errore KeyStore background", Toast.LENGTH_SHORT).show()
                }
            }
            is ZkV2UiEvent.SetAutoLockConfig -> {
                sessionManager.setAutoLockConfig(event.timeoutMs, event.lockOnBackground)
            }
            ZkV2UiEvent.LockNow -> {
                keyFileJsonInMemory = null
                transferManager.pauseAll()
                vaultRepository.onLockOrBackground()
                formState = formState.copy(
                    passphraseInput = "",
                    recoveryCodeInput = "",
                    showRewrapDialog = false,
                    rewrapOldPassphrase = "",
                    rewrapNewPassphrase = "",
                    rewrapConfirmPassphrase = "",
                    rewrapRecoveryCode = ""
                )
                sessionManager.lock("Vault bloccato manualmente.")
            }
            ZkV2UiEvent.OpenRewrapDialog -> {
                formState = formState.copy(
                    showRewrapDialog = true,
                    rewrapError = null,
                    rewrapOldPassphrase = "",
                    rewrapNewPassphrase = "",
                    rewrapConfirmPassphrase = "",
                    rewrapRecoveryCode = ""
                )
            }
            ZkV2UiEvent.DismissRewrapDialog -> {
                formState = formState.copy(
                    showRewrapDialog = false,
                    rewrapOldPassphrase = "",
                    rewrapNewPassphrase = "",
                    rewrapConfirmPassphrase = "",
                    rewrapRecoveryCode = "",
                    rewrapError = null
                )
            }
            is ZkV2UiEvent.UpdateRewrapFields -> {
                formState = formState.copy(
                    rewrapOldPassphrase = event.oldPass,
                    rewrapNewPassphrase = event.newPass,
                    rewrapConfirmPassphrase = event.confirmPass,
                    rewrapRecoveryCode = event.recoveryCode,
                    rewrapError = null
                )
            }
            ZkV2UiEvent.SubmitRewrap -> {
                val cur = formState
                if (cur.rewrapNewPassphrase != cur.rewrapConfirmPassphrase) {
                    formState = cur.copy(rewrapError = "Le due nuove passphrase non corrispondono.")
                } else {
                    formState = cur.copy(isBusy = true, rewrapError = null)
                    scope.launch {
                        try {
                            sessionManager.changePassphrase(
                                oldPassphrase = cur.rewrapOldPassphrase,
                                newPassphrase = cur.rewrapNewPassphrase,
                                recoveryCodeOrNull = cur.rewrapRecoveryCode.ifBlank { null }
                            )
                            formState = formState.copy(
                                isBusy = false,
                                showRewrapDialog = false,
                                rewrapOldPassphrase = "",
                                rewrapNewPassphrase = "",
                                rewrapConfirmPassphrase = "",
                                rewrapRecoveryCode = "",
                                rewrapError = null
                            )
                            Toast.makeText(
                                context,
                                "Passphrase ruotata (/account/rewrap) senza ricifrare i file.",
                                Toast.LENGTH_LONG
                            ).show()
                        } catch (t: Throwable) {
                            formState = formState.copy(
                                isBusy = false,
                                rewrapError = t.message ?: "Errore rotazione passphrase."
                            )
                        }
                    }
                }
            }
            ZkV2UiEvent.Logout -> {
                scope.launch {
                    keyFileJsonInMemory = null
                    transferManager.cancelAll()
                    ZkAutoBackupWorker.cancelAllWork(context)
                    resumableStore.clearAll()
                    ZkBlobUploadPipeline.cleanupOrphanSpoolFiles(spoolDir)
                    vaultRepository.onLogout()
                    formState = formState.copy(
                        passphraseInput = "",
                        recoveryCodeInput = "",
                        showRewrapDialog = false,
                        rewrapOldPassphrase = "",
                        rewrapNewPassphrase = "",
                        rewrapConfirmPassphrase = "",
                        rewrapRecoveryCode = ""
                    )
                    sessionManager.logout()
                }
            }
            ZkV2UiEvent.OpenServerConfig -> onOpenServerConfig()
            ZkV2UiEvent.ExitV2BetaToLegacy -> onExitV2Mode()
        }
    }

    ZkV2AuthScreen(
        session = session,
        form = effectiveForm,
        unlockedContent = {
            ZkV2VaultScreen(
                session = session,
                form = effectiveForm,
                repository = vaultRepository,
                transferManager = transferManager,
                onAuthEvent = handleEvent
            )
        },
        onEvent = handleEvent
    )
}

@Composable
fun ZkV2AuthScreen(
    session: ZkSessionSnapshot,
    form: ZkV2LoginFormUiState,
    unlockedContent: (@Composable () -> Unit)? = null,
    onEvent: (ZkV2UiEvent) -> Unit
) {
    var showPassphrase by remember { mutableStateOf(false) }

    if (session.isUnlocked && unlockedContent != null) {
        unlockedContent()
    } else {
        Scaffold { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .padding(innerPadding)
                    .imePadding()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Server URL Bar
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (!session.isUnlocked) {
                            TextButton(onClick = { onEvent(ZkV2UiEvent.ExitV2BetaToLegacy) }) {
                                Text("Torna a v1 (Legacy)")
                            }
                        } else {
                            Spacer(Modifier.width(8.dp))
                        }

                        Surface(
                            onClick = { onEvent(ZkV2UiEvent.OpenServerConfig) },
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceContainerHigh
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Dns,
                                    contentDescription = "Server v2",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = form.serverUrl.removePrefix("https://").removePrefix("http://"),
                                    style = MaterialTheme.typography.labelMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(16.dp))

                    if (!session.isUnlocked) {
                        ZkV2LoginCard(
                            session = session,
                            form = form,
                            showPassphrase = showPassphrase,
                            onToggleShowPassphrase = { showPassphrase = !showPassphrase },
                            onEvent = onEvent
                        )
                    } else {
                        ZkV2UnlockedSessionCard(
                            session = session,
                            form = form,
                            onEvent = onEvent
                        )
                    }
                }
            }
        }
    }

    if (form.tofuChallenge != null) {
        val ch = form.tofuChallenge
        AlertDialog(
            onDismissRequest = { onEvent(ZkV2UiEvent.DismissTofuDialogs) },
            icon = { Icon(Icons.Default.Security, contentDescription = null) },
            title = { Text("Verifica Certificato Server (TOFU)", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Il server HTTPS ${ch.hostPort} usa un certificato autofirmato o CA privata. Verifica il fingerprint prima di procedere:",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        text = "SPKI Pin:\n${ch.spkiPin}",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace
                    )
                    Text(
                        text = "SHA-256:\n${ch.certSha256Hex.chunked(16).joinToString(" ")}",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace
                    )
                    if (ch.subject.isNotBlank()) {
                        Text("Subject: ${ch.subject}", style = MaterialTheme.typography.labelSmall)
                    }
                }
            },
            confirmButton = {
                Button(onClick = { onEvent(ZkV2UiEvent.ConfirmTofuCertificate) }) {
                    Text("Autorizza e Salva Pin")
                }
            },
            dismissButton = {
                TextButton(onClick = { onEvent(ZkV2UiEvent.DismissTofuDialogs) }) {
                    Text("Annulla")
                }
            }
        )
    }

    if (form.tofuMismatch != null) {
        val mm = form.tofuMismatch
        AlertDialog(
            onDismissRequest = { onEvent(ZkV2UiEvent.DismissTofuDialogs) },
            icon = {
                Icon(
                    Icons.Default.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error
                )
            },
            title = {
                Text(
                    "Avviso Sicurezza: Chiave Server Cambiata",
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Il certificato di ${mm.hostPort} non corrisponde al fingerprint SPKI salvato (possibile attacco MITM).",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        text = "Atteso: ${mm.expectedSpkiPin}\nRicevuto: ${mm.actualSpkiPin}",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace
                    )
                }
            },
            confirmButton = {
                FilledTonalButton(onClick = { onEvent(ZkV2UiEvent.DismissTofuDialogs) }) {
                    Text("Chiudi e Blocca")
                }
            }
        )
    }

    if (form.showRewrapDialog) {
        AlertDialog(
            onDismissRequest = { onEvent(ZkV2UiEvent.DismissRewrapDialog) },
            title = { Text("Cambia Passphrase (/account/rewrap)", fontWeight = FontWeight.SemiBold) },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.verticalScroll(rememberScrollState())
                ) {
                    Text(
                        text = "Ruota la chiave di wrapping senza ricifrare i file del vault. Minimo $MIN_PASSPHRASE_LENGTH caratteri.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (!session.canRewrapInMemory) {
                        OutlinedTextField(
                            value = form.rewrapRecoveryCode,
                            onValueChange = {
                                onEvent(
                                    ZkV2UiEvent.UpdateRewrapFields(
                                        form.rewrapOldPassphrase,
                                        form.rewrapNewPassphrase,
                                        form.rewrapConfirmPassphrase,
                                        it
                                    )
                                )
                            },
                            label = { Text("Recovery Code (richiesto dopo sblocco biometrico)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    OutlinedTextField(
                        value = form.rewrapOldPassphrase,
                        onValueChange = {
                            onEvent(
                                ZkV2UiEvent.UpdateRewrapFields(
                                    it,
                                    form.rewrapNewPassphrase,
                                    form.rewrapConfirmPassphrase,
                                    form.rewrapRecoveryCode
                                )
                            )
                        },
                        label = { Text("Passphrase attuale") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = form.rewrapNewPassphrase,
                        onValueChange = {
                            onEvent(
                                ZkV2UiEvent.UpdateRewrapFields(
                                    form.rewrapOldPassphrase,
                                    it,
                                    form.rewrapConfirmPassphrase,
                                    form.rewrapRecoveryCode
                                )
                            )
                        },
                        label = { Text("Nuova passphrase (min 12 caratteri)") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = form.rewrapConfirmPassphrase,
                        onValueChange = {
                            onEvent(
                                ZkV2UiEvent.UpdateRewrapFields(
                                    form.rewrapOldPassphrase,
                                    form.rewrapNewPassphrase,
                                    it,
                                    form.rewrapRecoveryCode
                                )
                            )
                        },
                        label = { Text("Conferma nuova passphrase") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    if (form.rewrapError != null) {
                        Text(
                            text = form.rewrapError,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    enabled = !form.isBusy,
                    onClick = { onEvent(ZkV2UiEvent.SubmitRewrap) }
                ) {
                    Text("Applica Rewrap")
                }
            },
            dismissButton = {
                TextButton(onClick = { onEvent(ZkV2UiEvent.DismissRewrapDialog) }) {
                    Text("Annulla")
                }
            }
        )
    }
}

@Composable
private fun ZkV2LoginCard(
    session: ZkSessionSnapshot,
    form: ZkV2LoginFormUiState,
    showPassphrase: Boolean,
    onToggleShowPassphrase: () -> Unit,
    onEvent: (ZkV2UiEvent) -> Unit
) {
    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        tonalElevation = 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 440.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Default.Security,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(44.dp)
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = "PhotoCloud Zero-Knowledge v2",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "La registrazione dei nuovi account avviene esclusivamente dall'app Web (/v2).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            if (session.lockReason != null) {
                Spacer(Modifier.height(12.dp))
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = session.lockReason,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            if (form.kdfWarning != null) {
                Spacer(Modifier.height(12.dp))
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "Avviso Pinning KDF (${form.kdfWarning.username})",
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.labelLarge
                        )
                        Text(
                            text = "I parametri Argon2id/salt del server sono cambiati rispetto al valore salvato localmente (${form.kdfWarning.previousParams.memoryKiB} KiB -> ${form.kdfWarning.newParams.memoryKiB} KiB).",
                            style = MaterialTheme.typography.bodySmall
                        )
                        TextButton(onClick = { onEvent(ZkV2UiEvent.DismissKdfWarning) }) {
                            Text("Ho capito")
                        }
                    }
                }
            }

            if (form.hasBiometricSavedVk && form.canUseStrongBiometrics) {
                Spacer(Modifier.height(16.dp))
                FilledTonalButton(
                    onClick = { onEvent(ZkV2UiEvent.UnlockWithBiometrics) },
                    shape = CircleShape,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                ) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "Sblocca con Biometria Forte" +
                            (form.savedUsername?.let { " ($it)" } ?: ""),
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
            ) {
                Row(modifier = Modifier.fillMaxSize().padding(4.dp)) {
                    Surface(
                        onClick = { onEvent(ZkV2UiEvent.SelectAuthTab(useRecoveryCode = false)) },
                        shape = CircleShape,
                        color = if (!form.useRecoveryCodeTab) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                        modifier = Modifier.weight(1f).fillMaxHeight()
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("File Chiave", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                    Surface(
                        onClick = { onEvent(ZkV2UiEvent.SelectAuthTab(useRecoveryCode = true)) },
                        shape = CircleShape,
                        color = if (form.useRecoveryCodeTab) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                        modifier = Modifier.weight(1f).fillMaxHeight()
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("Recovery Code", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            if (form.errorMessage != null) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(12.dp)
                    ) {
                        Icon(
                            Icons.Default.ErrorOutline,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = form.errorMessage,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }

            if (!form.useRecoveryCodeTab) {
                Surface(
                    onClick = { onEvent(ZkV2UiEvent.PickKeyFile) },
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(86.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 16.dp)
                    ) {
                        Icon(
                            imageVector = if (form.hasKeyFileLoaded) Icons.Default.CheckCircle else Icons.Default.UploadFile,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = form.selectedKeyFileName ?: "Seleziona File Chiave (.json) via SAF",
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                if (form.usernameInput.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "Account rilevato: ${form.usernameInput}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            } else {
                OutlinedTextField(
                    value = form.usernameInput,
                    onValueChange = { onEvent(ZkV2UiEvent.UpdateUsername(it)) },
                    label = { Text("Username") },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = form.recoveryCodeInput,
                    onValueChange = { onEvent(ZkV2UiEvent.UpdateRecoveryCode(it)) },
                    label = { Text("Recovery Code (64 char hex)") },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = form.passphraseInput,
                onValueChange = { onEvent(ZkV2UiEvent.UpdatePassphrase(it)) },
                label = { Text("Passphrase") },
                singleLine = true,
                visualTransformation = if (showPassphrase) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = onToggleShowPassphrase) {
                        Icon(
                            imageVector = if (showPassphrase) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            contentDescription = if (showPassphrase) "Nascondi passphrase" else "Mostra passphrase"
                        )
                    }
                },
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(18.dp))

            Button(
                onClick = { onEvent(ZkV2UiEvent.SubmitLogin) },
                enabled = !form.isBusy,
                shape = CircleShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp)
            ) {
                if (form.isBusy) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Icon(Icons.Default.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Deriva Chiavi e Sblocca Vault", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun ZkV2UnlockedSessionCard(
    session: ZkSessionSnapshot,
    form: ZkV2LoginFormUiState,
    onEvent: (ZkV2UiEvent) -> Unit
) {
    val keyStatus = session.keyProtectionStatus

    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        tonalElevation = 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 460.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        text = "Sessione Zero-Knowledge v2 Attiva",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Utente: ${session.username ?: "-"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (form.kdfWarning != null) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "Parametri KDF aggiornati dal server (${form.kdfWarning.previousParams.memoryKiB} -> ${form.kdfWarning.newParams.memoryKiB} KiB)",
                            style = MaterialTheme.typography.bodySmall
                        )
                        TextButton(onClick = { onEvent(ZkV2UiEvent.DismissKdfWarning) }) {
                            Text("OK")
                        }
                    }
                }
            }

            // Keystore Protection Card
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "AndroidKeyStore Hardware Protection",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                    val hwSummary = when {
                        keyStatus == null -> "Stato non inizializzato"
                        keyStatus.strongBoxBacked -> "StrongBox Hardware SE attivo"
                        keyStatus.hardwareBacked -> "TEE Hardware KeyStore attivo (StrongBox non disponibile)"
                        else -> "Chiavi hardware da configurare"
                    }
                    Text(
                        text = hwSummary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    if (form.canUseStrongBiometrics) {
                        FilledTonalButton(
                            onClick = { onEvent(ZkV2UiEvent.EnrollBiometricUnlock) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.Fingerprint, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text(
                                if (keyStatus?.biometricEnrolled == true) {
                                    "Disattiva Sblocco Biometrico (KeyStore)"
                                } else {
                                    "Attiva Sblocco Biometrico (CryptoObject)"
                                }
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Chiave Background (setUnlockedDeviceRequired)",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                text = "Prepara la chiave separata per Fase 4C AutoBackup",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = keyStatus?.backgroundEnrolled == true,
                            onCheckedChange = { onEvent(ZkV2UiEvent.ToggleBackgroundBackupKey(it)) }
                        )
                    }
                }
            }

            // Auto-Lock & Lifecycle Card
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "Auto-Lock e Memoria",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Blocca su passaggio in background", style = MaterialTheme.typography.bodySmall)
                        Switch(
                            checked = session.lockOnBackground,
                            onCheckedChange = {
                                onEvent(ZkV2UiEvent.SetAutoLockConfig(session.autoLockTimeoutMs, it))
                            }
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf(
                            5 * 60 * 1000L to "5m",
                            15 * 60 * 1000L to "15m",
                            30 * 60 * 1000L to "30m"
                        ).forEach { (ms, label) ->
                            val selected = session.autoLockTimeoutMs == ms
                            OutlinedButton(
                                onClick = {
                                    onEvent(ZkV2UiEvent.SetAutoLockConfig(ms, session.lockOnBackground))
                                },
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                colors = if (selected) {
                                    ButtonDefaults.outlinedButtonColors(
                                        containerColor = MaterialTheme.colorScheme.primaryContainer
                                    )
                                } else {
                                    ButtonDefaults.outlinedButtonColors()
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(label)
                            }
                        }
                    }
                }
            }

            Text(
                text = "Galleria E2EE, upload/backup streaming, viewer e editor verranno integrati nelle fasi 4C e 4D.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                FilledTonalButton(
                    onClick = { onEvent(ZkV2UiEvent.LockNow) },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Blocca Ora")
                }
                OutlinedButton(
                    onClick = { onEvent(ZkV2UiEvent.OpenRewrapDialog) },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Passphrase")
                }
            }

            Button(
                onClick = { onEvent(ZkV2UiEvent.Logout) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer
                ),
                shape = CircleShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Disconnetti e Cancella Chiavi", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
