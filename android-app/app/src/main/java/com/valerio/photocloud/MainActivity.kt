package com.valerio.photocloud

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.ManageSearch
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class GroupingMode(val label: String) {
    NONE("Tutti"),
    DAY("Giorno"),
    MONTH("Mese"),
    YEAR("Anno")
}

enum class VaultTab {
    GALLERY,
    TRASH
}

/**
 * PhotoCloud 100% Native Android Client v1.0.3
 * - Native Biometric Authentication (BiometricPrompt: Fingerprint / Face Unlock + Quick Biometric Login)
 * - Pure Jetpack Compose Material You (MD3 Dynamic Color) UI — NO WebView
 * - 120Hz High Refresh Rate display mode & spring physics
 * - Bottom Floating Bar (Material You Pill Bar)
 * - Instant Fullscreen 120Hz Lightbox with HorizontalPager + Pinch-to-Zoom
 */
class MainActivity : FragmentActivity() {

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
                val bestMode = display?.supportedModes?.maxByOrNull { it.refreshRate }
                if (bestMode != null) {
                    params.preferredDisplayModeId = bestMode.modeId
                }
            }
            window.attributes = params
        } catch (_: Exception) {
        }
    }

    fun canUseBiometrics(): Boolean {
        val manager = BiometricManager.from(this)
        val authenticators = BIOMETRIC_STRONG or BIOMETRIC_WEAK or DEVICE_CREDENTIAL
        return manager.canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    }

    fun showBiometricPrompt(
        title: String = "Sblocca PhotoCloud",
        subtitle: String = "Usa l'impronta digitale o il riconoscimento facciale per accedere all'archivio",
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(this)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                super.onAuthenticationSucceeded(result)
                onSuccess()
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

        val prompt = BiometricPrompt(this, executor, callback)
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(BIOMETRIC_STRONG or BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
            .build()

        prompt.authenticate(promptInfo)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableHighRefreshRate120Hz()

        val prefs = getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        val initialServerUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL)
            ?: BuildConfig.DEFAULT_SERVER_URL

        val apiClient = PhotoCloudApiClient(applicationContext, initialServerUrl)

        setContent {
            val context = LocalContext.current
            val systemDark = isSystemInDarkTheme()
            var isDarkTheme by remember {
                mutableStateOf(prefs.getBoolean("dark_mode", systemDark))
            }

            val colorScheme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (isDarkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            } else {
                if (isDarkTheme) darkColorScheme() else lightColorScheme()
            }

            MaterialTheme(colorScheme = colorScheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    PhotoCloudNativeApp(
                        activity = this@MainActivity,
                        apiClient = apiClient,
                        initialServerUrl = initialServerUrl,
                        isDarkTheme = isDarkTheme,
                        onToggleTheme = {
                            val next = !isDarkTheme
                            isDarkTheme = next
                            prefs.edit().putBoolean("dark_mode", next).apply()
                        },
                        onSaveServerUrl = { newUrl ->
                            val cleaned = newUrl.trim().removeSuffix("/")
                            apiClient.baseUrl = cleaned
                            prefs.edit().putString("server_url", cleaned).apply()
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun PhotoCloudNativeApp(
    activity: MainActivity,
    apiClient: PhotoCloudApiClient,
    initialServerUrl: String,
    isDarkTheme: Boolean,
    onToggleTheme: () -> Unit,
    onSaveServerUrl: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { context.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE) }

    var serverUrl by remember { mutableStateOf(initialServerUrl) }
    var showServerDialog by remember { mutableStateOf(false) }
    var tempServerInput by remember { mutableStateOf(serverUrl) }

    var biometricEnabled by remember {
        mutableStateOf(prefs.getBoolean("biometric_enabled", true))
    }

    // 0ms Instant Startup Hydration: synchronously read cookie presence and cached metadata
    var isAuthenticated by remember(serverUrl) {
        mutableStateOf(apiClient.hasActiveSessionCookie())
    }
    var isBiometricLocked by remember(serverUrl) {
        mutableStateOf(
            apiClient.hasActiveSessionCookie() &&
                prefs.getBoolean("biometric_enabled", true) &&
                activity.canUseBiometrics()
        )
    }

    var savedKeyBytes by remember {
        mutableStateOf<ByteArray?>(
            prefs.getString("saved_auth_key_b64", null)?.let {
                try {
                    Base64.decode(it, Base64.DEFAULT)
                } catch (_: Exception) {
                    null
                }
            }
        )
    }

    var galleryItems by remember(serverUrl) {
        mutableStateOf(apiClient.getCachedGalleryItems())
    }
    var trashItems by remember(serverUrl) {
        mutableStateOf(apiClient.getCachedTrashItems())
    }
    var infoDialogMessage by remember { mutableStateOf<String?>(null) }

    fun saveKeyForBiometrics(bytes: ByteArray) {
        savedKeyBytes = bytes
        val b64 = Base64.encodeToString(bytes, Base64.DEFAULT)
        prefs.edit().putString("saved_auth_key_b64", b64).apply()
    }

    fun refreshVaultSilently() {
        scope.launch {
            when (val syncResult = apiClient.syncGallerySession()) {
                is GallerySyncResult.Authenticated -> {
                    isAuthenticated = true
                    galleryItems = syncResult.items
                    trashItems = apiClient.fetchTrashItems()
                }
                is GallerySyncResult.Unauthenticated -> {
                    apiClient.clearCookies()
                    isAuthenticated = false
                    isBiometricLocked = false
                    galleryItems = emptyList()
                    trashItems = emptyList()
                }
                is GallerySyncResult.NetworkError -> {
                    // Keep showing cached items without interrupting the user
                }
            }
        }
    }

    // Trigger BiometricPrompt immediately at 0ms if vault is locked on startup
    LaunchedEffect(isAuthenticated, isBiometricLocked) {
        if (isAuthenticated && isBiometricLocked) {
            activity.showBiometricPrompt(
                onSuccess = { isBiometricLocked = false },
                onError = { msg -> Toast.makeText(context, msg, Toast.LENGTH_SHORT).show() }
            )
        }
    }

    // Silent background sync only when a session cookie exists
    LaunchedEffect(serverUrl) {
        if (apiClient.hasActiveSessionCookie()) {
            refreshVaultSilently()
        }
    }

    if (isAuthenticated && isBiometricLocked) {
        NativeBiometricLockScreen(
            onUnlockClick = {
                activity.showBiometricPrompt(
                    onSuccess = { isBiometricLocked = false },
                    onError = { msg -> Toast.makeText(context, msg, Toast.LENGTH_SHORT).show() }
                )
            },
            onSwitchAccount = {
                scope.launch {
                    apiClient.logout()
                    isAuthenticated = false
                    isBiometricLocked = false
                }
            }
        )
    } else if (!isAuthenticated) {
        NativeAuthScreen(
            activity = activity,
            apiClient = apiClient,
            serverUrl = serverUrl,
            savedKeyBytes = savedKeyBytes,
            onSaveKeyForBiometrics = { saveKeyForBiometrics(it) },
            onOpenServerConfig = {
                tempServerInput = serverUrl
                showServerDialog = true
            },
            onLoginSuccess = {
                isAuthenticated = true
                isBiometricLocked = false
                galleryItems = apiClient.getCachedGalleryItems()
                trashItems = apiClient.getCachedTrashItems()
                refreshVaultSilently()
            },
            onShowInfo = { msg ->
                infoDialogMessage = msg
            }
        )
    } else {
        NativeVaultScreen(
            apiClient = apiClient,
            galleryItems = galleryItems,
            trashItems = trashItems,
            isDarkTheme = isDarkTheme,
            biometricEnabled = biometricEnabled,
            onToggleBiometric = {
                val next = !biometricEnabled
                biometricEnabled = next
                prefs.edit().putBoolean("biometric_enabled", next).apply()
                Toast.makeText(
                    context,
                    if (next) "Blocco biometrico attivato" else "Blocco biometrico disattivato",
                    Toast.LENGTH_SHORT
                ).show()
            },
            onLockNow = {
                if (activity.canUseBiometrics()) {
                    isBiometricLocked = true
                } else {
                    Toast.makeText(context, "Biometria non configurata sul dispositivo", Toast.LENGTH_SHORT).show()
                }
            },
            onToggleTheme = onToggleTheme,
            onRefresh = { refreshVaultSilently() },
            onOpenServerConfig = {
                tempServerInput = serverUrl
                showServerDialog = true
            },
            onLogout = {
                scope.launch {
                    apiClient.logout()
                    isAuthenticated = false
                    galleryItems = emptyList()
                    trashItems = emptyList()
                }
            },
            onShowInfo = { msg ->
                Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
            }
        )
    }

    if (showServerDialog) {
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            shape = RoundedCornerShape(28.dp),
            title = { Text("Server PhotoCloud Locale", fontWeight = FontWeight.SemiBold) },
            text = {
                OutlinedTextField(
                    value = tempServerInput,
                    onValueChange = { tempServerInput = it },
                    label = { Text("Indirizzo (es. http://192.168.1.100:5000)") },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        val cleaned = tempServerInput.trim().removeSuffix("/")
                        if (cleaned.isNotBlank()) {
                            serverUrl = cleaned
                            onSaveServerUrl(cleaned)
                        }
                        showServerDialog = false
                    }
                ) {
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

    if (infoDialogMessage != null) {
        AlertDialog(
            onDismissRequest = { infoDialogMessage = null },
            shape = RoundedCornerShape(28.dp),
            title = { Text("PhotoCloud", fontWeight = FontWeight.SemiBold) },
            text = { Text(infoDialogMessage ?: "") },
            confirmButton = {
                FilledTonalButton(onClick = { infoDialogMessage = null }) {
                    Text("OK")
                }
            }
        )
    }
}

@Composable
fun NativeBiometricLockScreen(
    onUnlockClick: () -> Unit,
    onSwitchAccount: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(32.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            tonalElevation = 4.dp,
            modifier = Modifier.fillMaxWidth().widthIn(max = 380.dp)
        ) {
            Column(
                modifier = Modifier.padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.size(76.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Fingerprint,
                            contentDescription = "Biometria",
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(42.dp)
                        )
                    }
                }

                Spacer(Modifier.height(20.dp))

                Text(
                    text = "Archivio Protetto",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Autenticati con impronta o volto per sbloccare le tue foto",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(28.dp))

                Button(
                    onClick = onUnlockClick,
                    shape = CircleShape,
                    modifier = Modifier.fillMaxWidth().height(52.dp)
                ) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Sblocca con Biometria", fontWeight = FontWeight.SemiBold)
                }

                Spacer(Modifier.height(10.dp))

                TextButton(onClick = onSwitchAccount) {
                    Text("Cambia account")
                }
            }
        }
    }
}

@Composable
fun NativeAuthScreen(
    activity: MainActivity,
    apiClient: PhotoCloudApiClient,
    serverUrl: String,
    savedKeyBytes: ByteArray?,
    onSaveKeyForBiometrics: (ByteArray) -> Unit,
    onOpenServerConfig: () -> Unit,
    onLoginSuccess: () -> Unit,
    onShowInfo: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var isRegisterTab by remember { mutableStateOf(false) }
    var isBusy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    var selectedFileName by remember { mutableStateOf<String?>(null) }
    var selectedFileBytes by remember { mutableStateOf<ByteArray?>(null) }

    var username by remember { mutableStateOf("") }
    var useCustomKey by remember { mutableStateOf(false) }
    var customKey by remember { mutableStateOf("") }
    var showCustomPassword by remember { mutableStateOf(false) }

    val authFileLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri != null) {
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null) {
                    selectedFileBytes = bytes
                    selectedFileName = uri.lastPathSegment?.substringAfterLast('/') ?: "photocloud_auth.json"
                    errorMessage = null
                }
            } catch (_: Exception) {
                errorMessage = "Impossibile leggere il file selezionato"
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(20.dp)
    ) {
        Surface(
            onClick = onOpenServerConfig,
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.align(Alignment.TopEnd)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Dns,
                    contentDescription = "Server",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = serverUrl.replace("http://", "").replace("https://", ""),
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
                .widthIn(max = 420.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(
                shape = RoundedCornerShape(32.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                tonalElevation = 2.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "PhotoCloud",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "Archivio foto e video crittografato",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(Modifier.height(24.dp))

                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceContainerHighest,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                    ) {
                        Row(modifier = Modifier.fillMaxSize().padding(4.dp)) {
                            Surface(
                                onClick = {
                                    isRegisterTab = false
                                    errorMessage = null
                                },
                                shape = CircleShape,
                                color = if (!isRegisterTab) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                                modifier = Modifier.weight(1f).fillMaxHeight()
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        text = "Accedi",
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (!isRegisterTab) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            Surface(
                                onClick = {
                                    isRegisterTab = true
                                    errorMessage = null
                                },
                                shape = CircleShape,
                                color = if (isRegisterTab) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                                modifier = Modifier.weight(1f).fillMaxHeight()
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        text = "Registrati",
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (isRegisterTab) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))

                    if (errorMessage != null) {
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme.errorContainer,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
                        ) {
                            Text(
                                text = errorMessage ?: "",
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }

                    if (!isRegisterTab) {
                        // Quick Biometric Login if a key was previously used on this phone
                        if (savedKeyBytes != null && activity.canUseBiometrics()) {
                            FilledTonalButton(
                                onClick = {
                                    activity.showBiometricPrompt(
                                        title = "Accesso Biometrico PhotoCloud",
                                        subtitle = "Conferma la tua identità per accedere con la chiave salvata",
                                        onSuccess = {
                                            isBusy = true
                                            errorMessage = null
                                            scope.launch {
                                                val (ok, err) = apiClient.loginWithAuthBytes(savedKeyBytes)
                                                isBusy = false
                                                if (ok) {
                                                    onLoginSuccess()
                                                } else {
                                                    errorMessage = err
                                                }
                                            }
                                        },
                                        onError = { err ->
                                            errorMessage = err
                                        }
                                    )
                                },
                                enabled = !isBusy,
                                shape = CircleShape,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(52.dp)
                            ) {
                                Icon(Icons.Default.Fingerprint, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("Accedi con Impronta / Volto", fontWeight = FontWeight.SemiBold)
                            }

                            Spacer(Modifier.height(14.dp))
                        }

                        Surface(
                            onClick = { authFileLauncher.launch(arrayOf("*/*")) },
                            shape = RoundedCornerShape(20.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(104.dp)
                        ) {
                            Column(
                                modifier = Modifier.fillMaxSize().padding(16.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center
                            ) {
                                Icon(
                                    imageVector = if (selectedFileBytes != null) Icons.Default.CheckCircle else Icons.Default.UploadFile,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(30.dp)
                                )
                                Spacer(Modifier.height(8.dp))
                                Text(
                                    text = selectedFileName ?: "Tocca per scegliere il file chiave (.json)",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        Spacer(Modifier.height(18.dp))

                        Button(
                            onClick = {
                                val bytes = selectedFileBytes
                                if (bytes == null) {
                                    errorMessage = "Seleziona prima il file photocloud_auth_...json"
                                    return@Button
                                }
                                isBusy = true
                                errorMessage = null
                                scope.launch {
                                    val (ok, err) = apiClient.loginWithAuthBytes(bytes)
                                    isBusy = false
                                    if (ok) {
                                        onSaveKeyForBiometrics(bytes)
                                        onLoginSuccess()
                                    } else {
                                        errorMessage = err
                                    }
                                }
                            },
                            enabled = !isBusy,
                            shape = CircleShape,
                            modifier = Modifier.fillMaxWidth().height(52.dp)
                        ) {
                            if (isBusy) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(22.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary
                                )
                            } else {
                                Text("Accedi con File Chiave", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    } else {
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            label = { Text("Username") },
                            singleLine = true,
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(14.dp))

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { useCustomKey = !useCustomKey }
                                .padding(vertical = 6.dp)
                        ) {
                            Checkbox(
                                checked = useCustomKey,
                                onCheckedChange = { useCustomKey = it }
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = "Usa una chiave personalizzata",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }

                        if (useCustomKey) {
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = customKey,
                                onValueChange = { customKey = it },
                                label = { Text("Chiave personalizzata (min 8 caratteri)") },
                                singleLine = true,
                                visualTransformation = if (showCustomPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { showCustomPassword = !showCustomPassword }) {
                                        Icon(
                                            imageVector = if (showCustomPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                            contentDescription = null
                                        )
                                    }
                                },
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }

                        Spacer(Modifier.height(20.dp))

                        Button(
                            onClick = {
                                if (username.isBlank()) {
                                    errorMessage = "Inserisci un username valido"
                                    return@Button
                                }
                                if (useCustomKey && customKey.length < 8) {
                                    errorMessage = "La chiave personalizzata deve avere almeno 8 caratteri"
                                    return@Button
                                }
                                isBusy = true
                                errorMessage = null
                                scope.launch {
                                    val res = apiClient.registerUser(
                                        username = username,
                                        keyType = if (useCustomKey) "custom" else "generate",
                                        customKey = customKey
                                    )
                                    if (!res.success) {
                                        isBusy = false
                                        errorMessage = res.errorMessage
                                        return@launch
                                    }

                                    val keyBytes = res.jsonContent.toByteArray(Charsets.UTF_8)
                                    val saved = PhotoCloudApiClient.saveBytesToDownloads(
                                        context = context,
                                        filename = res.filename,
                                        bytes = keyBytes,
                                        mimeType = "application/json"
                                    )

                                    onSaveKeyForBiometrics(keyBytes)
                                    selectedFileBytes = keyBytes
                                    selectedFileName = res.filename
                                    val (loggedIn, _) = apiClient.loginWithAuthBytes(keyBytes)
                                    isBusy = false

                                    val saveNote = if (saved) {
                                        "Chiave salvata in Download: ${res.filename}"
                                    } else {
                                        "Account creato (${res.filename})"
                                    }
                                    Toast.makeText(context, saveNote, Toast.LENGTH_LONG).show()

                                    if (loggedIn) {
                                        onLoginSuccess()
                                    } else {
                                        isRegisterTab = false
                                        onShowInfo(saveNote)
                                    }
                                }
                            },
                            enabled = !isBusy,
                            shape = CircleShape,
                            modifier = Modifier.fillMaxWidth().height(52.dp)
                        ) {
                            if (isBusy) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(22.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary
                                )
                            } else {
                                Icon(Icons.Default.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Registrati e Scarica Chiave", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun NativeVaultScreen(
    apiClient: PhotoCloudApiClient,
    galleryItems: List<MediaItemModel>,
    trashItems: List<MediaItemModel>,
    isDarkTheme: Boolean,
    biometricEnabled: Boolean,
    onToggleBiometric: () -> Unit,
    onLockNow: () -> Unit,
    onToggleTheme: () -> Unit,
    onRefresh: () -> Unit,
    onOpenServerConfig: () -> Unit,
    onLogout: () -> Unit,
    onShowInfo: (String) -> Unit
) {
    val scope = rememberCoroutineScope()

    var currentTab by remember { mutableStateOf(VaultTab.GALLERY) }
    var groupingMode by remember { mutableStateOf(GroupingMode.MONTH) }
    var showGroupingMenu by remember { mutableStateOf(false) }

    var selectedFilenames by remember { mutableStateOf<Set<String>>(emptySet()) }
    var lightboxInitialIndex by remember { mutableStateOf<Int?>(null) }

    var isUploading by remember { mutableStateOf(false) }
    var uploadProgressText by remember { mutableStateOf("") }

    var isScanningDuplicates by remember { mutableStateOf(false) }
    var duplicateGroups by remember { mutableStateOf<List<List<String>>?>(null) }

    val activeItems = if (currentTab == VaultTab.GALLERY) galleryItems else trashItems
    val isFromTrash = currentTab == VaultTab.TRASH

    val uploadLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents()
    ) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            isUploading = true
            uploadProgressText = "Caricamento 0 / ${uris.size}..."
            scope.launch {
                val (ok, msg) = apiClient.uploadMediaUris(uris) { done, total ->
                    uploadProgressText = "Caricamento $done / $total..."
                }
                isUploading = false
                onShowInfo(msg)
                if (ok) {
                    onRefresh()
                }
            }
        }
    }

    val groupedSections = remember(activeItems, groupingMode, currentTab) {
        if (currentTab == VaultTab.TRASH || groupingMode == GroupingMode.NONE) {
            listOf("" to activeItems)
        } else {
            val fmt = when (groupingMode) {
                GroupingMode.DAY -> SimpleDateFormat("dd MMMM yyyy", Locale.ITALIAN)
                GroupingMode.MONTH -> SimpleDateFormat("MMMM yyyy", Locale.ITALIAN)
                GroupingMode.YEAR -> SimpleDateFormat("yyyy", Locale.ITALIAN)
                GroupingMode.NONE -> SimpleDateFormat("yyyy", Locale.ITALIAN)
            }
            activeItems.groupBy { item ->
                val label = fmt.format(Date((item.timestamp * 1000).toLong()))
                label.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ITALIAN) else it.toString() }
            }.toList()
        }
    }

    BackHandler(enabled = lightboxInitialIndex != null || selectedFilenames.isNotEmpty() || currentTab == VaultTab.TRASH) {
        when {
            lightboxInitialIndex != null -> lightboxInitialIndex = null
            selectedFilenames.isNotEmpty() -> selectedFilenames = emptySet()
            currentTab == VaultTab.TRASH -> currentTab = VaultTab.GALLERY
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Minimalist Material You Top Header
            Surface(
                color = MaterialTheme.colorScheme.background.copy(alpha = 0.92f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .statusBarsPadding()
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text(
                            text = if (currentTab == VaultTab.GALLERY) "Archivio" else "Cestino",
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = (-0.5).sp
                            ),
                            color = MaterialTheme.colorScheme.onBackground
                        )
                        Text(
                            text = "${activeItems.size} elementi",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        if (currentTab == VaultTab.GALLERY && activeItems.isNotEmpty()) {
                            Box {
                                Surface(
                                    onClick = { showGroupingMenu = true },
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh
                                ) {
                                    Text(
                                        text = groupingMode.label,
                                        style = MaterialTheme.typography.labelLarge,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
                                    )
                                }
                                DropdownMenu(
                                    expanded = showGroupingMenu,
                                    onDismissRequest = { showGroupingMenu = false }
                                ) {
                                    GroupingMode.entries.forEach { mode ->
                                        DropdownMenuItem(
                                            text = { Text(mode.label) },
                                            onClick = {
                                                groupingMode = mode
                                                showGroupingMenu = false
                                            }
                                        )
                                    }
                                }
                            }

                            IconButton(
                                onClick = {
                                    selectedFilenames = if (selectedFilenames.size == activeItems.size) {
                                        emptySet()
                                    } else {
                                        activeItems.map { it.filename }.toSet()
                                    }
                                }
                            ) {
                                Icon(
                                    imageVector = Icons.Default.DoneAll,
                                    contentDescription = "Seleziona tutto",
                                    tint = if (selectedFilenames.isNotEmpty()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        if (currentTab == VaultTab.TRASH && trashItems.isNotEmpty()) {
                            FilledTonalButton(
                                onClick = {
                                    scope.launch {
                                        if (apiClient.emptyTrash()) {
                                            onShowInfo("Cestino svuotato")
                                            onRefresh()
                                        }
                                    }
                                },
                                colors = ButtonDefaults.filledTonalButtonColors(
                                    containerColor = MaterialTheme.colorScheme.errorContainer,
                                    contentColor = MaterialTheme.colorScheme.onErrorContainer
                                ),
                                shape = CircleShape,
                                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                            ) {
                                Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Svuota", style = MaterialTheme.typography.labelLarge)
                            }
                        }

                        // Biometric toggle & instant lock
                        IconButton(onClick = onToggleBiometric) {
                            Icon(
                                imageVector = Icons.Default.Fingerprint,
                                contentDescription = "Blocco Biometrico",
                                tint = if (biometricEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        IconButton(onClick = onLockNow) {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = "Blocca ora",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        IconButton(onClick = onRefresh) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Aggiorna",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            if (isUploading || isScanningDuplicates) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 6.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = if (isUploading) uploadProgressText else "Scansione duplicati in corso...",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }
            }

            // Main 120Hz Photo Grid
            if (activeItems.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(bottom = 110.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = if (currentTab == VaultTab.GALLERY) Icons.Default.PhotoLibrary else Icons.Default.DeleteOutline,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.65f),
                            modifier = Modifier.size(52.dp)
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = if (currentTab == VaultTab.GALLERY) "Il tuo archivio è vuoto" else "Il cestino è vuoto",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = if (currentTab == VaultTab.GALLERY) "Tocca + Carica nella barra in basso" else "Gli elementi eliminati appariranno qui",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(
                        start = 6.dp,
                        end = 6.dp,
                        top = 6.dp,
                        bottom = 136.dp
                    ),
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    groupedSections.forEach { (sectionTitle, sectionItems) ->
                        if (sectionTitle.isNotBlank()) {
                            item(
                                key = "header_$sectionTitle",
                                span = { GridItemSpan(maxLineSpan) }
                            ) {
                                Text(
                                    text = sectionTitle,
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(start = 8.dp, top = 14.dp, bottom = 6.dp)
                                )
                            }
                        }

                        items(
                            items = sectionItems,
                            key = { it.filename }
                        ) { mediaItem ->
                            val isSelected = selectedFilenames.contains(mediaItem.filename)
                            MediaGridTile(
                                apiClient = apiClient,
                                item = mediaItem,
                                fromTrash = isFromTrash,
                                isSelected = isSelected,
                                inSelectionMode = selectedFilenames.isNotEmpty(),
                                onClick = {
                                    if (selectedFilenames.isNotEmpty() && currentTab == VaultTab.GALLERY) {
                                        selectedFilenames = if (isSelected) {
                                            selectedFilenames - mediaItem.filename
                                        } else {
                                            selectedFilenames + mediaItem.filename
                                        }
                                    } else {
                                        val globalIndex = activeItems.indexOfFirst { it.filename == mediaItem.filename }
                                        if (globalIndex >= 0) {
                                            lightboxInitialIndex = globalIndex
                                        }
                                    }
                                },
                                onLongClick = {
                                    if (currentTab == VaultTab.GALLERY) {
                                        selectedFilenames = if (isSelected) {
                                            selectedFilenames - mediaItem.filename
                                        } else {
                                            selectedFilenames + mediaItem.filename
                                        }
                                    }
                                },
                                onRestore = if (isFromTrash) {
                                    {
                                        scope.launch {
                                            if (apiClient.restoreFromTrash(mediaItem.filename)) {
                                                onShowInfo("Elemento ripristinato")
                                                onRefresh()
                                            }
                                        }
                                    }
                                } else null,
                                onDeletePermanent = if (isFromTrash) {
                                    {
                                        scope.launch {
                                            if (apiClient.deletePermanent(mediaItem.filename)) {
                                                onShowInfo("Eliminato definitivamente")
                                                onRefresh()
                                            }
                                        }
                                    }
                                } else null
                            )
                        }
                    }
                }
            }
        }

        // =========================================================================
        // === MATERIAL YOU BOTTOM FLOATING BAR (Anchored at Alignment.BottomCenter)
        // =========================================================================
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 14.dp)
        ) {
            AnimatedVisibility(
                visible = selectedFilenames.isNotEmpty() && currentTab == VaultTab.GALLERY,
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut()
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainerHighest,
                    tonalElevation = 8.dp,
                    shadowElevation = 12.dp,
                    modifier = Modifier.padding(bottom = 10.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        FilledTonalButton(
                            onClick = {
                                val toDownload = selectedFilenames.toList()
                                onShowInfo("Preparazione ZIP (${toDownload.size} file)...")
                                scope.launch {
                                    val (_, msg) = apiClient.downloadZipToDevice(toDownload)
                                    onShowInfo(msg)
                                    selectedFilenames = emptySet()
                                }
                            },
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Scarica (${selectedFilenames.size})")
                        }

                        Button(
                            onClick = {
                                val toTrash = selectedFilenames.toList()
                                scope.launch {
                                    if (apiClient.moveBatchToTrash(toTrash)) {
                                        onShowInfo("${toTrash.size} elementi spostati nel cestino")
                                        selectedFilenames = emptySet()
                                        onRefresh()
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.errorContainer,
                                contentColor = MaterialTheme.colorScheme.onErrorContainer
                            ),
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Cestina")
                        }

                        IconButton(
                            onClick = { selectedFilenames = emptySet() },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Deseleziona")
                        }
                    }
                }
            }

            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.96f),
                tonalElevation = 6.dp,
                shadowElevation = 16.dp,
                modifier = Modifier
                    .height(64.dp)
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f),
                        shape = CircleShape
                    )
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(horizontal = 10.dp)
                ) {
                    Surface(
                        onClick = {
                            currentTab = VaultTab.GALLERY
                            selectedFilenames = emptySet()
                        },
                        shape = CircleShape,
                        color = if (currentTab == VaultTab.GALLERY) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                        modifier = Modifier.height(46.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 14.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.PhotoLibrary,
                                contentDescription = "Foto",
                                tint = if (currentTab == VaultTab.GALLERY) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(21.dp)
                            )
                            if (currentTab == VaultTab.GALLERY) {
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = "Foto",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            }
                        }
                    }

                    Surface(
                        onClick = { uploadLauncher.launch("*/*") },
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.height(46.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 16.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Add,
                                contentDescription = "Carica",
                                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                modifier = Modifier.size(22.dp)
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = "Carica",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }

                    IconButton(
                        onClick = {
                            isScanningDuplicates = true
                            scope.launch {
                                val groups = apiClient.findDuplicates()
                                isScanningDuplicates = false
                                if (groups.isEmpty()) {
                                    onShowInfo("Nessun duplicato trovato")
                                } else {
                                    duplicateGroups = groups
                                }
                            }
                        },
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ManageSearch,
                            contentDescription = "Trova Duplicati",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Surface(
                        onClick = {
                            currentTab = VaultTab.TRASH
                            selectedFilenames = emptySet()
                        },
                        shape = CircleShape,
                        color = if (currentTab == VaultTab.TRASH) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                        modifier = Modifier.height(46.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 12.dp)
                        ) {
                            Icon(
                                imageVector = if (currentTab == VaultTab.TRASH) Icons.Default.Delete else Icons.Default.DeleteOutline,
                                contentDescription = "Cestino",
                                tint = if (currentTab == VaultTab.TRASH) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(21.dp)
                            )
                            if (currentTab == VaultTab.TRASH) {
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = "Cestino",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            }
                        }
                    }

                    IconButton(
                        onClick = onToggleTheme,
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = if (isDarkTheme) Icons.Default.DarkMode else Icons.Default.LightMode,
                            contentDescription = "Tema",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    IconButton(
                        onClick = onOpenServerConfig,
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Dns,
                            contentDescription = "Server",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    IconButton(
                        onClick = onLogout,
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Logout,
                            contentDescription = "Esci",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        val openIdx = lightboxInitialIndex
        if (openIdx != null && activeItems.isNotEmpty()) {
            NativeLightboxModal(
                apiClient = apiClient,
                items = activeItems,
                initialIndex = openIdx.coerceIn(0, activeItems.lastIndex),
                fromTrash = isFromTrash,
                onClose = { lightboxInitialIndex = null },
                onMoveToTrash = { filename ->
                    scope.launch {
                        if (apiClient.moveToTrash(filename)) {
                            onShowInfo("Spostato nel cestino")
                            lightboxInitialIndex = null
                            onRefresh()
                        }
                    }
                },
                onRestore = { filename ->
                    scope.launch {
                        if (apiClient.restoreFromTrash(filename)) {
                            onShowInfo("Elemento ripristinato")
                            lightboxInitialIndex = null
                            onRefresh()
                        }
                    }
                },
                onDownload = { filename ->
                    scope.launch {
                        val (_, msg) = apiClient.saveSingleMediaToDownloads(filename, isFromTrash)
                        onShowInfo(msg)
                    }
                }
            )
        }

        val dupGroups = duplicateGroups
        if (dupGroups != null) {
            val filesToTrash = remember(dupGroups) {
                dupGroups.flatMap { group -> group.sorted().drop(1) }
            }
            AlertDialog(
                onDismissRequest = { duplicateGroups = null },
                shape = RoundedCornerShape(28.dp),
                title = { Text("Duplicati Trovati (${dupGroups.size} gruppi)") },
                text = {
                    Text("Trovate ${filesToTrash.size} copie duplicate. Vuoi spostare i duplicati nel cestino mantenendo una copia originale per ciascun gruppo?")
                },
                confirmButton = {
                    Button(
                        onClick = {
                            duplicateGroups = null
                            scope.launch {
                                if (apiClient.moveBatchToTrash(filesToTrash)) {
                                    onShowInfo("${filesToTrash.size} duplicati spostati nel cestino")
                                    onRefresh()
                                }
                            }
                        }
                    ) {
                        Text("Sposta nel Cestino")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { duplicateGroups = null }) {
                        Text("Annulla")
                    }
                }
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MediaGridTile(
    apiClient: PhotoCloudApiClient,
    item: MediaItemModel,
    fromTrash: Boolean,
    isSelected: Boolean,
    inSelectionMode: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onRestore: (() -> Unit)? = null,
    onDeletePermanent: (() -> Unit)? = null
) {
    var bitmap by remember(item.filename, fromTrash) {
        mutableStateOf(apiClient.getCachedBitmap(item.filename, fromTrash))
    }
    var loadFailed by remember(item.filename) { mutableStateOf(false) }

    LaunchedEffect(item.filename, fromTrash) {
        if (bitmap == null && !item.isVideo) {
            val loaded = apiClient.loadMediaBitmap(item.filename, fromTrash)
            if (loaded != null) {
                bitmap = loaded
            } else {
                loadFailed = true
            }
        }
    }

    val scale by animateFloatAsState(
        targetValue = if (isSelected) 0.88f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioNoBouncy,
            stiffness = Spring.StiffnessMedium
        ),
        label = "tileScale"
    )

    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(if (isSelected) 18.dp else 10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .scale(scale)
                .clip(RoundedCornerShape(if (isSelected) 18.dp else 10.dp))
        ) {
            val currentBmp = bitmap
            if (currentBmp != null) {
                Image(
                    bitmap = currentBmp.asImageBitmap(),
                    contentDescription = item.filename,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else if (item.isVideo) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayCircleFilled,
                        contentDescription = "Video",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(40.dp)
                    )
                }
            } else if (!loadFailed) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PhotoLibrary,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.22f),
                        modifier = Modifier.size(24.dp)
                    )
                }
            } else {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.PhotoLibrary,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                    )
                }
            }
        }

        if (inSelectionMode || isSelected) {
            Surface(
                shape = CircleShape,
                color = if (isSelected) MaterialTheme.colorScheme.primary else Color.Black.copy(alpha = 0.35f),
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp)
                    .size(24.dp)
            ) {
                if (isSelected) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(15.dp)
                        )
                    }
                }
            }
        }

        if (onRestore != null && onDeletePermanent != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(6.dp)
            ) {
                Surface(
                    onClick = onRestore,
                    shape = CircleShape,
                    color = Color.Black.copy(alpha = 0.65f),
                    modifier = Modifier.size(32.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.RestoreFromTrash,
                            contentDescription = "Ripristina",
                            tint = Color.White,
                            modifier = Modifier.size(17.dp)
                        )
                    }
                }
                Surface(
                    onClick = onDeletePermanent,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.9f),
                    modifier = Modifier.size(32.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.DeleteForever,
                            contentDescription = "Elimina definitivamente",
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.size(17.dp)
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NativeLightboxModal(
    apiClient: PhotoCloudApiClient,
    items: List<MediaItemModel>,
    initialIndex: Int,
    fromTrash: Boolean,
    onClose: () -> Unit,
    onMoveToTrash: (String) -> Unit,
    onRestore: (String) -> Unit,
    onDownload: (String) -> Unit
) {
    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { items.size }
    )
    val currentItem = items.getOrNull(pagerState.currentPage) ?: items.first()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF08080A))
    ) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize()
        ) { pageIndex ->
            val media = items[pageIndex]
            var bmp by remember(media.filename, fromTrash) {
                mutableStateOf(apiClient.getCachedBitmap(media.filename, fromTrash))
            }
            var isLoading by remember(media.filename) { mutableStateOf(bmp == null && !media.isVideo) }

            LaunchedEffect(media.filename, fromTrash) {
                if (bmp == null && !media.isVideo) {
                    isLoading = true
                    bmp = apiClient.loadMediaBitmap(media.filename, fromTrash)
                    isLoading = false
                }
            }

            var zoomScale by remember(pageIndex) { mutableFloatStateOf(1f) }
            var offsetX by remember(pageIndex) { mutableFloatStateOf(0f) }
            var offsetY by remember(pageIndex) { mutableFloatStateOf(0f) }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(pageIndex) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            val newScale = (zoomScale * zoom).coerceIn(1f, 4f)
                            zoomScale = newScale
                            if (newScale > 1f) {
                                offsetX += pan.x
                                offsetY += pan.y
                            } else {
                                offsetX = 0f
                                offsetY = 0f
                            }
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                val loadedBitmap = bmp
                if (loadedBitmap != null) {
                    Image(
                        bitmap = loadedBitmap.asImageBitmap(),
                        contentDescription = media.filename,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer(
                                scaleX = zoomScale,
                                scaleY = zoomScale,
                                translationX = offsetX,
                                translationY = offsetY
                            )
                    )
                } else if (media.isVideo) {
                    val videoUrl = apiClient.getMediaUrl(media.filename, fromTrash)
                    val cookieHeader = apiClient.getCookieHeaderForCurrentServer()
                    AndroidView(
                        modifier = Modifier.fillMaxWidth().fillMaxHeight(0.8f),
                        factory = { ctx ->
                            VideoView(ctx).apply {
                                val controller = MediaController(ctx)
                                controller.setAnchorView(this)
                                setMediaController(controller)
                                setVideoURI(
                                    Uri.parse(videoUrl),
                                    if (cookieHeader.isNotBlank()) mapOf("Cookie" to cookieHeader) else emptyMap()
                                )
                                setOnPreparedListener { mp ->
                                    mp.isLooping = true
                                    start()
                                }
                            }
                        }
                    )
                } else if (isLoading) {
                    CircularProgressIndicator(color = Color.White)
                } else {
                    Text(
                        text = "Impossibile caricare l'immagine",
                        color = Color.White.copy(alpha = 0.7f),
                        textAlign = TextAlign.Center
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = CircleShape,
                color = Color.White.copy(alpha = 0.14f)
            ) {
                Text(
                    text = "${pagerState.currentPage + 1} / ${items.size}",
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }

            Surface(
                onClick = onClose,
                shape = CircleShape,
                color = Color.White.copy(alpha = 0.14f),
                modifier = Modifier.size(44.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Chiudi",
                        tint = Color.White
                    )
                }
            }
        }

        Surface(
            shape = CircleShape,
            color = Color(0xFF1C1C22).copy(alpha = 0.9f),
            tonalElevation = 8.dp,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 20.dp)
                .height(56.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 14.dp)
            ) {
                TextButton(
                    onClick = { onDownload(currentItem.filename) },
                    colors = ButtonDefaults.textButtonColors(contentColor = Color.White)
                ) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Salva", fontWeight = FontWeight.SemiBold)
                }

                if (fromTrash) {
                    TextButton(
                        onClick = { onRestore(currentItem.filename) },
                        colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFFA8C7FA))
                    ) {
                        Icon(Icons.Default.RestoreFromTrash, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Ripristina", fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    TextButton(
                        onClick = { onMoveToTrash(currentItem.filename) },
                        colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFFF2B8B5))
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Cestina", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
