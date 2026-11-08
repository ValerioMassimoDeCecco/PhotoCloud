package com.valerio.photocloud

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.WindowManager
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
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.ManageSearch
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PhotoAlbum
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
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
    YEAR("Anno"),
    ALBUM("Album")
}

enum class SortOrder(val label: String) {
    NEWEST("Più recenti"),
    OLDEST("Più vecchi"),
    NAME_ASC("Nome (A-Z)")
}

enum class ThemeMode(val label: String) {
    SYSTEM("Sistema"),
    LIGHT("Chiaro"),
    DARK("Scuro")
}

enum class AccentPreset(
    val id: String,
    val label: String,
    val primaryDark: Color,
    val primaryContainerDark: Color,
    val onPrimaryContainerDark: Color,
    val primaryLight: Color,
    val primaryContainerLight: Color,
    val onPrimaryContainerLight: Color
) {
    VIOLET(
        "violet",
        "Viola Notte",
        Color(0xFFD0BCFF),
        Color(0xFF4F378B),
        Color(0xFFEADDFF),
        Color(0xFF6750A4),
        Color(0xFFEADDFF),
        Color(0xFF21005D)
    ),
    OCEAN(
        "ocean",
        "Blu Oceano",
        Color(0xFFA8C7FA),
        Color(0xFF0842A0),
        Color(0xFFD3E3FD),
        Color(0xFF0B57D0),
        Color(0xFFD3E3FD),
        Color(0xFF041E49)
    ),
    EMERALD(
        "emerald",
        "Smeraldo",
        Color(0xFF80D9B2),
        Color(0xFF005138),
        Color(0xFF9CF6CE),
        Color(0xFF006C4C),
        Color(0xFF89F8C7),
        Color(0xFF002114)
    ),
    AMBER(
        "amber",
        "Ambra Solare",
        Color(0xFFFFB951),
        Color(0xFF633F00),
        Color(0xFFFFDDB3),
        Color(0xFF825500),
        Color(0xFFFFDDB3),
        Color(0xFF291800)
    ),
    ROSE(
        "rose",
        "Rosa Corallo",
        Color(0xFFFFB2BE),
        Color(0xFF7B293B),
        Color(0xFFFFD9DE),
        Color(0xFF9A4052),
        Color(0xFFFFD9DE),
        Color(0xFF3F0013)
    ),
    MONOCHROME(
        "mono",
        "Bianco & Nero",
        Color(0xFFE2E2E2),
        Color(0xFF353535),
        Color(0xFFF5F5F5),
        Color(0xFF1E1E1E),
        Color(0xFFE0E0E0),
        Color(0xFF111111)
    )
}

enum class VaultTab {
    GALLERY,
    FILES,
    TRASH,
    SETTINGS
}

data class CustomizationState(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val amoledBlack: Boolean = false,
    val dynamicColors: Boolean = true,
    val accentPreset: AccentPreset = AccentPreset.VIOLET,
    val monochromeAppIcon: Boolean = false,
    val gridColumns: Int = 3,
    val gridSpacingDp: Int = 3,
    val tileCornerRadiusDp: Int = 10,
    val portraitAspectRatio: Boolean = false,
    val defaultGrouping: GroupingMode = GroupingMode.MONTH,
    val sortOrder: SortOrder = SortOrder.NEWEST,
    val showVideoBadges: Boolean = true,
    val showFloatingBarLabels: Boolean = true,
    val compactFloatingBar: Boolean = false,
    val hapticsEnabled: Boolean = true,
    val confirmBeforeTrash: Boolean = false,
    val autoplayVideos: Boolean = true,
    val biometricEnabled: Boolean = true,
    val lockOnBackground: Boolean = false,
    val secureScreenFlag: Boolean = false
)

/**
 * PhotoCloud 100% Native Android Client v1.0.6
 * - Cloud File Manager for non-media files (PDF, ZIP, APK, Docs, Audio, Code, etc.)
 * - Top-Right Upload/Download Transfer Center with floating operations menu (real-time speed, size, progress)
 * - Media & File Grouping by Album (create, assign, filter, delete albums)
 * - 0ms Instant Startup (Synchronous cookie/cache hydration, zero loading circle)
 * - Drag-to-Select Multiple Media in LazyVerticalGrid
 * - Full Settings & Customization Menu + Dual App Icon Support (Color & B/W)
 */
class MainActivity : FragmentActivity() {

    private var onBackgroundLockCallback: (() -> Unit)? = null

    fun setOnBackgroundLockListener(listener: (() -> Unit)?) {
        onBackgroundLockCallback = listener
    }

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

    fun applySecureScreenFlag(enabled: Boolean) {
        try {
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        } catch (_: Exception) {
        }
    }

    fun setLauncherIconMonochrome(monochrome: Boolean) {
        try {
            val pm = packageManager
            val colorComp = ComponentName(this, "com.valerio.photocloud.LauncherColor")
            val bwComp = ComponentName(this, "com.valerio.photocloud.LauncherMonochrome")

            pm.setComponentEnabledSetting(
                colorComp,
                if (monochrome) PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                else PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            )
            pm.setComponentEnabledSetting(
                bwComp,
                if (monochrome) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
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

    override fun onStop() {
        super.onStop()
        onBackgroundLockCallback?.invoke()
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

            var custom by remember {
                mutableStateOf(
                    CustomizationState(
                        themeMode = ThemeMode.entries.find {
                            it.name == prefs.getString("theme_mode", ThemeMode.SYSTEM.name)
                        } ?: ThemeMode.SYSTEM,
                        amoledBlack = prefs.getBoolean("amoled_black", false),
                        dynamicColors = prefs.getBoolean("dynamic_colors", true),
                        accentPreset = AccentPreset.entries.find {
                            it.id == prefs.getString("accent_preset", AccentPreset.VIOLET.id)
                        } ?: AccentPreset.VIOLET,
                        monochromeAppIcon = prefs.getBoolean("monochrome_app_icon", false),
                        gridColumns = prefs.getInt("grid_columns", 3).coerceIn(2, 5),
                        gridSpacingDp = prefs.getInt("grid_spacing_dp", 3).coerceIn(1, 12),
                        tileCornerRadiusDp = prefs.getInt("tile_corner_dp", 10).coerceIn(0, 28),
                        portraitAspectRatio = prefs.getBoolean("portrait_aspect", false),
                        defaultGrouping = GroupingMode.entries.find {
                            it.name == prefs.getString("default_grouping", GroupingMode.MONTH.name)
                        } ?: GroupingMode.MONTH,
                        sortOrder = SortOrder.entries.find {
                            it.name == prefs.getString("sort_order", SortOrder.NEWEST.name)
                        } ?: SortOrder.NEWEST,
                        showVideoBadges = prefs.getBoolean("show_video_badges", true),
                        showFloatingBarLabels = prefs.getBoolean("show_floating_labels", true),
                        compactFloatingBar = prefs.getBoolean("compact_floating_bar", false),
                        hapticsEnabled = prefs.getBoolean("haptics_enabled", true),
                        confirmBeforeTrash = prefs.getBoolean("confirm_before_trash", false),
                        autoplayVideos = prefs.getBoolean("autoplay_videos", true),
                        biometricEnabled = prefs.getBoolean("biometric_enabled", true),
                        lockOnBackground = prefs.getBoolean("lock_on_background", false),
                        secureScreenFlag = prefs.getBoolean("secure_screen_flag", false)
                    )
                )
            }

            fun updateCustom(newState: CustomizationState) {
                custom = newState
                prefs.edit()
                    .putString("theme_mode", newState.themeMode.name)
                    .putBoolean("amoled_black", newState.amoledBlack)
                    .putBoolean("dynamic_colors", newState.dynamicColors)
                    .putString("accent_preset", newState.accentPreset.id)
                    .putBoolean("monochrome_app_icon", newState.monochromeAppIcon)
                    .putInt("grid_columns", newState.gridColumns)
                    .putInt("grid_spacing_dp", newState.gridSpacingDp)
                    .putInt("tile_corner_dp", newState.tileCornerRadiusDp)
                    .putBoolean("portrait_aspect", newState.portraitAspectRatio)
                    .putString("default_grouping", newState.defaultGrouping.name)
                    .putString("sort_order", newState.sortOrder.name)
                    .putBoolean("show_video_badges", newState.showVideoBadges)
                    .putBoolean("show_floating_labels", newState.showFloatingBarLabels)
                    .putBoolean("compact_floating_bar", newState.compactFloatingBar)
                    .putBoolean("haptics_enabled", newState.hapticsEnabled)
                    .putBoolean("confirm_before_trash", newState.confirmBeforeTrash)
                    .putBoolean("autoplay_videos", newState.autoplayVideos)
                    .putBoolean("biometric_enabled", newState.biometricEnabled)
                    .putBoolean("lock_on_background", newState.lockOnBackground)
                    .putBoolean("secure_screen_flag", newState.secureScreenFlag)
                    .apply()
            }

            LaunchedEffect(custom.secureScreenFlag) {
                applySecureScreenFlag(custom.secureScreenFlag)
            }

            val isDark = when (custom.themeMode) {
                ThemeMode.SYSTEM -> systemDark
                ThemeMode.DARK -> true
                ThemeMode.LIGHT -> false
            }

            val baseScheme = if (custom.dynamicColors && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (isDark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            } else {
                val preset = custom.accentPreset
                if (isDark) {
                    darkColorScheme(
                        primary = preset.primaryDark,
                        primaryContainer = preset.primaryContainerDark,
                        onPrimaryContainer = preset.onPrimaryContainerDark,
                        secondaryContainer = preset.primaryContainerDark.copy(alpha = 0.75f),
                        onSecondaryContainer = preset.onPrimaryContainerDark
                    )
                } else {
                    lightColorScheme(
                        primary = preset.primaryLight,
                        primaryContainer = preset.primaryContainerLight,
                        onPrimaryContainer = preset.onPrimaryContainerLight,
                        secondaryContainer = preset.primaryContainerLight.copy(alpha = 0.75f),
                        onSecondaryContainer = preset.onPrimaryContainerLight
                    )
                }
            }

            val finalColorScheme = if (isDark && custom.amoledBlack) {
                baseScheme.copy(
                    background = Color.Black,
                    surface = Color.Black,
                    surfaceContainerLow = Color(0xFF0B0B0E),
                    surfaceContainer = Color(0xFF121216),
                    surfaceContainerHigh = Color(0xFF1A1A20)
                )
            } else {
                baseScheme
            }

            MaterialTheme(colorScheme = finalColorScheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    PhotoCloudNativeApp(
                        activity = this@MainActivity,
                        apiClient = apiClient,
                        initialServerUrl = initialServerUrl,
                        custom = custom,
                        isDarkTheme = isDark,
                        onUpdateCustom = { updateCustom(it) },
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

/**
 * High-precision vector rendering of the user's attached PhotoCloud logo
 * (supports both Color Purple/Night and Monochrome Black & White).
 */
@Composable
fun PhotoCloudLogoBadge(
    monochrome: Boolean,
    modifier: Modifier = Modifier
) {
    Canvas(
        modifier = modifier
            .clip(RoundedCornerShape(24))
    ) {
        val w = size.width
        val h = size.height

        val bgColors = if (monochrome) {
            listOf(Color(0xFF343434), Color(0xFF1A1A1A), Color(0xFF070707))
        } else {
            listOf(Color(0xFF521563), Color(0xFF26134F), Color(0xFF090D2B))
        }
        drawRoundRect(
            brush = Brush.linearGradient(
                colors = bgColors,
                start = Offset(0f, 0f),
                end = Offset(w, h)
            ),
            cornerRadius = CornerRadius(w * 0.22f, h * 0.22f)
        )

        val strokeBack = if (monochrome) Color(0xFF828282) else Color(0xFF886EC6)
        val strokeMid = if (monochrome) Color(0xFFB5B5B5) else Color(0xFFB39CE8)
        val fillMid = if (monochrome) Color(0xFF181818) else Color(0xFF1E1143)
        val strokeFront = if (monochrome) Color(0xFFF7F7F7) else Color(0xFFF4EEFF)
        val fillFront = if (monochrome) Color(0xFF1A1A1A) else Color(0xFF211147)
        val sunColor = if (monochrome) Color(0xFFF5F5F5) else Color(0xFFFEFCD5)

        val sw = w * 0.035f

        drawRoundRect(
            color = strokeBack,
            topLeft = Offset(w * 0.23f, h * 0.38f),
            size = Size(w * 0.35f, h * 0.35f),
            cornerRadius = CornerRadius(w * 0.05f, h * 0.05f),
            style = Stroke(width = sw)
        )

        drawRoundRect(
            color = fillMid,
            topLeft = Offset(w * 0.32f, h * 0.31f),
            size = Size(w * 0.35f, h * 0.35f),
            cornerRadius = CornerRadius(w * 0.05f, h * 0.05f)
        )
        drawRoundRect(
            color = strokeMid,
            topLeft = Offset(w * 0.32f, h * 0.31f),
            size = Size(w * 0.35f, h * 0.35f),
            cornerRadius = CornerRadius(w * 0.05f, h * 0.05f),
            style = Stroke(width = sw)
        )

        val sunCenter = Offset(w * 0.685f, h * 0.285f)
        drawCircle(
            color = sunColor.copy(alpha = 0.16f),
            radius = w * 0.12f,
            center = sunCenter
        )
        drawCircle(
            color = sunColor.copy(alpha = 0.28f),
            radius = w * 0.088f,
            center = sunCenter
        )
        drawCircle(
            color = sunColor,
            radius = w * 0.06f,
            center = sunCenter
        )

        val triPath = Path().apply {
            moveTo(w * 0.41f, h * 0.25f)
            lineTo(w * 0.75f, h * 0.59f)
            lineTo(w * 0.41f, h * 0.59f)
            close()
        }
        drawPath(path = triPath, color = fillFront)
        drawPath(
            path = triPath,
            color = strokeFront,
            style = Stroke(
                width = sw * 1.08f,
                cap = StrokeCap.Round,
                join = StrokeJoin.Round
            )
        )
    }
}

@Composable
fun PhotoCloudNativeApp(
    activity: MainActivity,
    apiClient: PhotoCloudApiClient,
    initialServerUrl: String,
    custom: CustomizationState,
    isDarkTheme: Boolean,
    onUpdateCustom: (CustomizationState) -> Unit,
    onSaveServerUrl: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { context.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE) }

    var serverUrl by remember { mutableStateOf(initialServerUrl) }
    var showServerDialog by remember { mutableStateOf(false) }
    var tempServerInput by remember { mutableStateOf(serverUrl) }

    // 0ms Instant Startup Hydration: synchronously read cookie presence and cached metadata
    var isAuthenticated by remember(serverUrl) {
        mutableStateOf(apiClient.hasActiveSessionCookie())
    }
    var isBiometricLocked by remember(serverUrl) {
        mutableStateOf(
            apiClient.hasActiveSessionCookie() &&
                custom.biometricEnabled &&
                activity.canUseBiometrics()
        )
    }

    DisposableEffect(isAuthenticated, custom.lockOnBackground, custom.biometricEnabled) {
        activity.setOnBackgroundLockListener {
            if (isAuthenticated && custom.lockOnBackground && custom.biometricEnabled && activity.canUseBiometrics()) {
                isBiometricLocked = true
            }
        }
        onDispose {
            activity.setOnBackgroundLockListener(null)
        }
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
    var albumsList by remember(serverUrl) {
        mutableStateOf(apiClient.getCachedAlbums())
    }
    var infoDialogMessage by remember { mutableStateOf<String?>(null) }

    fun saveKeyForBiometrics(bytes: ByteArray) {
        savedKeyBytes = bytes
        val b64 = Base64.encodeToString(bytes, Base64.DEFAULT)
        prefs.edit().putString("saved_auth_key_b64", b64).apply()
    }

    fun refreshLocalCacheOnly() {
        galleryItems = apiClient.getCachedGalleryItems()
        trashItems = apiClient.getCachedTrashItems()
        albumsList = apiClient.getCachedAlbums()
    }

    fun refreshVaultSilently() {
        scope.launch {
            when (val syncResult = apiClient.syncGallerySession()) {
                is GallerySyncResult.Authenticated -> {
                    isAuthenticated = true
                    galleryItems = syncResult.items
                    albumsList = apiClient.getCachedAlbums()
                    trashItems = apiClient.fetchTrashItems()
                }
                is GallerySyncResult.Unauthenticated -> {
                    apiClient.clearCookies()
                    isAuthenticated = false
                    isBiometricLocked = false
                    galleryItems = emptyList()
                    trashItems = emptyList()
                    albumsList = emptyList()
                }
                is GallerySyncResult.NetworkError -> {
                    // Keep showing cached items without interrupting the user
                }
            }
        }
    }

    LaunchedEffect(isAuthenticated, isBiometricLocked) {
        if (isAuthenticated && isBiometricLocked) {
            activity.showBiometricPrompt(
                onSuccess = { isBiometricLocked = false },
                onError = { msg -> Toast.makeText(context, msg, Toast.LENGTH_SHORT).show() }
            )
        }
    }

    LaunchedEffect(serverUrl) {
        if (apiClient.hasActiveSessionCookie()) {
            refreshVaultSilently()
        }
    }

    if (isAuthenticated && isBiometricLocked) {
        NativeBiometricLockScreen(
            monochromeIcon = custom.monochromeAppIcon,
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
            monochromeIcon = custom.monochromeAppIcon,
            savedKeyBytes = savedKeyBytes,
            onSaveKeyForBiometrics = { saveKeyForBiometrics(it) },
            onOpenServerConfig = {
                tempServerInput = serverUrl
                showServerDialog = true
            },
            onLoginSuccess = {
                isAuthenticated = true
                isBiometricLocked = false
                refreshLocalCacheOnly()
                refreshVaultSilently()
            },
            onShowInfo = { msg ->
                infoDialogMessage = msg
            }
        )
    } else {
        NativeVaultScreen(
            activity = activity,
            apiClient = apiClient,
            serverUrl = serverUrl,
            galleryItems = galleryItems,
            trashItems = trashItems,
            albumsList = albumsList,
            custom = custom,
            isDarkTheme = isDarkTheme,
            onUpdateCustom = onUpdateCustom,
            onLockNow = {
                if (activity.canUseBiometrics()) {
                    isBiometricLocked = true
                } else {
                    Toast.makeText(context, "Biometria non configurata sul dispositivo", Toast.LENGTH_SHORT).show()
                }
            },
            onRefresh = { refreshVaultSilently() },
            onLocalAlbumsChanged = { refreshLocalCacheOnly() },
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
                    albumsList = emptyList()
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
    monochromeIcon: Boolean,
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
                PhotoCloudLogoBadge(
                    monochrome = monochromeIcon,
                    modifier = Modifier.size(84.dp)
                )

                Spacer(Modifier.height(20.dp))

                Text(
                    text = "Archivio Protetto",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Autenticati con impronta o volto per sbloccare foto e file cloud",
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
    monochromeIcon: Boolean,
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
                    PhotoCloudLogoBadge(
                        monochrome = monochromeIcon,
                        modifier = Modifier.size(72.dp)
                    )
                    Spacer(Modifier.height(14.dp))
                    Text(
                        text = "PhotoCloud",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "Galleria & Cloud File Manager crittografato",
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

private fun findMediaFilenameAtOffset(gridState: LazyGridState, offset: Offset): String? {
    val hitItem = gridState.layoutInfo.visibleItemsInfo.firstOrNull { info ->
        val keyStr = info.key as? String ?: return@firstOrNull false
        if (!keyStr.startsWith("media_")) return@firstOrNull false
        val left = info.offset.x.toFloat()
        val top = info.offset.y.toFloat()
        val right = left + info.size.width
        val bottom = top + info.size.height
        offset.x in left..right && offset.y in top..bottom
    }
    val keyStr = hitItem?.key as? String ?: return null
    return keyStr.removePrefix("media_")
}

@Composable
fun NativeVaultScreen(
    activity: MainActivity,
    apiClient: PhotoCloudApiClient,
    serverUrl: String,
    galleryItems: List<MediaItemModel>,
    trashItems: List<MediaItemModel>,
    albumsList: List<String>,
    custom: CustomizationState,
    isDarkTheme: Boolean,
    onUpdateCustom: (CustomizationState) -> Unit,
    onLockNow: () -> Unit,
    onRefresh: () -> Unit,
    onLocalAlbumsChanged: () -> Unit,
    onOpenServerConfig: () -> Unit,
    onLogout: () -> Unit,
    onShowInfo: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current

    var currentTab by remember { mutableStateOf(VaultTab.GALLERY) }
    var groupingMode by remember(custom.defaultGrouping) { mutableStateOf(custom.defaultGrouping) }
    var showGroupingMenu by remember { mutableStateOf(false) }

    var selectedAlbumFilter by remember { mutableStateOf<String?>(null) }
    var showAlbumDialog by remember { mutableStateOf(false) }

    var selectedFilenames by remember { mutableStateOf<Set<String>>(emptySet()) }
    var lightboxInitialIndex by remember { mutableStateOf<Int?>(null) }
    var pendingTrashConfirmFilenames by remember { mutableStateOf<List<String>?>(null) }

    // Top-Right Transfer Operations State (Uploads & Downloads with live speed & size)
    var transferOperations by remember { mutableStateOf<List<TransferOperation>>(emptyList()) }
    var showTransferPopup by remember { mutableStateOf(false) }

    fun upsertTransferOperation(op: TransferOperation) {
        val current = transferOperations.toMutableList()
        val idx = current.indexOfFirst { it.id == op.id }
        if (idx >= 0) {
            current[idx] = op
        } else {
            current.add(0, op)
        }
        transferOperations = current.take(25)
    }

    val activeRunningOps = remember(transferOperations) {
        transferOperations.filter { it.status == TransferStatus.RUNNING }
    }
    val totalLiveSpeed = remember(activeRunningOps) {
        activeRunningOps.sumOf { it.speedBytesPerSec }
    }
    val overallProgressFraction = remember(activeRunningOps) {
        val totalB = activeRunningOps.sumOf { it.totalBytes }
        val doneB = activeRunningOps.sumOf { it.transferredBytes }
        if (totalB > 0L) (doneB.toFloat() / totalB.toFloat()).coerceIn(0f, 1f) else 0f
    }

    var isScanningDuplicates by remember { mutableStateOf(false) }
    var duplicateGroups by remember { mutableStateOf<List<List<String>>?>(null) }

    val mediaOnlyItems = remember(galleryItems) {
        galleryItems.filter { it.isMedia }
    }
    val nonMediaCloudFiles = remember(galleryItems) {
        galleryItems.filter { !it.isMedia }
    }

    val allAlbumNames = remember(albumsList, galleryItems) {
        val fromItems = galleryItems.mapNotNull { it.album.takeIf { a -> a.isNotBlank() } }
        (albumsList + fromItems).distinct().sorted()
    }

    val rawItemsForCurrentTab = when (currentTab) {
        VaultTab.GALLERY -> {
            if (selectedAlbumFilter != null) {
                mediaOnlyItems.filter { it.album == selectedAlbumFilter }
            } else {
                mediaOnlyItems
            }
        }
        VaultTab.FILES -> nonMediaCloudFiles
        VaultTab.TRASH -> trashItems
        VaultTab.SETTINGS -> emptyList()
    }

    val activeItems = remember(rawItemsForCurrentTab, custom.sortOrder) {
        when (custom.sortOrder) {
            SortOrder.NEWEST -> rawItemsForCurrentTab.sortedByDescending { it.timestamp }
            SortOrder.OLDEST -> rawItemsForCurrentTab.sortedBy { it.timestamp }
            SortOrder.NAME_ASC -> rawItemsForCurrentTab.sortedBy { it.filename.lowercase() }
        }
    }
    val isFromTrash = currentTab == VaultTab.TRASH

    val uploadLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents()
    ) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            showTransferPopup = true
            val targetAlb = selectedAlbumFilter ?: ""
            scope.launch {
                val (ok, msg) = apiClient.uploadMediaUris(
                    uris = uris,
                    targetAlbum = targetAlb,
                    onTransferUpdate = { op -> upsertTransferOperation(op) }
                )
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
        } else if (groupingMode == GroupingMode.ALBUM) {
            val byAlbum = activeItems.groupBy { item ->
                item.album.ifBlank { "Senza Album" }
            }
            byAlbum.entries
                .sortedWith(compareBy<Map.Entry<String, List<MediaItemModel>>> { it.key == "Senza Album" }.thenBy { it.key.lowercase() })
                .map { "📁 ${it.key} (${it.value.size})" to it.value }
        } else {
            val fmt = when (groupingMode) {
                GroupingMode.DAY -> SimpleDateFormat("dd MMMM yyyy", Locale.ITALIAN)
                GroupingMode.MONTH -> SimpleDateFormat("MMMM yyyy", Locale.ITALIAN)
                GroupingMode.YEAR -> SimpleDateFormat("yyyy", Locale.ITALIAN)
                else -> SimpleDateFormat("MMMM yyyy", Locale.ITALIAN)
            }
            activeItems.groupBy { item ->
                val label = fmt.format(Date((item.timestamp * 1000).toLong()))
                label.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ITALIAN) else it.toString() }
            }.toList()
        }
    }

    BackHandler(
        enabled = showTransferPopup || lightboxInitialIndex != null || selectedFilenames.isNotEmpty() || currentTab != VaultTab.GALLERY
    ) {
        when {
            showTransferPopup -> showTransferPopup = false
            lightboxInitialIndex != null -> lightboxInitialIndex = null
            selectedFilenames.isNotEmpty() -> selectedFilenames = emptySet()
            currentTab != VaultTab.GALLERY -> currentTab = VaultTab.GALLERY
        }
    }

    val gridState = rememberLazyGridState()

    var dragStartIndex by remember { mutableStateOf<Int?>(null) }
    var dragLastIndex by remember { mutableStateOf<Int?>(null) }
    var dragAddingSelection by remember { mutableStateOf(true) }
    var selectionSnapshotBeforeDrag by remember { mutableStateOf<Set<String>>(emptySet()) }

    fun triggerHaptic(longPress: Boolean = false) {
        if (custom.hapticsEnabled) {
            haptic.performHapticFeedback(
                if (longPress) HapticFeedbackType.LongPress else HapticFeedbackType.TextHandleMove
            )
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Minimalist Material You Top Header with Top-Right Transfer Center Button
            Surface(
                color = MaterialTheme.colorScheme.background.copy(alpha = 0.94f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .statusBarsPadding()
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        PhotoCloudLogoBadge(
                            monochrome = custom.monochromeAppIcon,
                            modifier = Modifier.size(36.dp)
                        )
                        Column {
                            Text(
                                text = when {
                                    selectedFilenames.isNotEmpty() -> "${selectedFilenames.size} selezionati"
                                    currentTab == VaultTab.GALLERY -> "Galleria"
                                    currentTab == VaultTab.FILES -> "File Manager Cloud"
                                    currentTab == VaultTab.TRASH -> "Cestino"
                                    currentTab == VaultTab.SETTINGS -> "Impostazioni"
                                    else -> "PhotoCloud"
                                },
                                style = MaterialTheme.typography.titleLarge.copy(
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = (-0.5).sp
                                ),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onBackground
                            )
                            Text(
                                text = when (currentTab) {
                                    VaultTab.GALLERY -> "${mediaOnlyItems.size} foto/video • ${allAlbumNames.size} album"
                                    VaultTab.FILES -> "${nonMediaCloudFiles.size} file cloud (${PhotoCloudApiClient.formatBytesHuman(nonMediaCloudFiles.sumOf { it.size })})"
                                    VaultTab.TRASH -> "${trashItems.size} elementi nel cestino"
                                    VaultTab.SETTINGS -> "Personalizzazione & Opzioni Generali"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        if (currentTab == VaultTab.GALLERY) {
                            Box {
                                Surface(
                                    onClick = { showGroupingMenu = true },
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh
                                ) {
                                    Text(
                                        text = groupingMode.label,
                                        style = MaterialTheme.typography.labelMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp)
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
                                onClick = { showAlbumDialog = true },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.CreateNewFolder,
                                    contentDescription = "Gestisci Album",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }

                        if ((currentTab == VaultTab.GALLERY || currentTab == VaultTab.FILES) && activeItems.isNotEmpty()) {
                            IconButton(
                                onClick = {
                                    triggerHaptic()
                                    selectedFilenames = if (selectedFilenames.size == activeItems.size) {
                                        emptySet()
                                    } else {
                                        activeItems.map { it.filename }.toSet()
                                    }
                                },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.DoneAll,
                                    contentDescription = "Seleziona tutto",
                                    tint = if (selectedFilenames.isNotEmpty()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(20.dp)
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
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(17.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Svuota", style = MaterialTheme.typography.labelMedium)
                            }
                        }

                        // TOP-RIGHT UPLOAD/DOWNLOAD TRANSFER CENTER BUTTON
                        Surface(
                            onClick = {
                                triggerHaptic()
                                showTransferPopup = !showTransferPopup
                            },
                            shape = CircleShape,
                            color = if (activeRunningOps.isNotEmpty() || showTransferPopup) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerHigh
                            },
                            modifier = Modifier.height(38.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.padding(horizontal = 10.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center, modifier = Modifier.size(24.dp)) {
                                    if (activeRunningOps.isNotEmpty()) {
                                        CircularProgressIndicator(
                                            progress = { overallProgressFraction.coerceIn(0.08f, 1f) },
                                            modifier = Modifier.size(24.dp),
                                            strokeWidth = 2.5.dp,
                                            color = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                    Icon(
                                        imageVector = when {
                                            activeRunningOps.any { it.isUpload } -> Icons.Default.CloudUpload
                                            activeRunningOps.isNotEmpty() -> Icons.Default.CloudDownload
                                            else -> Icons.Default.SwapVert
                                        },
                                        contentDescription = "Centro Trasferimenti",
                                        tint = if (activeRunningOps.isNotEmpty() || showTransferPopup) {
                                            MaterialTheme.colorScheme.onPrimaryContainer
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                        modifier = Modifier.size(16.dp)
                                    )
                                }

                                if (activeRunningOps.isNotEmpty()) {
                                    Text(
                                        text = PhotoCloudApiClient.formatSpeedHuman(totalLiveSpeed),
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer
                                    )
                                } else if (transferOperations.isNotEmpty()) {
                                    Text(
                                        text = "${transferOperations.size}",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Album Quick Filter Chips bar when in Gallery and albums exist or GroupingMode.ALBUM is active
            if (currentTab == VaultTab.GALLERY && (allAlbumNames.isNotEmpty() || groupingMode == GroupingMode.ALBUM)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    FilterChip(
                        selected = selectedAlbumFilter == null,
                        onClick = { selectedAlbumFilter = null },
                        label = { Text("Tutti (${mediaOnlyItems.size})") }
                    )
                    allAlbumNames.forEach { albName ->
                        val count = mediaOnlyItems.count { it.album == albName }
                        FilterChip(
                            selected = selectedAlbumFilter == albName,
                            onClick = {
                                selectedAlbumFilter = if (selectedAlbumFilter == albName) null else albName
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.PhotoAlbum,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                            },
                            label = { Text("$albName ($count)") }
                        )
                    }
                    AssistChip(
                        onClick = { showAlbumDialog = true },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Add,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                        },
                        label = { Text("Nuovo Album") }
                    )
                }
            }

            if (isScanningDuplicates) {
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
                            text = "Scansione duplicati in corso...",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }
            }

            when (currentTab) {
                VaultTab.SETTINGS -> {
                    NativeSettingsScreen(
                        activity = activity,
                        apiClient = apiClient,
                        serverUrl = serverUrl,
                        galleryCount = mediaOnlyItems.size,
                        cloudFilesCount = nonMediaCloudFiles.size,
                        trashCount = trashItems.size,
                        custom = custom,
                        onUpdateCustom = onUpdateCustom,
                        onOpenServerConfig = onOpenServerConfig,
                        onScanDuplicates = {
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
                        onLockNow = onLockNow,
                        onLogout = onLogout,
                        onShowInfo = onShowInfo
                    )
                }

                VaultTab.FILES -> {
                    NativeCloudFileManagerScreen(
                        files = activeItems,
                        selectedFilenames = selectedFilenames,
                        albumsList = allAlbumNames,
                        onToggleSelect = { fn ->
                            triggerHaptic()
                            selectedFilenames = if (selectedFilenames.contains(fn)) {
                                selectedFilenames - fn
                            } else {
                                selectedFilenames + fn
                            }
                        },
                        onDownloadFile = { item ->
                            showTransferPopup = true
                            scope.launch {
                                val (_, msg) = apiClient.saveSingleMediaToDownloads(
                                    filename = item.filename,
                                    fromTrash = false,
                                    onTransferUpdate = { op -> upsertTransferOperation(op) }
                                )
                                onShowInfo(msg)
                            }
                        },
                        onUploadFilesClick = {
                            uploadLauncher.launch("*/*")
                        },
                        onOpenAlbumManager = {
                            showAlbumDialog = true
                        }
                    )
                }

                else -> {
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
                                    text = if (currentTab == VaultTab.GALLERY) "Nessuna foto o video qui" else "Il cestino è vuoto",
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
                        // 120Hz Photo Grid with Drag-to-Select Multi-Selection
                        LazyVerticalGrid(
                            state = gridState,
                            columns = GridCells.Fixed(custom.gridColumns.coerceIn(2, 5)),
                            contentPadding = PaddingValues(
                                start = 6.dp,
                                end = 6.dp,
                                top = 6.dp,
                                bottom = 140.dp
                            ),
                            horizontalArrangement = Arrangement.spacedBy(custom.gridSpacingDp.dp),
                            verticalArrangement = Arrangement.spacedBy(custom.gridSpacingDp.dp),
                            modifier = Modifier
                                .fillMaxSize()
                                .pointerInput(activeItems, currentTab) {
                                    if (currentTab != VaultTab.GALLERY) return@pointerInput
                                    detectDragGesturesAfterLongPress(
                                        onDragStart = { startOffset ->
                                            val hitFn = findMediaFilenameAtOffset(gridState, startOffset)
                                            val idx = activeItems.indexOfFirst { it.filename == hitFn }
                                            if (idx >= 0 && hitFn != null) {
                                                triggerHaptic(longPress = true)
                                                dragStartIndex = idx
                                                dragLastIndex = idx
                                                selectionSnapshotBeforeDrag = selectedFilenames
                                                val shouldSelect = !selectedFilenames.contains(hitFn)
                                                dragAddingSelection = shouldSelect
                                                selectedFilenames = if (shouldSelect) {
                                                    selectedFilenames + hitFn
                                                } else {
                                                    selectedFilenames - hitFn
                                                }
                                            } else {
                                                dragStartIndex = null
                                                dragLastIndex = null
                                            }
                                        },
                                        onDrag = { change, _ ->
                                            val startIdx = dragStartIndex ?: return@detectDragGesturesAfterLongPress
                                            change.consume()

                                            val viewportH = gridState.layoutInfo.viewportSize.height.toFloat()
                                            val y = change.position.y
                                            if (y < 140f) {
                                                scope.launch { gridState.scrollBy(-28f) }
                                            } else if (y > viewportH - 220f) {
                                                scope.launch { gridState.scrollBy(28f) }
                                            }

                                            val hitFn = findMediaFilenameAtOffset(gridState, change.position)
                                            val currentIdx = activeItems.indexOfFirst { it.filename == hitFn }
                                            if (currentIdx >= 0 && currentIdx != dragLastIndex) {
                                                dragLastIndex = currentIdx
                                                triggerHaptic(longPress = false)
                                                val rangeStart = minOf(startIdx, currentIdx)
                                                val rangeEnd = maxOf(startIdx, currentIdx)
                                                val rangeFilenames = activeItems
                                                    .subList(rangeStart, rangeEnd + 1)
                                                    .map { it.filename }
                                                    .toSet()

                                                selectedFilenames = if (dragAddingSelection) {
                                                    selectionSnapshotBeforeDrag + rangeFilenames
                                                } else {
                                                    selectionSnapshotBeforeDrag - rangeFilenames
                                                }
                                            }
                                        },
                                        onDragEnd = {
                                            dragStartIndex = null
                                            dragLastIndex = null
                                        },
                                        onDragCancel = {
                                            dragStartIndex = null
                                            dragLastIndex = null
                                        }
                                    )
                                }
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
                                    key = { "media_${it.filename}" }
                                ) { mediaItem ->
                                    val isSelected = selectedFilenames.contains(mediaItem.filename)
                                    MediaGridTile(
                                        apiClient = apiClient,
                                        item = mediaItem,
                                        fromTrash = isFromTrash,
                                        isSelected = isSelected,
                                        inSelectionMode = selectedFilenames.isNotEmpty(),
                                        cornerRadiusDp = custom.tileCornerRadiusDp,
                                        aspectRatio = if (custom.portraitAspectRatio) 0.8f else 1f,
                                        showVideoBadge = custom.showVideoBadges,
                                        onClick = {
                                            if (selectedFilenames.isNotEmpty() && currentTab == VaultTab.GALLERY) {
                                                triggerHaptic()
                                                selectedFilenames = if (isSelected) {
                                                    selectedFilenames - mediaItem.filename
                                                } else {
                                                    selectedFilenames + mediaItem.filename
                                                }
                                            } else if (mediaItem.isMedia) {
                                                val globalIndex = activeItems.indexOfFirst { it.filename == mediaItem.filename }
                                                if (globalIndex >= 0) {
                                                    lightboxInitialIndex = globalIndex
                                                }
                                            } else {
                                                showTransferPopup = true
                                                scope.launch {
                                                    val (_, msg) = apiClient.saveSingleMediaToDownloads(
                                                        filename = mediaItem.filename,
                                                        fromTrash = isFromTrash,
                                                        onTransferUpdate = { op -> upsertTransferOperation(op) }
                                                    )
                                                    onShowInfo(msg)
                                                }
                                            }
                                        },
                                        onLongClick = {
                                            if (currentTab == VaultTab.GALLERY) {
                                                triggerHaptic(longPress = true)
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
            }
        }

        // =========================================================================
        // === FLOATING TRANSFER OPERATIONS MENU (Top-Right Dropdown)
        // =========================================================================
        AnimatedVisibility(
            visible = showTransferPopup,
            enter = fadeIn() + slideInVertically { -it / 3 },
            exit = fadeOut() + slideOutVertically { -it / 3 },
            modifier = Modifier
                .align(Alignment.TopEnd)
                .statusBarsPadding()
                .padding(top = 62.dp, end = 12.dp, start = 12.dp)
        ) {
            TransferOperationsFloatingCard(
                operations = transferOperations,
                totalLiveSpeed = totalLiveSpeed,
                onClearFinished = {
                    transferOperations = transferOperations.filter { it.status == TransferStatus.RUNNING }
                },
                onClose = { showTransferPopup = false }
            )
        }

        // =========================================================================
        // === MATERIAL YOU BOTTOM FLOATING BAR (Anchored at Alignment.BottomCenter)
        // =========================================================================
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 10.dp, vertical = 14.dp)
        ) {
            AnimatedVisibility(
                visible = selectedFilenames.isNotEmpty() && (currentTab == VaultTab.GALLERY || currentTab == VaultTab.FILES),
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
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    ) {
                        FilledTonalButton(
                            onClick = { showAlbumDialog = true },
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Default.PhotoAlbum, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Album")
                        }

                        FilledTonalButton(
                            onClick = {
                                val toDownload = selectedFilenames.toList()
                                showTransferPopup = true
                                scope.launch {
                                    if (toDownload.size == 1) {
                                        val (_, msg) = apiClient.saveSingleMediaToDownloads(
                                            filename = toDownload.first(),
                                            fromTrash = false,
                                            onTransferUpdate = { op -> upsertTransferOperation(op) }
                                        )
                                        onShowInfo(msg)
                                    } else {
                                        val (_, msg) = apiClient.downloadZipToDevice(
                                            filenames = toDownload,
                                            onTransferUpdate = { op -> upsertTransferOperation(op) }
                                        )
                                        onShowInfo(msg)
                                    }
                                    selectedFilenames = emptySet()
                                }
                            },
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("Scarica (${selectedFilenames.size})")
                        }

                        Button(
                            onClick = {
                                val toTrash = selectedFilenames.toList()
                                if (custom.confirmBeforeTrash) {
                                    pendingTrashConfirmFilenames = toTrash
                                } else {
                                    scope.launch {
                                        if (apiClient.moveBatchToTrash(toTrash)) {
                                            onShowInfo("${toTrash.size} elementi spostati nel cestino")
                                            selectedFilenames = emptySet()
                                            onRefresh()
                                        }
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.errorContainer,
                                contentColor = MaterialTheme.colorScheme.onErrorContainer
                            ),
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Cestina")
                        }

                        IconButton(
                            onClick = { selectedFilenames = emptySet() },
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Deseleziona")
                        }
                    }
                }
            }

            val barHeight = if (custom.compactFloatingBar) 54.dp else 64.dp
            val pillHeight = if (custom.compactFloatingBar) 40.dp else 46.dp

            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.96f),
                tonalElevation = 6.dp,
                shadowElevation = 16.dp,
                modifier = Modifier
                    .height(barHeight)
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f),
                        shape = CircleShape
                    )
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(horizontal = 8.dp)
                ) {
                    // Tab 1: Foto (Gallery)
                    Surface(
                        onClick = {
                            triggerHaptic()
                            currentTab = VaultTab.GALLERY
                            selectedFilenames = emptySet()
                        },
                        shape = CircleShape,
                        color = if (currentTab == VaultTab.GALLERY) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                        modifier = Modifier.height(pillHeight)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 12.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.PhotoLibrary,
                                contentDescription = "Foto",
                                tint = if (currentTab == VaultTab.GALLERY) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                            if (currentTab == VaultTab.GALLERY && custom.showFloatingBarLabels) {
                                Spacer(Modifier.width(5.dp))
                                Text(
                                    text = "Foto",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            }
                        }
                    }

                    // Tab 2: File Manager Cloud (Non-media files)
                    Surface(
                        onClick = {
                            triggerHaptic()
                            currentTab = VaultTab.FILES
                            selectedFilenames = emptySet()
                        },
                        shape = CircleShape,
                        color = if (currentTab == VaultTab.FILES) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                        modifier = Modifier.height(pillHeight)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 12.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Folder,
                                contentDescription = "File Cloud",
                                tint = if (currentTab == VaultTab.FILES) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                            if (currentTab == VaultTab.FILES && custom.showFloatingBarLabels) {
                                Spacer(Modifier.width(5.dp))
                                Text(
                                    text = "File",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            }
                        }
                    }

                    // Primary Pill: + Carica (Media or any Cloud File)
                    Surface(
                        onClick = {
                            triggerHaptic()
                            uploadLauncher.launch("*/*")
                        },
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.height(pillHeight)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 14.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Add,
                                contentDescription = "Carica",
                                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                modifier = Modifier.size(21.dp)
                            )
                            if (custom.showFloatingBarLabels) {
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    text = "Carica",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            }
                        }
                    }

                    // Tab 3: Cestino (Trash)
                    Surface(
                        onClick = {
                            triggerHaptic()
                            currentTab = VaultTab.TRASH
                            selectedFilenames = emptySet()
                        },
                        shape = CircleShape,
                        color = if (currentTab == VaultTab.TRASH) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                        modifier = Modifier.height(pillHeight)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 11.dp)
                        ) {
                            Icon(
                                imageVector = if (currentTab == VaultTab.TRASH) Icons.Default.Delete else Icons.Default.DeleteOutline,
                                contentDescription = "Cestino",
                                tint = if (currentTab == VaultTab.TRASH) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                            if (currentTab == VaultTab.TRASH && custom.showFloatingBarLabels) {
                                Spacer(Modifier.width(5.dp))
                                Text(
                                    text = "Cestino",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            }
                        }
                    }

                    // Tab 4: Impostazioni (Settings & Customization)
                    Surface(
                        onClick = {
                            triggerHaptic()
                            currentTab = VaultTab.SETTINGS
                            selectedFilenames = emptySet()
                        },
                        shape = CircleShape,
                        color = if (currentTab == VaultTab.SETTINGS) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                        modifier = Modifier.height(pillHeight)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 11.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Settings,
                                contentDescription = "Impostazioni",
                                tint = if (currentTab == VaultTab.SETTINGS) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                            if (currentTab == VaultTab.SETTINGS && custom.showFloatingBarLabels) {
                                Spacer(Modifier.width(5.dp))
                                Text(
                                    text = "Opzioni",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            }
                        }
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
                autoplayVideos = custom.autoplayVideos,
                onClose = { lightboxInitialIndex = null },
                onMoveToTrash = { filename ->
                    if (custom.confirmBeforeTrash) {
                        pendingTrashConfirmFilenames = listOf(filename)
                    } else {
                        scope.launch {
                            if (apiClient.moveToTrash(filename)) {
                                onShowInfo("Spostato nel cestino")
                                lightboxInitialIndex = null
                                onRefresh()
                            }
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
                    showTransferPopup = true
                    scope.launch {
                        val (_, msg) = apiClient.saveSingleMediaToDownloads(
                            filename = filename,
                            fromTrash = isFromTrash,
                            onTransferUpdate = { op -> upsertTransferOperation(op) }
                        )
                        onShowInfo(msg)
                    }
                }
            )
        }

        if (showAlbumDialog) {
            AlbumManagerDialog(
                albums = allAlbumNames,
                selectedCount = selectedFilenames.size,
                onDismiss = { showAlbumDialog = false },
                onCreateAlbum = { newName ->
                    scope.launch {
                        if (apiClient.createAlbum(newName)) {
                            if (selectedFilenames.isNotEmpty()) {
                                apiClient.assignFilesToAlbum(selectedFilenames.toList(), newName)
                                onShowInfo("Album \"$newName\" creato con ${selectedFilenames.size} file")
                                selectedFilenames = emptySet()
                            } else {
                                onShowInfo("Album \"$newName\" creato")
                            }
                            onLocalAlbumsChanged()
                            onRefresh()
                        }
                    }
                },
                onAssignToAlbum = { albumName ->
                    val targets = selectedFilenames.toList()
                    if (targets.isEmpty()) {
                        selectedAlbumFilter = albumName.ifBlank { null }
                        groupingMode = GroupingMode.ALBUM
                        showAlbumDialog = false
                    } else {
                        scope.launch {
                            apiClient.assignFilesToAlbum(targets, albumName)
                            onLocalAlbumsChanged()
                            selectedFilenames = emptySet()
                            showAlbumDialog = false
                            onShowInfo(
                                if (albumName.isBlank()) "Rimossi dall'album"
                                else "Spostati nell'album \"$albumName\""
                            )
                            onRefresh()
                        }
                    }
                },
                onDeleteAlbum = { albumName ->
                    scope.launch {
                        apiClient.deleteAlbum(albumName)
                        if (selectedAlbumFilter == albumName) selectedAlbumFilter = null
                        onLocalAlbumsChanged()
                        onShowInfo("Album \"$albumName\" eliminato")
                        onRefresh()
                    }
                }
            )
        }

        val toConfirmTrash = pendingTrashConfirmFilenames
        if (toConfirmTrash != null) {
            AlertDialog(
                onDismissRequest = { pendingTrashConfirmFilenames = null },
                shape = RoundedCornerShape(28.dp),
                title = { Text("Sposta nel Cestino") },
                text = {
                    Text("Vuoi spostare ${toConfirmTrash.size} elementi nel cestino?")
                },
                confirmButton = {
                    Button(
                        onClick = {
                            val list = toConfirmTrash
                            pendingTrashConfirmFilenames = null
                            scope.launch {
                                val ok = if (list.size == 1) {
                                    apiClient.moveToTrash(list.first())
                                } else {
                                    apiClient.moveBatchToTrash(list)
                                }
                                if (ok) {
                                    onShowInfo("${list.size} elementi spostati nel cestino")
                                    selectedFilenames = emptySet()
                                    lightboxInitialIndex = null
                                    onRefresh()
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                            contentColor = MaterialTheme.colorScheme.onErrorContainer
                        )
                    ) {
                        Text("Sposta nel Cestino")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingTrashConfirmFilenames = null }) {
                        Text("Annulla")
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

/**
 * Floating Transfer Operations Menu anchored in the top-right, displaying all active & recent
 * uploads/downloads with real-time speed (KB/s, MB/s), transferred/total size, and progress bars.
 */
@Composable
fun TransferOperationsFloatingCard(
    operations: List<TransferOperation>,
    totalLiveSpeed: Long,
    onClearFinished: () -> Unit,
    onClose: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 10.dp,
        shadowElevation = 20.dp,
        modifier = Modifier
            .widthIn(max = 390.dp)
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
                shape = RoundedCornerShape(26.dp)
            )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.SwapVert,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                    Column {
                        Text(
                            text = "Operazioni di Trasferimento",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = if (totalLiveSpeed > 0L) {
                                "Velocità attuale: ${PhotoCloudApiClient.formatSpeedHuman(totalLiveSpeed)}"
                            } else {
                                "${operations.size} operazioni registrate"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (totalLiveSpeed > 0L) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (operations.any { it.status != TransferStatus.RUNNING }) {
                        TextButton(
                            onClick = onClearFinished,
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text("Pulisci", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    IconButton(
                        onClick = onClose,
                        modifier = Modifier.size(30.dp)
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "Chiudi", modifier = Modifier.size(18.dp))
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            if (operations.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 22.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.CloudDone,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                            modifier = Modifier.size(34.dp)
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = "Nessun caricamento o scaricamento in corso",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.heightIn(max = 320.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(operations, key = { it.id }) { op ->
                        Surface(
                            shape = RoundedCornerShape(18.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerLow,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Icon(
                                            imageVector = when (op.status) {
                                                TransferStatus.COMPLETED -> Icons.Default.CheckCircle
                                                TransferStatus.ERROR -> Icons.Default.ErrorOutline
                                                TransferStatus.RUNNING -> if (op.isUpload) Icons.Default.CloudUpload else Icons.Default.CloudDownload
                                            },
                                            contentDescription = null,
                                            tint = when (op.status) {
                                                TransferStatus.COMPLETED -> MaterialTheme.colorScheme.primary
                                                TransferStatus.ERROR -> MaterialTheme.colorScheme.error
                                                TransferStatus.RUNNING -> MaterialTheme.colorScheme.tertiary
                                            },
                                            modifier = Modifier.size(18.dp)
                                        )
                                        Text(
                                            text = op.title,
                                            style = MaterialTheme.typography.bodySmall,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }

                                    Spacer(Modifier.width(8.dp))

                                    Surface(
                                        shape = CircleShape,
                                        color = MaterialTheme.colorScheme.secondaryContainer
                                    ) {
                                        Text(
                                            text = if (op.status == TransferStatus.RUNNING && op.speedBytesPerSec > 0L) {
                                                PhotoCloudApiClient.formatSpeedHuman(op.speedBytesPerSec)
                                            } else {
                                                "${op.percentInt}%"
                                            },
                                            style = MaterialTheme.typography.labelSmall,
                                            fontWeight = FontWeight.Bold,
                                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                        )
                                    }
                                }

                                Spacer(Modifier.height(6.dp))

                                LinearProgressIndicator(
                                    progress = { op.progressFraction },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(6.dp)
                                        .clip(CircleShape),
                                    color = if (op.status == TransferStatus.ERROR) {
                                        MaterialTheme.colorScheme.error
                                    } else {
                                        MaterialTheme.colorScheme.primary
                                    }
                                )

                                Spacer(Modifier.height(6.dp))

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = op.detail.ifBlank {
                                            if (op.isUpload) "Upload cloud" else "Download locale"
                                        },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    val sizeLabel = if (op.totalBytes > 0L) {
                                        "${PhotoCloudApiClient.formatBytesHuman(op.transferredBytes)} / ${PhotoCloudApiClient.formatBytesHuman(op.totalBytes)}"
                                    } else {
                                        PhotoCloudApiClient.formatBytesHuman(op.transferredBytes)
                                    }
                                    Text(
                                        text = sizeLabel,
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Cloud File Manager View for non-media files (PDF, ZIP, APK, Docs, Audio, Code, etc.)
 * grouped by Category or Album.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NativeCloudFileManagerScreen(
    files: List<MediaItemModel>,
    selectedFilenames: Set<String>,
    albumsList: List<String>,
    onToggleSelect: (String) -> Unit,
    onDownloadFile: (MediaItemModel) -> Unit,
    onUploadFilesClick: () -> Unit,
    onOpenAlbumManager: () -> Unit
) {
    var selectedCategory by remember { mutableStateOf("all") }
    var searchQuery by remember { mutableStateOf("") }

    val categories = listOf(
        "all" to "Tutti (${files.size})",
        "document" to "Documenti & PDF",
        "archive" to "Archivi & APK",
        "audio" to "Audio & Musica",
        "code" to "Codice & Dati",
        "other" to "Altri File"
    )

    val filteredFiles = remember(files, selectedCategory, searchQuery) {
        files.filter { item ->
            val matchCat = selectedCategory == "all" || item.category == selectedCategory
            val matchQuery = searchQuery.isBlank() ||
                item.filename.contains(searchQuery.trim(), ignoreCase = true) ||
                item.album.contains(searchQuery.trim(), ignoreCase = true)
            matchCat && matchQuery
        }
    }

    val groupedByCat = remember(filteredFiles) {
        val labelMap = mapOf(
            "document" to "📄 Documenti & PDF",
            "archive" to "📦 Archivi, ZIP & APK",
            "audio" to "🎵 Audio & Musica",
            "code" to "💻 Codice & Configurazione",
            "other" to "📁 Altri File Cloud"
        )
        filteredFiles.groupBy { labelMap[it.category] ?: "📁 Altri File Cloud" }.toList()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Search & Quick Upload Row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = { Text("Cerca file cloud (PDF, ZIP, APK...)") },
                singleLine = true,
                shape = CircleShape,
                modifier = Modifier.weight(1f)
            )
            FilledTonalIconButton(onClick = onOpenAlbumManager) {
                Icon(Icons.Default.PhotoAlbum, contentDescription = "Album")
            }
        }

        // Category Filter Chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 14.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            categories.forEach { (catId, catLabel) ->
                FilterChip(
                    selected = selectedCategory == catId,
                    onClick = { selectedCategory = catId },
                    label = { Text(catLabel) }
                )
            }
        }

        if (filteredFiles.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = 110.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(24.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Folder,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.65f),
                        modifier = Modifier.size(56.dp)
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = "Nessun file non-media nel File Manager Cloud",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "Puoi caricare PDF, ZIP, APK, documenti Office, brani audio e qualsiasi altro file nel tuo spazio cifrato.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(18.dp))
                    Button(
                        onClick = onUploadFilesClick,
                        shape = CircleShape
                    ) {
                        Icon(Icons.Default.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Carica File Cloud")
                    }
                }
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 14.dp,
                    end = 14.dp,
                    top = 6.dp,
                    bottom = 150.dp
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                groupedByCat.forEach { (groupTitle, groupItems) ->
                    item(key = "cat_header_$groupTitle") {
                        Text(
                            text = "$groupTitle (${groupItems.size})",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(top = 10.dp, bottom = 4.dp, start = 4.dp)
                        )
                    }

                    items(groupItems, key = { "file_${it.filename}" }) { fileItem ->
                        val isSelected = selectedFilenames.contains(fileItem.filename)
                        val dateStr = remember(fileItem.timestamp) {
                            SimpleDateFormat("dd MMM yyyy • HH:mm", Locale.ITALIAN)
                                .format(Date((fileItem.timestamp * 1000).toLong()))
                        }

                        Surface(
                            shape = RoundedCornerShape(20.dp),
                            color = if (isSelected) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerLow
                            },
                            tonalElevation = 2.dp,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(20.dp))
                                .combinedClickable(
                                    onClick = {
                                        if (selectedFilenames.isNotEmpty()) {
                                            onToggleSelect(fileItem.filename)
                                        } else {
                                            onDownloadFile(fileItem)
                                        }
                                    },
                                    onLongClick = {
                                        onToggleSelect(fileItem.filename)
                                    }
                                )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Surface(
                                        shape = RoundedCornerShape(14.dp),
                                        color = MaterialTheme.colorScheme.secondaryContainer,
                                        modifier = Modifier.size(48.dp)
                                    ) {
                                        Column(
                                            modifier = Modifier.fillMaxSize(),
                                            horizontalAlignment = Alignment.CenterHorizontally,
                                            verticalArrangement = Arrangement.Center
                                        ) {
                                            Icon(
                                                imageVector = when (fileItem.category) {
                                                    "document" -> Icons.Default.Description
                                                    "archive" -> Icons.Default.FolderZip
                                                    "audio" -> Icons.Default.AudioFile
                                                    "code" -> Icons.Default.Code
                                                    else -> Icons.AutoMirrored.Filled.InsertDriveFile
                                                },
                                                contentDescription = null,
                                                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                                                modifier = Modifier.size(20.dp)
                                            )
                                            Text(
                                                text = fileItem.extensionBadge,
                                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                                                fontWeight = FontWeight.ExtraBold,
                                                color = MaterialTheme.colorScheme.onSecondaryContainer
                                            )
                                        }
                                    }

                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = fileItem.filename,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Spacer(Modifier.height(2.dp))
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            val sizeText = if (fileItem.size > 0L) {
                                                PhotoCloudApiClient.formatBytesHuman(fileItem.size)
                                            } else {
                                                "File Cloud"
                                            }
                                            Text(
                                                text = "$sizeText • $dateStr",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                        if (fileItem.album.isNotBlank()) {
                                            Spacer(Modifier.height(4.dp))
                                            Surface(
                                                shape = CircleShape,
                                                color = MaterialTheme.colorScheme.tertiaryContainer
                                            ) {
                                                Text(
                                                    text = "📁 ${fileItem.album}",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                                )
                                            }
                                        }
                                    }
                                }

                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconButton(onClick = { onDownloadFile(fileItem) }) {
                                        Icon(
                                            imageVector = Icons.Default.Download,
                                            contentDescription = "Scarica file",
                                            tint = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                    Checkbox(
                                        checked = isSelected,
                                        onCheckedChange = { onToggleSelect(fileItem.filename) }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AlbumManagerDialog(
    albums: List<String>,
    selectedCount: Int,
    onDismiss: () -> Unit,
    onCreateAlbum: (String) -> Unit,
    onAssignToAlbum: (String) -> Unit,
    onDeleteAlbum: (String) -> Unit
) {
    var newAlbumName by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(28.dp),
        title = {
            Text(
                text = if (selectedCount > 0) "Assegna $selectedCount elementi a un Album" else "Gestione Album",
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = newAlbumName,
                        onValueChange = { newAlbumName = it },
                        label = { Text("Nuovo album (es. Vacanze)") },
                        singleLine = true,
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.weight(1f)
                    )
                    Button(
                        onClick = {
                            val clean = newAlbumName.trim()
                            if (clean.isNotBlank()) {
                                onCreateAlbum(clean)
                                newAlbumName = ""
                            }
                        },
                        shape = CircleShape
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null)
                    }
                }

                if (selectedCount > 0) {
                    OutlinedButton(
                        onClick = { onAssignToAlbum("") },
                        shape = CircleShape,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Rimuovi dall'album corrente")
                    }
                }

                if (albums.isEmpty()) {
                    Text(
                        text = "Nessun album creato. Scrivi un nome qui sopra e premi + per creare il tuo primo album.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Text(
                        text = if (selectedCount > 0) "Tocca un album per spostare i file selezionati:" else "I tuoi Album:",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Column(
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier
                            .heightIn(max = 240.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                        albums.forEach { albumName ->
                            Surface(
                                onClick = { onAssignToAlbum(albumName) },
                                shape = RoundedCornerShape(16.dp),
                                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 14.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.PhotoAlbum,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary
                                        )
                                        Text(
                                            text = albumName,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                    IconButton(
                                        onClick = { onDeleteAlbum(albumName) },
                                        modifier = Modifier.size(32.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.DeleteOutline,
                                            contentDescription = "Elimina album",
                                            tint = MaterialTheme.colorScheme.error,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Chiudi")
            }
        }
    )
}

@Composable
fun NativeSettingsScreen(
    activity: MainActivity,
    apiClient: PhotoCloudApiClient,
    serverUrl: String,
    galleryCount: Int,
    cloudFilesCount: Int,
    trashCount: Int,
    custom: CustomizationState,
    onUpdateCustom: (CustomizationState) -> Unit,
    onOpenServerConfig: () -> Unit,
    onScanDuplicates: () -> Unit,
    onLockNow: () -> Unit,
    onLogout: () -> Unit,
    onShowInfo: (String) -> Unit
) {
    var cacheStats by remember { mutableStateOf(apiClient.getDiskCacheStats()) }
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = 16.dp)
            .padding(top = 6.dp, bottom = 140.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 1. APP ICON SWITCHER (COLOR vs BLACK & WHITE)
        SettingsSectionCard(
            title = "Icona App & Identità",
            icon = Icons.Default.Palette
        ) {
            Text(
                text = "Scegli lo stile dell'icona PhotoCloud nel launcher Android e nell'app:",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(14.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Surface(
                    onClick = {
                        onUpdateCustom(custom.copy(monochromeAppIcon = false))
                        activity.setLauncherIconMonochrome(false)
                        onShowInfo("Icona app impostata: Colorata (Viola Notte)")
                    },
                    shape = RoundedCornerShape(22.dp),
                    color = if (!custom.monochromeAppIcon) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier
                        .weight(1f)
                        .border(
                            width = if (!custom.monochromeAppIcon) 2.dp else 0.dp,
                            color = if (!custom.monochromeAppIcon) MaterialTheme.colorScheme.primary else Color.Transparent,
                            shape = RoundedCornerShape(22.dp)
                        )
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(vertical = 18.dp, horizontal = 12.dp)
                    ) {
                        PhotoCloudLogoBadge(
                            monochrome = false,
                            modifier = Modifier.size(64.dp)
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = "Colorata",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Viola Notte",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Surface(
                    onClick = {
                        onUpdateCustom(custom.copy(monochromeAppIcon = true))
                        activity.setLauncherIconMonochrome(true)
                        onShowInfo("Icona app impostata: Bianco & Nero")
                    },
                    shape = RoundedCornerShape(22.dp),
                    color = if (custom.monochromeAppIcon) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier
                        .weight(1f)
                        .border(
                            width = if (custom.monochromeAppIcon) 2.dp else 0.dp,
                            color = if (custom.monochromeAppIcon) MaterialTheme.colorScheme.primary else Color.Transparent,
                            shape = RoundedCornerShape(22.dp)
                        )
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(vertical = 18.dp, horizontal = 12.dp)
                    ) {
                        PhotoCloudLogoBadge(
                            monochrome = true,
                            modifier = Modifier.size(64.dp)
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = "Bianco & Nero",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Monocromatica",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        // 2. TEMA, COLORI & DISPLAY 120HZ
        SettingsSectionCard(
            title = "Tema, Colori & Schermo",
            icon = Icons.Default.DarkMode
        ) {
            Text(
                text = "Modalità Tema",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ThemeMode.entries.forEach { mode ->
                    FilterChip(
                        selected = custom.themeMode == mode,
                        onClick = { onUpdateCustom(custom.copy(themeMode = mode)) },
                        label = { Text(mode.label) },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            SettingsSwitchRow(
                title = "Nero Puro AMOLED (True Black)",
                subtitle = "Sfondo #000000 assoluto in modalità scura per schermi OLED",
                checked = custom.amoledBlack,
                onCheckedChange = { onUpdateCustom(custom.copy(amoledBlack = it)) }
            )

            SettingsSwitchRow(
                title = "Colori Dinamici Material You",
                subtitle = "Usa la palette estratta dallo sfondo di Android 12+",
                checked = custom.dynamicColors,
                onCheckedChange = { onUpdateCustom(custom.copy(dynamicColors = it)) }
            )

            if (!custom.dynamicColors || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Palette Colore Accento",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    AccentPreset.entries.forEach { preset ->
                        val isSelected = custom.accentPreset == preset
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(preset.primaryDark)
                                .border(
                                    width = if (isSelected) 3.dp else 1.dp,
                                    color = if (isSelected) MaterialTheme.colorScheme.onSurface else Color.Transparent,
                                    shape = CircleShape
                                )
                                .clickable {
                                    onUpdateCustom(custom.copy(accentPreset = preset, dynamicColors = false))
                                }
                        ) {
                            if (isSelected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = preset.label,
                                    tint = Color.Black,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    }
                }
            }
        }

        // 3. PERSONALIZZAZIONE GRIGLIA & LAYOUT
        SettingsSectionCard(
            title = "Layout Griglia & Miniature",
            icon = Icons.Default.GridView
        ) {
            Text(
                text = "Colonne della Griglia: ${custom.gridColumns}",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(2, 3, 4, 5).forEach { cols ->
                    FilterChip(
                        selected = custom.gridColumns == cols,
                        onClick = { onUpdateCustom(custom.copy(gridColumns = cols)) },
                        label = { Text("$cols col") },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = "Spaziatura Miniature (${custom.gridSpacingDp} dp)",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Slider(
                value = custom.gridSpacingDp.toFloat(),
                onValueChange = { onUpdateCustom(custom.copy(gridSpacingDp = it.toInt())) },
                valueRange = 1f..10f,
                steps = 8
            )

            Text(
                text = "Arrotondamento Angoli Foto (${custom.tileCornerRadiusDp} dp)",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Slider(
                value = custom.tileCornerRadiusDp.toFloat(),
                onValueChange = { onUpdateCustom(custom.copy(tileCornerRadiusDp = it.toInt())) },
                valueRange = 0f..24f,
                steps = 11
            )

            SettingsSwitchRow(
                title = "Miniature Verticali (Ritratto 4:5)",
                subtitle = "Mostra le foto in formato 4:5 anziché quadrato 1:1",
                checked = custom.portraitAspectRatio,
                onCheckedChange = { onUpdateCustom(custom.copy(portraitAspectRatio = it)) }
            )

            SettingsSwitchRow(
                title = "Mostra Icona Video sulle Miniature",
                subtitle = "Evidenzia i video MP4/MOV nella griglia",
                checked = custom.showVideoBadges,
                onCheckedChange = { onUpdateCustom(custom.copy(showVideoBadges = it)) }
            )

            Spacer(Modifier.height(8.dp))
            Text(
                text = "Raggruppamento Predefinito all'Avvio",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                GroupingMode.entries.forEach { mode ->
                    FilterChip(
                        selected = custom.defaultGrouping == mode,
                        onClick = { onUpdateCustom(custom.copy(defaultGrouping = mode)) },
                        label = { Text(mode.label, maxLines = 1) }
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Text(
                text = "Ordinamento Elementi",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                SortOrder.entries.forEach { order ->
                    FilterChip(
                        selected = custom.sortOrder == order,
                        onClick = { onUpdateCustom(custom.copy(sortOrder = order)) },
                        label = { Text(order.label, maxLines = 1) },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        // 4. FLOATING BAR & INTERAZIONE
        SettingsSectionCard(
            title = "Floating Bar & Comportamento",
            icon = Icons.Default.Tune
        ) {
            SettingsSwitchRow(
                title = "Etichette Testo nella Floating Bar",
                subtitle = "Mostra i nomi delle sezioni accanto alle icone in basso",
                checked = custom.showFloatingBarLabels,
                onCheckedChange = { onUpdateCustom(custom.copy(showFloatingBarLabels = it)) }
            )

            SettingsSwitchRow(
                title = "Floating Bar Compatta",
                subtitle = "Riduce l'altezza della barra fluttuante inferiore",
                checked = custom.compactFloatingBar,
                onCheckedChange = { onUpdateCustom(custom.copy(compactFloatingBar = it)) }
            )

            SettingsSwitchRow(
                title = "Feedback Aptico (Vibrazione 120Hz)",
                subtitle = "Vibrazione leggera durante il trascinamento di selezione multipla",
                checked = custom.hapticsEnabled,
                onCheckedChange = { onUpdateCustom(custom.copy(hapticsEnabled = it)) }
            )

            SettingsSwitchRow(
                title = "Chiedi Conferma prima di Cestinare",
                subtitle = "Mostra un avviso prima di spostare foto o file nel cestino",
                checked = custom.confirmBeforeTrash,
                onCheckedChange = { onUpdateCustom(custom.copy(confirmBeforeTrash = it)) }
            )

            SettingsSwitchRow(
                title = "Autoplay Video nella Lightbox",
                subtitle = "Riproduce automaticamente i video quando vengono aperti",
                checked = custom.autoplayVideos,
                onCheckedChange = { onUpdateCustom(custom.copy(autoplayVideos = it)) }
            )
        }

        // 5. SICUREZZA & PRIVACY
        SettingsSectionCard(
            title = "Sicurezza & Biometria",
            icon = Icons.Default.Security
        ) {
            SettingsSwitchRow(
                title = "Sblocco Biometrico all'Avvio",
                subtitle = "Richiede impronta digitale o volto per aprire la cassaforte",
                checked = custom.biometricEnabled,
                onCheckedChange = { onUpdateCustom(custom.copy(biometricEnabled = it)) }
            )

            SettingsSwitchRow(
                title = "Blocca Automaticamente in Background",
                subtitle = "Richiede nuovamente l'impronta quando esci dall'app",
                checked = custom.lockOnBackground,
                onCheckedChange = { onUpdateCustom(custom.copy(lockOnBackground = it)) }
            )

            SettingsSwitchRow(
                title = "Schermo Sicuro (Anti-Screenshot)",
                subtitle = "Blocca gli screenshot e oscura l'anteprima nelle app recenti",
                checked = custom.secureScreenFlag,
                onCheckedChange = { onUpdateCustom(custom.copy(secureScreenFlag = it)) }
            )

            Spacer(Modifier.height(10.dp))
            FilledTonalButton(
                onClick = onLockNow,
                shape = CircleShape,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Blocca Cassaforte Ora", fontWeight = FontWeight.SemiBold)
            }
        }

        // 6. GENERALI, SERVER & GESTIONE CACHE
        SettingsSectionCard(
            title = "Generali, Server & Cache",
            icon = Icons.Default.Dns
        ) {
            val cacheMb = String.format(Locale.ITALIAN, "%.2f MB", cacheStats.second / (1024.0 * 1024.0))
            Text(
                text = "Server attivo: $serverUrl",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "Foto/Video: $galleryCount • File Cloud: $cloudFilesCount • Cestino: $trashCount • Cache: $cacheMb",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(14.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilledTonalButton(
                    onClick = onOpenServerConfig,
                    shape = CircleShape,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Dns, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Cambia Server")
                }

                FilledTonalButton(
                    onClick = onScanDuplicates,
                    shape = CircleShape,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.ManageSearch, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Trova Duplicati")
                }
            }

            Spacer(Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = {
                        apiClient.clearMediaCache()
                        cacheStats = apiClient.getDiskCacheStats()
                        onShowInfo("Cache miniature svuotata")
                    },
                    shape = CircleShape,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.CleaningServices, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Svuota Cache")
                }

                OutlinedButton(
                    onClick = {
                        onUpdateCustom(CustomizationState())
                        activity.setLauncherIconMonochrome(false)
                        onShowInfo("Impostazioni predefinite ripristinate")
                    },
                    shape = CircleShape,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Reset Opzioni")
                }
            }

            Spacer(Modifier.height(12.dp))

            Button(
                onClick = onLogout,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer
                ),
                shape = CircleShape,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Disconnetti Sessione (Logout)", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
fun SettingsSectionCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        tonalElevation = 2.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(22.dp)
                )
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(Modifier.height(14.dp))
            content()
        }
    }
}

@Composable
fun SettingsSwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable { onCheckedChange(!checked) }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange
        )
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
    cornerRadiusDp: Int,
    aspectRatio: Float,
    showVideoBadge: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onRestore: (() -> Unit)? = null,
    onDeletePermanent: (() -> Unit)? = null
) {
    var bitmap by remember(item.filename, fromTrash) {
        mutableStateOf(
            if (item.isMedia) apiClient.getCachedBitmap(item.filename, fromTrash) else null
        )
    }
    var loadFailed by remember(item.filename) { mutableStateOf(false) }

    LaunchedEffect(item.filename, fromTrash) {
        if (item.isMedia && bitmap == null && !item.isVideo) {
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

    val shape = RoundedCornerShape(if (isSelected) (cornerRadiusDp + 8).dp else cornerRadiusDp.dp)

    Box(
        modifier = Modifier
            .aspectRatio(aspectRatio)
            .clip(shape)
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
                .clip(shape)
        ) {
            val currentBmp = bitmap
            if (currentBmp != null) {
                Image(
                    bitmap = currentBmp.asImageBitmap(),
                    contentDescription = item.filename,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else if (!item.isMedia) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                        .padding(8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.InsertDriveFile,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(28.dp)
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = item.extensionBadge,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = item.filename,
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else if (item.isVideo) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                    contentAlignment = Alignment.Center
                ) {
                    if (showVideoBadge) {
                        Icon(
                            imageVector = Icons.Default.PlayCircleFilled,
                            contentDescription = "Video",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(40.dp)
                        )
                    }
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

        if (item.album.isNotBlank() && onRestore == null) {
            Surface(
                shape = CircleShape,
                color = Color.Black.copy(alpha = 0.58f),
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp)
            ) {
                Text(
                    text = item.album,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                )
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
    autoplayVideos: Boolean,
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
                                    if (autoplayVideos) {
                                        start()
                                    }
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
