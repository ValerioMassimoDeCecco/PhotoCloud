package com.valerio.photocloud

import android.Manifest
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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
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
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhotoAlbum
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
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
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.work.WorkInfo
import androidx.work.WorkManager
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.media.MediaPlayer
import android.os.ParcelFileDescriptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.hypot

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
    val designThemeMode: DesignThemeMode = DesignThemeMode.ORIGINAL,
    val liquidGlassConfig: LiquidGlassConfig = LiquidGlassConfig(),
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
 * PhotoCloud 100% Native Android Client v1.1.5
 * - Drag-to-Select Multiple Media in LazyVerticalGrid & SelectionActionsPanel
 * - Lightbox Gesture Navigation with HorizontalPager, Swipe-to-Dismiss, Double-Tap Zoom & Coherent Slide Transitions
 * - Cloud File Manager for non-media files (PDF, ZIP, APK, Docs, Audio, Code, etc.)
 * - Top-Right Upload/Download Transfer Center with floating operations menu (real-time speed, size, progress)
 * - Media & File Grouping by Album (create, assign, filter, delete albums)
 * - 0ms Instant Startup (Synchronous cookie/cache hydration, zero loading circle)
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
                        designThemeMode = LiquidGlassConfigStore.loadDesignTheme(prefs),
                        liquidGlassConfig = LiquidGlassConfigStore.loadConfig(prefs),
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
                LiquidGlassConfigStore.saveDesignTheme(prefs, newState.designThemeMode)
                LiquidGlassConfigStore.saveConfig(prefs, newState.liquidGlassConfig)
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

            val isLiquidGlass = custom.designThemeMode == DesignThemeMode.LIQUID_GLASS
            val lgCfg = custom.liquidGlassConfig

            val baseScheme = if (isLiquidGlass) {
                if (isDark || lgCfg.useCustomColors) {
                    darkColorScheme(
                        primary = lgCfg.primaryColor,
                        secondary = lgCfg.secondaryColor,
                        tertiary = lgCfg.accentColor,
                        primaryContainer = lgCfg.primaryColor.copy(alpha = 0.28f),
                        onPrimaryContainer = lgCfg.textColor,
                        secondaryContainer = lgCfg.secondaryColor.copy(alpha = 0.32f),
                        onSecondaryContainer = lgCfg.textColor,
                        background = lgCfg.surfaceToneColor,
                        surface = lgCfg.surfaceToneColor,
                        onBackground = lgCfg.textColor,
                        onSurface = lgCfg.textColor
                    )
                } else {
                    lightColorScheme(
                        primary = lgCfg.primaryColor,
                        secondary = lgCfg.secondaryColor,
                        tertiary = lgCfg.accentColor,
                        primaryContainer = lgCfg.primaryColor.copy(alpha = 0.24f),
                        onPrimaryContainer = Color(0xFF071324),
                        secondaryContainer = lgCfg.secondaryColor.copy(alpha = 0.26f),
                        onSecondaryContainer = Color(0xFF071324)
                    )
                }
            } else if (custom.dynamicColors && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
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

            val finalColorScheme = if (!isLiquidGlass && isDark && custom.amoledBlack) {
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

            CompositionLocalProvider(
                LocalLiquidGlassActive provides isLiquidGlass,
                LocalLiquidGlassConfig provides lgCfg
            ) {
                MaterialTheme(colorScheme = finalColorScheme) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background
                    ) {
                        Box(modifier = Modifier.fillMaxSize()) {
                            if (isLiquidGlass) {
                                LiquidGlassBackdropCanvas(
                                    config = lgCfg,
                                    isDarkTheme = isDark
                                )
                            }
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

    val appUpdateState by AppAutoUpdater.state.collectAsState()

    LaunchedEffect(serverUrl) {
        if (apiClient.hasActiveSessionCookie()) {
            refreshVaultSilently()
        }
        AppAutoUpdater.checkForUpdatesOnLaunch(context, serverUrl)
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

    if (appUpdateState.showModal && appUpdateState.manifest != null) {
        AppUpdateModal(
            updateState = appUpdateState,
            onCancel = { AppAutoUpdater.cancelUpdateDownload() },
            onRetry = { AppAutoUpdater.retryDownload(context) },
            onInstall = { AppAutoUpdater.promptInstallApk(context) },
            onDismiss = { AppAutoUpdater.dismissModal() }
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

private fun extractVisibleGridCells(
    gridState: LazyGridState,
    filenameToIndex: Map<String, Int>,
    startPaddingPx: Float
): List<GridCellBounds> {
    val layoutInfo = gridState.layoutInfo
    val topPaddingOffset = layoutInfo.beforeContentPadding.toFloat()
    val result = ArrayList<GridCellBounds>(layoutInfo.visibleItemsInfo.size)
    for (info in layoutInfo.visibleItemsInfo) {
        val keyStr = info.key as? String ?: continue
        if (!keyStr.startsWith("media_")) continue
        val fn = keyStr.removePrefix("media_")
        val idx = filenameToIndex[fn] ?: continue
        val left = info.offset.x.toFloat() + startPaddingPx
        val top = info.offset.y.toFloat() + topPaddingOffset
        val right = left + info.size.width.toFloat()
        val bottom = top + info.size.height.toFloat()
        result.add(
            GridCellBounds(
                filename = fn,
                index = idx,
                left = left,
                top = top,
                right = right,
                bottom = bottom
            )
        )
    }
    return result
}

private fun findMediaFilenameAtOffset(gridState: LazyGridState, offset: Offset): String? {
    val visibleMediaItems = gridState.layoutInfo.visibleItemsInfo.filter { info ->
        val keyStr = info.key as? String ?: return@filter false
        keyStr.startsWith("media_")
    }
    if (visibleMediaItems.isEmpty()) return null
    val topPaddingOffset = gridState.layoutInfo.beforeContentPadding.toFloat()
    val cells = visibleMediaItems.mapIndexed { idx, info ->
        val left = info.offset.x.toFloat()
        val top = info.offset.y.toFloat() + topPaddingOffset
        GridCellBounds(
            filename = (info.key as String).removePrefix("media_"),
            index = idx,
            left = left,
            top = top,
            right = left + info.size.width.toFloat(),
            bottom = top + info.size.height.toFloat()
        )
    }
    return GalleryDragSelectionController.findCellAtPoint(
        cells = cells,
        x = offset.x,
        y = offset.y,
        snapToNearest = true,
        touchMarginPx = 18f
    )?.filename
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
    val isLgActive = LocalLiquidGlassActive.current
    val lgCfg = LocalLiquidGlassConfig.current

    var currentTab by remember { mutableStateOf(VaultTab.GALLERY) }
    var groupingMode by remember(custom.defaultGrouping) { mutableStateOf(custom.defaultGrouping) }
    var showGroupingMenu by remember { mutableStateOf(false) }

    var selectedAlbumFilter by remember { mutableStateOf<String?>(null) }
    var selectedAiCategoryFilter by remember { mutableStateOf<String?>(null) }
    var showAlbumDialog by remember { mutableStateOf(false) }

    var selectedFilenames by remember { mutableStateOf<Set<String>>(emptySet()) }
    var lightboxInitialIndex by remember { mutableStateOf<Int?>(null) }
    var editingPhotoFilename by remember { mutableStateOf<String?>(null) }
    var viewingDocumentItem by remember { mutableStateOf<MediaItemModel?>(null) }
    var externalFallbackItem by remember { mutableStateOf<MediaItemModel?>(null) }
    var pendingTrashConfirmFilenames by remember { mutableStateOf<List<String>?>(null) }

    // On-Device AI Categorization (Room reactive Flows + WorkManager active batch state)
    val appCtx = LocalContext.current.applicationContext
    val photoAiDb = remember(appCtx) { PhotoAiDatabase.getInstance(appCtx) }
    val photoAiDao = remember(photoAiDb) { photoAiDb.photoAiDao() }
    val aiAnalyzedEntities by photoAiDao.observeAllAnalyzed().collectAsState(initial = emptyList())
    val aiWorkInfos by remember(appCtx) {
        WorkManager.getInstance(appCtx).getWorkInfosForUniqueWorkFlow(PhotoAiIndexingWorker.UNIQUE_WORK_NAME)
    }.collectAsState(initial = emptyList())

    val activeAiWorkInfo = remember(aiWorkInfos) {
        aiWorkInfos.firstOrNull { it.state == WorkInfo.State.RUNNING }
    }
    val workerAnalyzed = activeAiWorkInfo?.progress?.getInt(PhotoAiIndexingWorker.KEY_ANALYZED, -1) ?: -1
    val workerTotal = activeAiWorkInfo?.progress?.getInt(PhotoAiIndexingWorker.KEY_TOTAL, -1) ?: -1

    // Show strictly the count of the current upload/indexing batch (never the cumulative DB total)
    val effectiveAiTotal = if (workerTotal > 0) workerTotal else 0
    val effectiveAiAnalyzed = if (workerAnalyzed >= 0 && workerTotal > 0) {
        workerAnalyzed.coerceIn(0, workerTotal)
    } else {
        0
    }
    val isAiIndexingRunning = activeAiWorkInfo?.state == WorkInfo.State.RUNNING &&
        effectiveAiTotal > 0 &&
        effectiveAiAnalyzed < effectiveAiTotal

    val aiCategoriesByFilename = remember(aiAnalyzedEntities) {
        val map = HashMap<String, List<String>>()
        for (entity in aiAnalyzedEntities) {
            val cats = entity.parsedCategoriesList()
            if (cats.isNotEmpty()) {
                if (entity.filename.isNotBlank()) {
                    map[entity.filename] = cats
                }
                val fromCloudKey = entity.uriString.removePrefix("cloud://")
                if (fromCloudKey.isNotBlank()) {
                    map[fromCloudKey] = cats
                }
            }
        }
        map
    }

    val aiModelState by AiModelDownloadManager.state.collectAsState()

    val galleryCloudPhotoKey = remember(galleryItems) {
        galleryItems.asSequence()
            .filter { it.isMedia && !it.isVideo }
            .map { it.filename }
            .sorted()
            .joinToString("|")
    }

    LaunchedEffect(Unit) {
        AiModelDownloadManager.refreshState(appCtx)
    }

    LaunchedEffect(galleryCloudPhotoKey, aiModelState.status) {
        if (aiModelState.status == AiModelStatus.INSTALLED) {
            PhotoAiIndexingWorker.enqueueIndexing(appCtx, forceReindex = false)
        }
    }

    // Top-Right Discreet Transfer Operations State (Uploads & Downloads with live speed & size)
    var transferOperations by remember { mutableStateOf<List<TransferOperation>>(emptyList()) }
    var showTransferPopup by remember { mutableStateOf(false) }
    var hadRunningTransfers by remember { mutableStateOf(false) }

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

    // Auto-close the transfer details screen when all active transfers complete
    LaunchedEffect(activeRunningOps.size) {
        if (activeRunningOps.isNotEmpty()) {
            hadRunningTransfers = true
        } else if (hadRunningTransfers) {
            delay(600)
            if (transferOperations.none { it.status == TransferStatus.RUNNING }) {
                showTransferPopup = false
                hadRunningTransfers = false
            }
        }
    }

    var isScanningDuplicates by remember { mutableStateOf(false) }
    var duplicateGroups by remember { mutableStateOf<List<List<String>>?>(null) }

    // Optimistic 0ms removal sets so trashing, restoring, or deleting items updates the UI instantaneously
    var optimisticRemovedGallery by remember(galleryItems) { mutableStateOf<Set<String>>(emptySet()) }
    var optimisticRemovedTrash by remember(trashItems) { mutableStateOf<Set<String>>(emptySet()) }

    val visibleGalleryItems = remember(galleryItems, optimisticRemovedGallery) {
        if (optimisticRemovedGallery.isEmpty()) galleryItems
        else galleryItems.filterNot { optimisticRemovedGallery.contains(it.filename) }
    }
    val visibleTrashItems = remember(trashItems, optimisticRemovedTrash) {
        if (optimisticRemovedTrash.isEmpty()) trashItems
        else trashItems.filterNot { optimisticRemovedTrash.contains(it.filename) }
    }

    val mediaOnlyItems = remember(visibleGalleryItems) {
        visibleGalleryItems.filter { it.isMedia }
    }
    val nonMediaCloudFiles = remember(visibleGalleryItems) {
        visibleGalleryItems.filter { !it.isMedia }
    }

    // Compute AI category chips strictly from active PhotoCloud gallery photos
    val aiCategoryChips = remember(mediaOnlyItems, aiCategoriesByFilename) {
        val counts = LinkedHashMap<String, Int>()
        for (item in mediaOnlyItems) {
            if (item.isVideo) continue
            val cats = aiCategoriesByFilename[item.filename].orEmpty()
            for (cat in cats) {
                counts[cat] = (counts[cat] ?: 0) + 1
            }
        }
        counts.entries
            .map { AiCategoryChipModel(category = it.key, count = it.value) }
            .sortedWith(compareByDescending<AiCategoryChipModel> { it.count }.thenBy { it.category })
    }

    val allAlbumNames = remember(albumsList, visibleGalleryItems) {
        val fromItems = visibleGalleryItems.mapNotNull { it.album.takeIf { a -> a.isNotBlank() } }
        (albumsList + fromItems).distinct().sorted()
    }

    val filteredGalleryMedia = remember(mediaOnlyItems, selectedAlbumFilter, selectedAiCategoryFilter, aiCategoriesByFilename) {
        var result = if (selectedAlbumFilter != null) {
            mediaOnlyItems.filter { it.album == selectedAlbumFilter }
        } else {
            mediaOnlyItems
        }
        val activeAiCat = selectedAiCategoryFilter
        if (activeAiCat != null) {
            result = result.filter { item ->
                val itemCats = aiCategoriesByFilename[item.filename].orEmpty()
                itemCats.any { it.equals(activeAiCat, ignoreCase = true) }
            }
        }
        result
    }

    val gallerySortedItems = remember(filteredGalleryMedia, custom.sortOrder) {
        when (custom.sortOrder) {
            SortOrder.NEWEST -> filteredGalleryMedia.sortedByDescending { it.timestamp }
            SortOrder.OLDEST -> filteredGalleryMedia.sortedBy { it.timestamp }
            SortOrder.NAME_ASC -> filteredGalleryMedia.sortedBy { it.filename.lowercase() }
        }
    }

    val filesSortedItems = remember(nonMediaCloudFiles, custom.sortOrder) {
        when (custom.sortOrder) {
            SortOrder.NEWEST -> nonMediaCloudFiles.sortedByDescending { it.timestamp }
            SortOrder.OLDEST -> nonMediaCloudFiles.sortedBy { it.timestamp }
            SortOrder.NAME_ASC -> nonMediaCloudFiles.sortedBy { it.filename.lowercase() }
        }
    }

    val trashSortedItems = remember(visibleTrashItems, custom.sortOrder) {
        when (custom.sortOrder) {
            SortOrder.NEWEST -> visibleTrashItems.sortedByDescending { it.timestamp }
            SortOrder.OLDEST -> visibleTrashItems.sortedBy { it.timestamp }
            SortOrder.NAME_ASC -> visibleTrashItems.sortedBy { it.filename.lowercase() }
        }
    }

    val activeItems = when (currentTab) {
        VaultTab.GALLERY -> gallerySortedItems
        VaultTab.FILES -> filesSortedItems
        VaultTab.TRASH -> trashSortedItems
        VaultTab.SETTINGS -> emptyList()
    }
    val isFromTrash = currentTab == VaultTab.TRASH
    val localContext = LocalContext.current

    fun openCloudItemWithExternalChooser(item: MediaItemModel) {
        scope.launch {
            val spec = PhotoCloudApiClient.resolveViewerSpec(item.filename)
            val cachedFile = apiClient.downloadFileToCache(
                filename = item.filename,
                fromTrash = isFromTrash,
                onTransferUpdate = { op -> upsertTransferOperation(op) }
            )
            if (cachedFile == null) {
                onShowInfo("Impossibile recuperare il file dal server")
                return@launch
            }
            val launched = PhotoCloudApiClient.openFileWithExternalAppChooser(
                context = localContext,
                file = cachedFile,
                filename = item.filename,
                mimeType = spec.mimeType
            )
            if (!launched) {
                externalFallbackItem = item
            }
        }
    }

    fun handleOpenCloudItem(item: MediaItemModel) {
        val spec = PhotoCloudApiClient.resolveViewerSpec(item.filename)
        if (item.isMedia || spec.viewerType == "image" || spec.viewerType == "video") {
            val globalIndex = activeItems.indexOfFirst { it.filename == item.filename }
            if (globalIndex >= 0) {
                lightboxInitialIndex = globalIndex
                return
            }
        }
        if (spec.canOpenInApp) {
            viewingDocumentItem = item
        } else {
            openCloudItemWithExternalChooser(item)
        }
    }

    val uploadLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents()
    ) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            // Do NOT auto-open showTransferPopup; discreet icon appears automatically
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

    // Pre-computed independently of currentTab so returning to Gallery requires 0ms CPU work
    val galleryGroupedSections = remember(gallerySortedItems, groupingMode) {
        if (groupingMode == GroupingMode.NONE) {
            listOf("" to gallerySortedItems)
        } else if (groupingMode == GroupingMode.ALBUM) {
            val byAlbum = gallerySortedItems.groupBy { item ->
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
            gallerySortedItems.groupBy { item ->
                val label = fmt.format(Date((item.timestamp * 1000).toLong()))
                label.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ITALIAN) else it.toString() }
            }.toList()
        }
    }

    BackHandler(
        enabled = viewingDocumentItem != null || editingPhotoFilename != null || showTransferPopup || lightboxInitialIndex != null || selectedFilenames.isNotEmpty() || currentTab != VaultTab.GALLERY
    ) {
        when {
            viewingDocumentItem != null -> viewingDocumentItem = null
            editingPhotoFilename != null -> editingPhotoFilename = null
            showTransferPopup -> showTransferPopup = false
            lightboxInitialIndex != null -> lightboxInitialIndex = null
            selectedFilenames.isNotEmpty() -> selectedFilenames = emptySet()
            currentTab != VaultTab.GALLERY -> currentTab = VaultTab.GALLERY
        }
    }

    val galleryGridState = rememberLazyGridState()
    val trashGridState = rememberLazyGridState()

    val galleryDragController = remember { GalleryDragSelectionController() }
    var dragStartIndex by remember { mutableStateOf<Int?>(null) }
    var dragLastIndex by remember { mutableStateOf<Int?>(null) }
    var lastDragGestureEndAtMs by remember { mutableLongStateOf(0L) }

    val galleryFilenameToIndex = remember(gallerySortedItems) {
        HashMap<String, Int>(gallerySortedItems.size * 2).apply {
            gallerySortedItems.forEachIndexed { idx, item -> put(item.filename, idx) }
        }
    }
    val galleryFilenamesList = remember(gallerySortedItems) {
        gallerySortedItems.map { it.filename }
    }

    val currentGalleryFilenamesState = rememberUpdatedState(galleryFilenamesList)
    val currentGalleryIndexMapState = rememberUpdatedState(galleryFilenameToIndex)
    val currentSelectedFilenamesState = rememberUpdatedState(selectedFilenames)
    val currentActiveTabState = rememberUpdatedState(currentTab)
    val currentHapticsEnabledState = rememberUpdatedState(custom.hapticsEnabled)

    fun triggerHaptic(longPress: Boolean = false) {
        if (custom.hapticsEnabled) {
            haptic.performHapticFeedback(
                if (longPress) HapticFeedbackType.LongPress else HapticFeedbackType.TextHandleMove
            )
        }
    }

    var gridLongPressToggleAtMs by remember { mutableLongStateOf(0L) }
    val toggleGallerySelectionFromLongPress: (String) -> Unit = { fn ->
        val now = System.currentTimeMillis()
        if (now - gridLongPressToggleAtMs >= 400L) {
            gridLongPressToggleAtMs = now
            triggerHaptic(longPress = true)
            selectedFilenames = if (selectedFilenames.contains(fn)) {
                selectedFilenames - fn
            } else {
                selectedFilenames + fn
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Minimalist Material You Top Header with Top-Right Transfer Center Button
            Surface(
                color = if (isLgActive) Color.Transparent else MaterialTheme.colorScheme.background.copy(alpha = 0.94f),
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (isLgActive && lgCfg.navBarGlassStyle == NavBarGlassStyle.FLOATING) {
                            Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        } else {
                            Modifier
                        }
                    )
                    .liquidGlassSurface(
                        config = lgCfg,
                        isActive = isLgActive,
                        cornerRadiusDp = if (lgCfg.navBarGlassStyle == NavBarGlassStyle.FLOATING) {
                            lgCfg.componentCornerRadius.toFloat()
                        } else 0f,
                        isElevated = lgCfg.navBarGlassStyle == NavBarGlassStyle.CRYSTAL
                    )
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

                        if (currentTab == VaultTab.TRASH && visibleTrashItems.isNotEmpty()) {
                            FilledTonalButton(
                                onClick = {
                                    optimisticRemovedTrash = visibleTrashItems.map { it.filename }.toSet()
                                    scope.launch {
                                        if (apiClient.emptyTrash()) {
                                            onShowInfo("Cestino svuotato")
                                            onRefresh()
                                        } else {
                                            optimisticRemovedTrash = emptySet()
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

                        // DISCREET ACTIVE-TRANSFER INDICATOR (Visible only while transfers are active or popup is open)
                        AnimatedVisibility(
                            visible = activeRunningOps.isNotEmpty() || showTransferPopup,
                            enter = fadeIn(),
                            exit = fadeOut()
                        ) {
                            Box(contentAlignment = Alignment.TopEnd) {
                                Surface(
                                    onClick = {
                                        triggerHaptic()
                                        showTransferPopup = !showTransferPopup
                                    },
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.primaryContainer,
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
                                                contentDescription = "Trasferimenti in corso",
                                                tint = MaterialTheme.colorScheme.onPrimaryContainer,
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
                                        }
                                    }
                                }

                                if (activeRunningOps.size > 1) {
                                    Surface(
                                        shape = CircleShape,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.offset(x = 4.dp, y = (-4).dp)
                                    ) {
                                        Text(
                                            text = "${activeRunningOps.size}",
                                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                            fontWeight = FontWeight.ExtraBold,
                                            color = MaterialTheme.colorScheme.onPrimary,
                                            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // On-Device AI Category Filter Chips Bar (Tutte + Categorie AI rilevate + Sincronizza AI)
            if (currentTab == VaultTab.GALLERY) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    FilterChip(
                        selected = selectedAiCategoryFilter == null,
                        onClick = { selectedAiCategoryFilter = null },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.AutoAwesome,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                        },
                        label = { Text("Tutte (${mediaOnlyItems.size})") }
                    )
                    if (aiModelState.status == AiModelStatus.INSTALLED) {
                        aiCategoryChips.forEach { chip ->
                            FilterChip(
                                selected = selectedAiCategoryFilter == chip.category,
                                onClick = {
                                    selectedAiCategoryFilter =
                                        if (selectedAiCategoryFilter == chip.category) null else chip.category
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.AutoAwesome,
                                        contentDescription = null,
                                        modifier = Modifier.size(15.dp)
                                    )
                                },
                                label = { Text("${chip.category} (${chip.count})") }
                            )
                        }
                        AssistChip(
                            onClick = {
                                triggerHaptic()
                                PhotoAiIndexingWorker.enqueueIndexing(appCtx, forceReindex = true)
                                onShowInfo("Indicizzazione AI delle foto cloud avviata")
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.Refresh,
                                    contentDescription = "Rianalizza foto cloud con AI locale",
                                    modifier = Modifier.size(16.dp)
                                )
                            },
                            label = { Text("Rianalizza AI") }
                        )
                    } else {
                        AssistChip(
                            onClick = {
                                triggerHaptic()
                                currentTab = VaultTab.SETTINGS
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.CloudDownload,
                                    contentDescription = "Gestisci modello AI facoltativo nelle Impostazioni",
                                    modifier = Modifier.size(16.dp)
                                )
                            },
                            label = {
                                Text(
                                    when (aiModelState.status) {
                                        AiModelStatus.DOWNLOADING -> "Download AI (${aiModelState.progressPercent}%)"
                                        AiModelStatus.PAUSED -> "AI in pausa (${aiModelState.progressPercent}%)"
                                        else -> "Modello AI (Facoltativo)"
                                    }
                                )
                            }
                        )
                    }
                }
            }

            // Non-Invasive On-Device AI Indexing Progress Banner
            AnimatedVisibility(
                visible = currentTab == VaultTab.GALLERY && isAiIndexingRunning,
                enter = fadeIn() + slideInVertically(),
                exit = fadeOut() + slideOutVertically()
            ) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.92f),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 4.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Default.AutoAwesome,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = if (effectiveAiTotal > 0) {
                                        "Indicizzazione AI in corso: $effectiveAiAnalyzed/$effectiveAiTotal foto..."
                                    } else {
                                        "Indicizzazione AI on-device in avvio..."
                                    },
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer
                                )
                            }
                            if (effectiveAiTotal > 0) {
                                val pct = ((effectiveAiAnalyzed.toFloat() / effectiveAiTotal.toFloat()) * 100f)
                                    .toInt()
                                    .coerceIn(0, 100)
                                Text(
                                    text = "$pct%",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        if (effectiveAiTotal > 0) {
                            LinearProgressIndicator(
                                progress = {
                                    (effectiveAiAnalyzed.toFloat() / effectiveAiTotal.toFloat()).coerceIn(0f, 1f)
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(5.dp)
                                    .clip(CircleShape),
                                color = MaterialTheme.colorScheme.primary,
                                trackColor = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.15f)
                            )
                        } else {
                            LinearProgressIndicator(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(5.dp)
                                    .clip(CircleShape),
                                color = MaterialTheme.colorScheme.primary
                            )
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

            // =========================================================================
            // === KEEP-ALIVE TAB CONTENT CONTAINER (0.0ms instant return to Gallery)
            // =========================================================================
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                // 1. PERMANENTLY MOUNTED GALLERY PANE (Never disposed on tab switch!)
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            alpha = if (currentTab == VaultTab.GALLERY) 1f else 0f
                        }
                ) {
                    if (gallerySortedItems.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(bottom = 110.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    imageVector = Icons.Default.PhotoLibrary,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.65f),
                                    modifier = Modifier.size(52.dp)
                                )
                                Spacer(Modifier.height(12.dp))
                                Text(
                                    text = "Nessuna foto o video qui",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = "Tocca + Carica nella barra in basso",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    } else {
                        // 120Hz Photo Grid with Unified Long-Press & Drag-to-Select Controller (Kept alive across tabs)
                        LazyVerticalGrid(
                            state = galleryGridState,
                            columns = GridCells.Fixed(custom.gridColumns.coerceIn(2, 5)),
                            contentPadding = PaddingValues(
                                start = 6.dp,
                                end = 6.dp,
                                top = 6.dp,
                                bottom = 140.dp
                            ),
                            horizontalArrangement = Arrangement.spacedBy(custom.gridSpacingDp.dp),
                            verticalArrangement = Arrangement.spacedBy(custom.gridSpacingDp.dp),
                            userScrollEnabled = currentTab == VaultTab.GALLERY && dragStartIndex == null,
                            modifier = Modifier
                                .fillMaxSize()
                                .pointerInput(Unit) {
                                    val touchSlop = viewConfiguration.touchSlop
                                    val startPaddingPx = 6.dp.toPx()
                                    val touchMarginPx = 14.dp.toPx()
                                    val topAutoScrollZonePx = 115.dp.toPx()
                                    val bottomAutoScrollZonePx = 195.dp.toPx()
                                    val maxAutoScrollSpeedPx = 28.dp.toPx()

                                    awaitEachGesture {
                                        if (currentActiveTabState.value != VaultTab.GALLERY) return@awaitEachGesture

                                        // Phase 0: Detect initial finger touch-down (ACTION_DOWN) without consuming
                                        // so normal taps and normal vertical scrolling continue to work seamlessly.
                                        val down = awaitFirstDown(
                                            requireUnconsumed = false,
                                            pass = PointerEventPass.Initial
                                        )
                                        var activePointerId = down.id
                                        val downPos = down.position

                                        val cellsAtDown = extractVisibleGridCells(
                                            gridState = galleryGridState,
                                            filenameToIndex = currentGalleryIndexMapState.value,
                                            startPaddingPx = startPaddingPx
                                        )
                                        val anchorCell = GalleryDragSelectionController.findCellAtPoint(
                                            cells = cellsAtDown,
                                            x = downPos.x,
                                            y = downPos.y,
                                            snapToNearest = false,
                                            touchMarginPx = touchMarginPx
                                        ) ?: return@awaitEachGesture

                                        // Phase 1: Wait for long-press threshold while checking for early finger lift or scroll
                                        var currentFingerPos = downPos
                                        var abortedBeforeLongPress = false
                                        val longPressWaitMs = minOf(viewConfiguration.longPressTimeoutMillis, 380L)
                                            .coerceAtLeast(250L)

                                        val exitedBeforeTimeout = withTimeoutOrNull(longPressWaitMs) {
                                            while (true) {
                                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                                val change = event.changes.firstOrNull { it.id == activePointerId }
                                                    ?: event.changes.firstOrNull()
                                                if (change == null || !change.pressed || change.isConsumed) {
                                                    abortedBeforeLongPress = true
                                                    break
                                                }
                                                activePointerId = change.id
                                                currentFingerPos = change.position
                                                val dx = kotlin.math.abs(currentFingerPos.x - downPos.x)
                                                val dy = kotlin.math.abs(currentFingerPos.y - downPos.y)
                                                if (dy > touchSlop || dx > touchSlop * 1.35f) {
                                                    abortedBeforeLongPress = true
                                                    break
                                                }
                                            }
                                            true
                                        }

                                        if (exitedBeforeTimeout != null || abortedBeforeLongPress) {
                                            return@awaitEachGesture
                                        }

                                        // Phase 2: Long-press reached! Activate Drag Selection Mode immediately.
                                        val filenamesSnapshot = currentGalleryFilenamesState.value
                                        if (anchorCell.index !in filenamesSnapshot.indices) return@awaitEachGesture

                                        if (currentHapticsEnabledState.value) {
                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        }
                                        gridLongPressToggleAtMs = System.currentTimeMillis()
                                        selectedFilenames = galleryDragController.startDragSelection(
                                            anchorIndex = anchorCell.index,
                                            allFilenames = filenamesSnapshot,
                                            existingSelection = currentSelectedFilenamesState.value
                                        )
                                        dragStartIndex = anchorCell.index
                                        dragLastIndex = anchorCell.index

                                        val cellsAtPhase2 = extractVisibleGridCells(
                                            gridState = galleryGridState,
                                            filenameToIndex = currentGalleryIndexMapState.value,
                                            startPaddingPx = startPaddingPx
                                        )
                                        val initialTargetCell = GalleryDragSelectionController.findCellAtPoint(
                                            cells = cellsAtPhase2,
                                            x = currentFingerPos.x,
                                            y = currentFingerPos.y,
                                            snapToNearest = true,
                                            touchMarginPx = touchMarginPx
                                        )
                                        if (initialTargetCell != null && initialTargetCell.index != anchorCell.index) {
                                            val initRes = galleryDragController.updateDragSelection(
                                                targetIndex = initialTargetCell.index,
                                                allFilenames = filenamesSnapshot
                                            )
                                            if (initRes.changed) {
                                                dragLastIndex = initRes.currentIndex
                                                selectedFilenames = initRes.selectedFilenames
                                            }
                                        }

                                        // Phase 3: Launch continuous 60fps auto-scroll loop when finger is near top/bottom edges
                                        var latestFingerPos = currentFingerPos
                                        val autoScrollJob = scope.launch {
                                            while (galleryDragController.isActive) {
                                                val viewportH = galleryGridState.layoutInfo.viewportSize.height.toFloat()
                                                val velocity = GalleryDragSelectionController.computeAutoScrollVelocityPxPerFrame(
                                                    fingerY = latestFingerPos.y,
                                                    viewportHeight = viewportH,
                                                    topZonePx = topAutoScrollZonePx,
                                                    bottomZonePx = bottomAutoScrollZonePx,
                                                    maxSpeedPxPerFrame = maxAutoScrollSpeedPx
                                                )
                                                if (velocity != 0f) {
                                                    val scrolled = galleryGridState.scrollBy(velocity)
                                                    if (scrolled != 0f) {
                                                        val cellsNow = extractVisibleGridCells(
                                                            gridState = galleryGridState,
                                                            filenameToIndex = currentGalleryIndexMapState.value,
                                                            startPaddingPx = startPaddingPx
                                                        )
                                                        val hitDuringScroll = GalleryDragSelectionController.findCellAtPoint(
                                                            cells = cellsNow,
                                                            x = latestFingerPos.x,
                                                            y = latestFingerPos.y,
                                                            snapToNearest = true,
                                                            touchMarginPx = touchMarginPx
                                                        )
                                                        if (hitDuringScroll != null) {
                                                            val res = galleryDragController.updateDragSelection(
                                                                targetIndex = hitDuringScroll.index,
                                                                allFilenames = currentGalleryFilenamesState.value
                                                            )
                                                            if (res.changed) {
                                                                dragLastIndex = res.currentIndex
                                                                if (currentHapticsEnabledState.value) {
                                                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                                }
                                                                selectedFilenames = res.selectedFilenames
                                                            }
                                                        }
                                                    }
                                                }
                                                delay(16L)
                                            }
                                        }

                                        // Phase 4: Track finger movement (ACTION_MOVE) until release (ACTION_UP / ACTION_CANCEL)
                                        try {
                                            while (true) {
                                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                                // Consume all pointer events on Initial pass so child tiles and
                                                // scrollable never react to drag movements or final finger release.
                                                event.changes.forEach { it.consume() }

                                                val pointer = event.changes.firstOrNull { it.id == activePointerId }
                                                    ?: event.changes.firstOrNull { it.pressed }
                                                    ?: event.changes.firstOrNull()

                                                if (pointer == null || !pointer.pressed || event.changes.none { it.pressed }) {
                                                    break
                                                }

                                                activePointerId = pointer.id
                                                latestFingerPos = pointer.position

                                                val cellsNow = extractVisibleGridCells(
                                                    gridState = galleryGridState,
                                                    filenameToIndex = currentGalleryIndexMapState.value,
                                                    startPaddingPx = startPaddingPx
                                                )
                                                val hitCell = GalleryDragSelectionController.findCellAtPoint(
                                                    cells = cellsNow,
                                                    x = pointer.position.x,
                                                    y = pointer.position.y,
                                                    snapToNearest = true,
                                                    touchMarginPx = touchMarginPx
                                                )
                                                if (hitCell != null) {
                                                    val res = galleryDragController.updateDragSelection(
                                                        targetIndex = hitCell.index,
                                                        allFilenames = currentGalleryFilenamesState.value
                                                    )
                                                    if (res.changed) {
                                                        dragLastIndex = res.currentIndex
                                                        if (currentHapticsEnabledState.value) {
                                                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                        }
                                                        selectedFilenames = res.selectedFilenames
                                                    }
                                                }
                                            }
                                        } finally {
                                            autoScrollJob.cancel()
                                            galleryDragController.endDragSelection()
                                            dragStartIndex = null
                                            dragLastIndex = null
                                            lastDragGestureEndAtMs = System.currentTimeMillis()
                                        }
                                    }
                                }
                        ) {
                            galleryGroupedSections.forEach { (sectionTitle, sectionItems) ->
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
                                        fromTrash = false,
                                        isSelected = isSelected,
                                        inSelectionMode = selectedFilenames.isNotEmpty(),
                                        cornerRadiusDp = custom.tileCornerRadiusDp,
                                        aspectRatio = if (custom.portraitAspectRatio) 0.8f else 1f,
                                        showVideoBadge = custom.showVideoBadges,
                                        onClick = {
                                            if (currentTab != VaultTab.GALLERY) return@MediaGridTile
                                            if (dragStartIndex != null || System.currentTimeMillis() - lastDragGestureEndAtMs < 180L) {
                                                return@MediaGridTile
                                            }
                                            if (selectedFilenames.isNotEmpty()) {
                                                triggerHaptic()
                                                selectedFilenames = if (isSelected) {
                                                    selectedFilenames - mediaItem.filename
                                                } else {
                                                    selectedFilenames + mediaItem.filename
                                                }
                                            } else if (mediaItem.isMedia) {
                                                val globalIndex = galleryFilenameToIndex[mediaItem.filename] ?: -1
                                                if (globalIndex >= 0) {
                                                    lightboxInitialIndex = globalIndex
                                                }
                                            } else {
                                                handleOpenCloudItem(mediaItem)
                                            }
                                        },
                                        onLongClick = null,
                                        onRestore = null,
                                        onDeletePermanent = null
                                    )
                                }
                            }
                        }
                    }
                }

                // 2. OVERLAY PANES FOR FILES, TRASH, AND SETTINGS
                when (currentTab) {
                    VaultTab.GALLERY -> Unit

                    VaultTab.SETTINGS -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(MaterialTheme.colorScheme.background)
                        ) {
                            if (isLgActive) {
                                LiquidGlassBackdropCanvas(
                                    config = lgCfg,
                                    isDarkTheme = isDarkTheme
                                )
                            }
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
                    }

                    VaultTab.FILES -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(MaterialTheme.colorScheme.background)
                        ) {
                            if (isLgActive) {
                                LiquidGlassBackdropCanvas(
                                    config = lgCfg,
                                    isDarkTheme = isDarkTheme
                                )
                            }
                            NativeCloudFileManagerScreen(
                                files = filesSortedItems,
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
                                onOpenFile = { item ->
                                    handleOpenCloudItem(item)
                                },
                                onOpenWithExternalApp = { item ->
                                    openCloudItemWithExternalChooser(item)
                                },
                                onDownloadFile = { item ->
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
                    }

                    VaultTab.TRASH -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(MaterialTheme.colorScheme.background)
                        ) {
                            if (isLgActive) {
                                LiquidGlassBackdropCanvas(
                                    config = lgCfg,
                                    isDarkTheme = isDarkTheme
                                )
                            }
                            if (trashSortedItems.isEmpty()) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(bottom = 110.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Icon(
                                            imageVector = Icons.Default.DeleteOutline,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.65f),
                                            modifier = Modifier.size(52.dp)
                                        )
                                        Spacer(Modifier.height(12.dp))
                                        Text(
                                            text = "Il cestino è vuoto",
                                            style = MaterialTheme.typography.titleMedium,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                        Spacer(Modifier.height(4.dp))
                                        Text(
                                            text = "Gli elementi eliminati appariranno qui",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            } else {
                                LazyVerticalGrid(
                                    state = trashGridState,
                                    columns = GridCells.Fixed(custom.gridColumns.coerceIn(2, 5)),
                                    contentPadding = PaddingValues(
                                        start = 6.dp,
                                        end = 6.dp,
                                        top = 6.dp,
                                        bottom = 140.dp
                                    ),
                                    horizontalArrangement = Arrangement.spacedBy(custom.gridSpacingDp.dp),
                                    verticalArrangement = Arrangement.spacedBy(custom.gridSpacingDp.dp),
                                    modifier = Modifier.fillMaxSize()
                                ) {
                                    items(
                                        items = trashSortedItems,
                                        key = { "trash_${it.filename}" }
                                    ) { mediaItem ->
                                        MediaGridTile(
                                            apiClient = apiClient,
                                            item = mediaItem,
                                            fromTrash = true,
                                            isSelected = false,
                                            inSelectionMode = false,
                                            cornerRadiusDp = custom.tileCornerRadiusDp,
                                            aspectRatio = if (custom.portraitAspectRatio) 0.8f else 1f,
                                            showVideoBadge = custom.showVideoBadges,
                                            onClick = {
                                                if (mediaItem.isMedia) {
                                                    val globalIndex = trashSortedItems.indexOfFirst { it.filename == mediaItem.filename }
                                                    if (globalIndex >= 0) {
                                                        lightboxInitialIndex = globalIndex
                                                    }
                                                } else {
                                                    handleOpenCloudItem(mediaItem)
                                                }
                                            },
                                            onLongClick = {},
                                            onRestore = {
                                                optimisticRemovedTrash = optimisticRemovedTrash + mediaItem.filename
                                                scope.launch {
                                                    if (apiClient.restoreFromTrash(mediaItem.filename)) {
                                                        onShowInfo("Elemento ripristinato")
                                                        onRefresh()
                                                    } else {
                                                        optimisticRemovedTrash = optimisticRemovedTrash - mediaItem.filename
                                                    }
                                                }
                                            },
                                            onDeletePermanent = {
                                                optimisticRemovedTrash = optimisticRemovedTrash + mediaItem.filename
                                                scope.launch {
                                                    if (apiClient.deletePermanent(mediaItem.filename)) {
                                                        onShowInfo("Eliminato definitivamente")
                                                        onRefresh()
                                                    } else {
                                                        optimisticRemovedTrash = optimisticRemovedTrash - mediaItem.filename
                                                    }
                                                }
                                            }
                                        )
                                    }
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
                val selectableFilenames = remember(currentTab, gallerySortedItems, filesSortedItems) {
                    if (currentTab == VaultTab.GALLERY) {
                        gallerySortedItems.map { it.filename }.toSet()
                    } else {
                        filesSortedItems.map { it.filename }.toSet()
                    }
                }
                val allSelected = selectableFilenames.isNotEmpty() && selectableFilenames.all { selectedFilenames.contains(it) }
                SelectionActionsPanel(
                    selectedCount = selectedFilenames.size,
                    allSelected = allSelected,
                    onToggleSelectAll = {
                        triggerHaptic()
                        selectedFilenames = if (allSelected) emptySet() else selectableFilenames
                    },
                    onMoveToAlbum = {
                        triggerHaptic()
                        showAlbumDialog = true
                    },
                    onDownload = {
                        val toDownload = selectedFilenames.toList()
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
                    onTrash = {
                        val toTrash = selectedFilenames.toList()
                        if (custom.confirmBeforeTrash) {
                            pendingTrashConfirmFilenames = toTrash
                        } else {
                            optimisticRemovedGallery = optimisticRemovedGallery + toTrash
                            selectedFilenames = emptySet()
                            scope.launch {
                                if (apiClient.moveBatchToTrash(toTrash)) {
                                    onShowInfo("${toTrash.size} elementi spostati nel cestino")
                                    onRefresh()
                                } else {
                                    optimisticRemovedGallery = optimisticRemovedGallery - toTrash.toSet()
                                }
                            }
                        }
                    },
                    onClearSelection = { selectedFilenames = emptySet() },
                    modifier = Modifier.padding(bottom = 10.dp)
                )
            }

            val barHeight = if (custom.compactFloatingBar) 54.dp else 64.dp
            val pillHeight = if (custom.compactFloatingBar) 40.dp else 46.dp

            Surface(
                shape = CircleShape,
                color = if (isLgActive) Color.Transparent else MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.96f),
                tonalElevation = if (isLgActive) 0.dp else 6.dp,
                shadowElevation = if (isLgActive) 0.dp else 16.dp,
                modifier = Modifier
                    .height(barHeight)
                    .liquidGlassSurface(
                        config = lgCfg,
                        isActive = isLgActive,
                        cornerRadiusDp = 36f,
                        isElevated = true
                    )
                    .then(
                        if (isLgActive) Modifier
                        else Modifier.border(
                            width = 1.dp,
                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f),
                            shape = CircleShape
                        )
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
                aiCategoriesByFilename = aiCategoriesByFilename,
                photoAiDao = photoAiDao,
                onClose = { lightboxInitialIndex = null },
                onEditPhoto = { filename ->
                    editingPhotoFilename = filename
                },
                onMoveToTrash = { filename ->
                    if (custom.confirmBeforeTrash) {
                        pendingTrashConfirmFilenames = listOf(filename)
                    } else {
                        optimisticRemovedGallery = optimisticRemovedGallery + filename
                        lightboxInitialIndex = null
                        scope.launch {
                            if (apiClient.moveToTrash(filename)) {
                                onShowInfo("Spostato nel cestino")
                                onRefresh()
                            } else {
                                optimisticRemovedGallery = optimisticRemovedGallery - filename
                            }
                        }
                    }
                },
                onRestore = { filename ->
                    optimisticRemovedTrash = optimisticRemovedTrash + filename
                    lightboxInitialIndex = null
                    scope.launch {
                        if (apiClient.restoreFromTrash(filename)) {
                            onShowInfo("Elemento ripristinato")
                            onRefresh()
                        } else {
                            optimisticRemovedTrash = optimisticRemovedTrash - filename
                        }
                    }
                },
                onDownload = { filename ->
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

        val editTargetFilename = editingPhotoFilename
        if (editTargetFilename != null) {
            NativePhotoEditorModal(
                apiClient = apiClient,
                filename = editTargetFilename,
                onClose = { editingPhotoFilename = null },
                onSaved = { msg ->
                    editingPhotoFilename = null
                    onShowInfo(msg)
                    onRefresh()
                },
                onTransferUpdate = { op ->
                    upsertTransferOperation(op)
                }
            )
        }

        val docTargetItem = viewingDocumentItem
        if (docTargetItem != null) {
            NativeDocumentViewerModal(
                apiClient = apiClient,
                item = docTargetItem,
                fromTrash = isFromTrash,
                onClose = { viewingDocumentItem = null },
                onOpenWithExternalApp = {
                    openCloudItemWithExternalChooser(docTargetItem)
                },
                onDownloadToDevice = {
                    scope.launch {
                        val (_, msg) = apiClient.saveSingleMediaToDownloads(
                            filename = docTargetItem.filename,
                            fromTrash = isFromTrash,
                            onTransferUpdate = { op -> upsertTransferOperation(op) }
                        )
                        onShowInfo(msg)
                    }
                },
                onTransferUpdate = { op -> upsertTransferOperation(op) }
            )
        }

        val fallbackItem = externalFallbackItem
        if (fallbackItem != null) {
            AlertDialog(
                onDismissRequest = { externalFallbackItem = null },
                shape = RoundedCornerShape(28.dp),
                title = { Text("Nessuna app compatibile trovata", fontWeight = FontWeight.Bold) },
                text = {
                    Text(
                        "Sul dispositivo non risultano installate applicazioni compatibili per aprire direttamente \"${fallbackItem.filename}\". Vuoi scaricare manualmente il file nella cartella Download?"
                    )
                },
                confirmButton = {
                    Button(
                        onClick = {
                            val target = fallbackItem
                            externalFallbackItem = null
                            scope.launch {
                                val (_, msg) = apiClient.saveSingleMediaToDownloads(
                                    filename = target.filename,
                                    fromTrash = isFromTrash,
                                    onTransferUpdate = { op -> upsertTransferOperation(op) }
                                )
                                onShowInfo(msg)
                            }
                        }
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Scarica in Download")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { externalFallbackItem = null }) {
                        Text("Annulla")
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
                            optimisticRemovedGallery = optimisticRemovedGallery + list
                            selectedFilenames = emptySet()
                            lightboxInitialIndex = null
                            scope.launch {
                                val ok = if (list.size == 1) {
                                    apiClient.moveToTrash(list.first())
                                } else {
                                    apiClient.moveBatchToTrash(list)
                                }
                                if (ok) {
                                    onShowInfo("${list.size} elementi spostati nel cestino")
                                    onRefresh()
                                } else {
                                    optimisticRemovedGallery = optimisticRemovedGallery - list.toSet()
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
                                                TransferStatus.CANCELLED -> Icons.Default.Close
                                                TransferStatus.RUNNING -> if (op.isUpload) Icons.Default.CloudUpload else Icons.Default.CloudDownload
                                            },
                                            contentDescription = null,
                                            tint = when (op.status) {
                                                TransferStatus.COMPLETED -> MaterialTheme.colorScheme.primary
                                                TransferStatus.ERROR -> MaterialTheme.colorScheme.error
                                                TransferStatus.CANCELLED -> MaterialTheme.colorScheme.onSurfaceVariant
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
    onOpenFile: (MediaItemModel) -> Unit,
    onOpenWithExternalApp: (MediaItemModel) -> Unit,
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
                                            onOpenFile(fileItem)
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
                                    IconButton(onClick = { onOpenWithExternalApp(fileItem) }) {
                                        Icon(
                                            imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                                            contentDescription = "Apri con un'altra app",
                                            tint = MaterialTheme.colorScheme.secondary
                                        )
                                    }
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

/**
 * Options panel shown when one or more files/media are selected (typically right after a long-press).
 * Offers batch actions for the chosen files: move them to another album, download them,
 * move them to the trash, select/deselect everything.
 */
@Composable
fun SelectionActionsPanel(
    selectedCount: Int,
    allSelected: Boolean,
    onToggleSelectAll: () -> Unit,
    onMoveToAlbum: () -> Unit,
    onDownload: () -> Unit,
    onTrash: () -> Unit,
    onClearSelection: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        tonalElevation = 8.dp,
        shadowElevation = 12.dp,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.size(34.dp)
                    ) {
                        Text(
                            text = "$selectedCount",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = if (selectedCount == 1) "1 elemento selezionato" else "$selectedCount elementi selezionati",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "Scegli cosa fare con la selezione",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                TextButton(
                    onClick = onToggleSelectAll,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Icon(Icons.Default.DoneAll, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(if (allSelected) "Deseleziona tutti" else "Seleziona tutti")
                }
                IconButton(
                    onClick = onClearSelection,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(Icons.Default.Close, contentDescription = "Deseleziona tutto")
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
            ) {
                FilledTonalButton(
                    onClick = onMoveToAlbum,
                    shape = CircleShape,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Icon(Icons.Default.PhotoAlbum, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Sposta in album…")
                }

                FilledTonalButton(
                    onClick = onDownload,
                    shape = CircleShape,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Scarica ($selectedCount)")
                }

                Button(
                    onClick = onTrash,
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
    val prefs = remember { activity.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE) }
    var savedLgPresets by remember { mutableStateOf(LiquidGlassConfigStore.loadSavedPresets(prefs)) }
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = 16.dp)
            .padding(top = 6.dp, bottom = 140.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 0. DUAL-THEME SELECTOR & LIQUID GLASS CUSTOMIZATION STUDIO
        LiquidGlassStudioSection(
            context = activity,
            designThemeMode = custom.designThemeMode,
            liquidConfig = custom.liquidGlassConfig,
            savedPresets = savedLgPresets,
            onSelectDesignTheme = { mode ->
                onUpdateCustom(custom.copy(designThemeMode = mode))
            },
            onUpdateLiquidConfig = { newLg ->
                onUpdateCustom(custom.copy(liquidGlassConfig = newLg))
            },
            onSaveCustomPreset = { presetName ->
                savedLgPresets = LiquidGlassConfigStore.saveCustomPreset(
                    prefs = prefs,
                    name = presetName,
                    config = custom.liquidGlassConfig
                )
            },
            onResetDefaults = {
                onUpdateCustom(custom.copy(liquidGlassConfig = LiquidGlassConfig()))
            },
            onShowInfo = onShowInfo
        )

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

        // 7. MODELLO AI LOCALE ON-DEVICE (DOWNLOAD FACOLTATIVO)
        val aiModelState by AiModelDownloadManager.state.collectAsState()
        LaunchedEffect(Unit) {
            AiModelDownloadManager.refreshState(activity)
        }

        SettingsSectionCard(
            title = "Modello AI Locale (Facoltativo)",
            icon = Icons.Default.AutoAwesome
        ) {
            val statusText = when (aiModelState.status) {
                AiModelStatus.INSTALLED -> "Installato e attivo (${PhotoCloudApiClient.formatBytesHuman(aiModelState.installedSizeBytes)})"
                AiModelStatus.DOWNLOADING -> "Download in corso (${aiModelState.progressPercent}%)"
                AiModelStatus.PAUSED -> "Download in pausa (${aiModelState.progressPercent}%)"
                AiModelStatus.ERROR -> "Download interrotto"
                AiModelStatus.NOT_INSTALLED -> "Non installato (App funzionante senza AI)"
            }
            val freeSpaceText = PhotoCloudApiClient.formatBytesHuman(aiModelState.availableStorageBytes)
            val modelSizeText = PhotoCloudApiClient.formatBytesHuman(aiModelState.totalBytes)
            val requiredSpaceText = PhotoCloudApiClient.formatBytesHuman(aiModelState.requiredStorageBytes)

            Text(
                text = "Categorizzazione automatica delle foto 100% offline sul dispositivo (EfficientNet-Lite). Il download è facoltativo e puoi rimuovere il modello in qualsiasi momento per liberare spazio.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(10.dp))

            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = "Stato: $statusText",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (aiModelState.status == AiModelStatus.INSTALLED) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        }
                    )
                    Text(
                        text = "Dimensione download: $modelSizeText • Spazio richiesto: $requiredSpaceText",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "Spazio disponibile sul dispositivo: $freeSpaceText",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (aiModelState.status == AiModelStatus.DOWNLOADING || aiModelState.status == AiModelStatus.PAUSED) {
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${PhotoCloudApiClient.formatBytesHuman(aiModelState.downloadedBytes)} / ${PhotoCloudApiClient.formatBytesHuman(aiModelState.totalBytes)} (${aiModelState.progressPercent}%)",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    if (aiModelState.speedBytesPerSec > 0L) {
                        Text(
                            text = PhotoCloudApiClient.formatSpeedHuman(aiModelState.speedBytesPerSec),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { aiModelState.progressFraction },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(CircleShape)
                )
            }

            if (!aiModelState.errorMessage.isNullOrBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    text = aiModelState.errorMessage ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(Modifier.height(12.dp))

            when (aiModelState.status) {
                AiModelStatus.NOT_INSTALLED -> {
                    Button(
                        onClick = {
                            AiModelDownloadManager.startOrResumeDownload(activity, serverUrl)
                        },
                        shape = CircleShape,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.CloudDownload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Scarica Modello AI ($modelSizeText)", fontWeight = FontWeight.SemiBold)
                    }
                }

                AiModelStatus.DOWNLOADING -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        FilledTonalButton(
                            onClick = { AiModelDownloadManager.pauseDownload(activity) },
                            shape = CircleShape,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Pause, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Pausa")
                        }
                        OutlinedButton(
                            onClick = {
                                AiModelDownloadManager.cancelDownload(activity)
                                onShowInfo("Download modello AI annullato")
                            },
                            shape = CircleShape,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Annulla")
                        }
                    }
                }

                AiModelStatus.PAUSED, AiModelStatus.ERROR -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                AiModelDownloadManager.startOrResumeDownload(activity, serverUrl)
                            },
                            shape = CircleShape,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (aiModelState.downloadedBytes > 0L) "Riprendi" else "Riprova")
                        }
                        OutlinedButton(
                            onClick = {
                                AiModelDownloadManager.cancelDownload(activity)
                                onShowInfo("File parziale del modello AI rimosso")
                            },
                            shape = CircleShape,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Annulla")
                        }
                    }
                }

                AiModelStatus.INSTALLED -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        FilledTonalButton(
                            onClick = {
                                PhotoAiIndexingWorker.enqueueIndexing(activity, forceReindex = true)
                                onShowInfo("Indicizzazione AI delle foto cloud avviata")
                            },
                            shape = CircleShape,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Rianalizza Foto")
                        }
                        OutlinedButton(
                            onClick = {
                                AiModelDownloadManager.deleteInstalledModel(activity) {
                                    activity.runOnUiThread {
                                        onShowInfo("Modello AI eliminato e spazio liberato")
                                    }
                                }
                            },
                            shape = CircleShape,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Elimina Modello")
                        }
                    }
                }
            }
        }

        // 8. SISTEMA DI AGGIORNAMENTO AUTOMATICO APP
        val updateState by AppAutoUpdater.state.collectAsState()
        SettingsSectionCard(
            title = "Versione & Aggiornamenti App",
            icon = Icons.Default.CloudDone
        ) {
            Text(
                text = "Versione installata: v${BuildConfig.VERSION_NAME} (versionCode ${BuildConfig.VERSION_CODE})",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Controllo automatico all'apertura su GitHub Releases e server PhotoCloud con verifica integrità SHA-256 e firma digitale X.509 prima dell'installazione.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(12.dp))
            FilledTonalButton(
                onClick = {
                    AppAutoUpdater.checkForUpdates(
                        context = activity,
                        serverUrl = serverUrl,
                        silentIfUpToDate = false,
                        onManualResult = { msg ->
                            activity.runOnUiThread {
                                onShowInfo(msg)
                            }
                        }
                    )
                },
                enabled = updateState.status != AppUpdateStatus.CHECKING && updateState.status != AppUpdateStatus.DOWNLOADING,
                shape = CircleShape,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    if (updateState.status == AppUpdateStatus.CHECKING) {
                        "Verifica aggiornamenti in corso..."
                    } else {
                        "Controlla Aggiornamenti Ora"
                    },
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
fun AppUpdateModal(
    updateState: AppUpdateState,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onInstall: () -> Unit,
    onDismiss: () -> Unit
) {
    val manifest = updateState.manifest ?: return
    AlertDialog(
        onDismissRequest = {
            if (updateState.status != AppUpdateStatus.DOWNLOADING && updateState.status != AppUpdateStatus.VERIFYING) {
                onDismiss()
            }
        },
        shape = RoundedCornerShape(28.dp),
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.CloudDownload,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Column {
                    Text(
                        text = "Aggiornamento v${manifest.versionName}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    if (manifest.fileSizeBytes > 0L) {
                        Text(
                            text = "Dimensione: ${PhotoCloudApiClient.formatBytesHuman(manifest.fileSizeBytes)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                when (updateState.status) {
                    AppUpdateStatus.DOWNLOADING, AppUpdateStatus.VERIFYING -> {
                        Text(
                            text = if (updateState.status == AppUpdateStatus.VERIFYING) {
                                "Verifica integrità SHA-256 e firma digitale APK in corso..."
                            } else {
                                "Download automatico dell'aggiornamento in corso..."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = if (updateState.totalBytes > 0L) {
                                    "${PhotoCloudApiClient.formatBytesHuman(updateState.downloadedBytes)} / ${PhotoCloudApiClient.formatBytesHuman(updateState.totalBytes)} (${updateState.progressPercent}%)"
                                } else {
                                    PhotoCloudApiClient.formatBytesHuman(updateState.downloadedBytes)
                                },
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            if (updateState.speedBytesPerSec > 0L) {
                                Text(
                                    text = PhotoCloudApiClient.formatSpeedHuman(updateState.speedBytesPerSec),
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                        if (updateState.totalBytes > 0L) {
                            LinearProgressIndicator(
                                progress = { updateState.progressFraction },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(7.dp)
                                    .clip(CircleShape)
                            )
                        } else {
                            LinearProgressIndicator(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(7.dp)
                                    .clip(CircleShape)
                            )
                        }
                    }

                    AppUpdateStatus.READY_TO_INSTALL, AppUpdateStatus.PERMISSION_REQUIRED -> {
                        Text(
                            text = "Integrità SHA-256 e firma digitale verificate con successo. Tocca Installa per aprire il programma di installazione ufficiale di Android.",
                            style = MaterialTheme.typography.bodySmall
                        )
                        if (!updateState.errorMessage.isNullOrBlank()) {
                            Text(
                                text = updateState.errorMessage,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }

                    AppUpdateStatus.ERROR -> {
                        Text(
                            text = updateState.errorMessage ?: "Errore durante l'aggiornamento.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    else -> Unit
                }

                if (manifest.changelog.isNotEmpty()) {
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = "Novità della versione v${manifest.versionName}:",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold
                            )
                            manifest.changelog.take(4).forEach { line ->
                                Text(
                                    text = "• $line",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            when (updateState.status) {
                AppUpdateStatus.READY_TO_INSTALL, AppUpdateStatus.PERMISSION_REQUIRED -> {
                    Button(onClick = onInstall) {
                        Text("Installa Aggiornamento")
                    }
                }
                AppUpdateStatus.ERROR -> {
                    Button(onClick = onRetry) {
                        Text("Riprova Download")
                    }
                }
                else -> {}
            }
        },
        dismissButton = {
            if (updateState.status == AppUpdateStatus.DOWNLOADING) {
                TextButton(onClick = onCancel) {
                    Text("Annulla Download")
                }
            } else {
                TextButton(onClick = onDismiss) {
                    Text("Chiudi")
                }
            }
        }
    )
}

@Composable
fun SettingsSectionCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    val isLgActive = LocalLiquidGlassActive.current
    val lgCfg = LocalLiquidGlassConfig.current
    val cardRadius = if (isLgActive) lgCfg.componentCornerRadius.dp else 26.dp

    Surface(
        shape = RoundedCornerShape(cardRadius),
        color = if (isLgActive) Color.Transparent else MaterialTheme.colorScheme.surfaceContainerLow,
        tonalElevation = if (isLgActive) 0.dp else 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlassSurface(
                config = lgCfg,
                isActive = isLgActive,
                cornerRadiusDp = cardRadius.value,
                isElevated = lgCfg.cardGlassStyle != CardGlassStyle.FROSTED
            )
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
    onLongClick: (() -> Unit)? = null,
    onRestore: (() -> Unit)? = null,
    onDeletePermanent: (() -> Unit)? = null
) {
    var bitmap by remember(item.filename, fromTrash) {
        mutableStateOf(
            if (item.isMedia) apiClient.getRamThumbnailBitmap(item.filename, fromTrash) else null
        )
    }
    var loadFailed by remember(item.filename) { mutableStateOf(false) }

    LaunchedEffect(item.filename, fromTrash) {
        if (item.isMedia && bitmap == null) {
            val loaded = apiClient.loadThumbnailBitmap(item.filename, fromTrash)
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
    val rememberedImageBitmap = remember(bitmap) { bitmap?.asImageBitmap() }

    Box(
        modifier = Modifier
            .aspectRatio(aspectRatio)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .then(
                if (onLongClick != null) {
                    Modifier.combinedClickable(
                        onClick = onClick,
                        onLongClick = onLongClick
                    )
                } else {
                    Modifier.clickable(onClick = onClick)
                }
            )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .scale(scale)
                .clip(shape)
        ) {
            if (rememberedImageBitmap != null) {
                Image(
                    bitmap = rememberedImageBitmap,
                    contentDescription = item.filename,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
                if (item.isVideo && showVideoBadge) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = Color.Black.copy(alpha = 0.48f),
                            modifier = Modifier.size(42.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.PlayArrow,
                                    contentDescription = "Video",
                                    tint = Color.White,
                                    modifier = Modifier.size(26.dp)
                                )
                            }
                        }
                    }
                }
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
    aiCategoriesByFilename: Map<String, List<String>> = emptyMap(),
    photoAiDao: PhotoAiDao? = null,
    onClose: () -> Unit,
    onEditPhoto: (String) -> Unit,
    onMoveToTrash: (String) -> Unit,
    onRestore: (String) -> Unit,
    onDownload: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val localCtx = LocalContext.current.applicationContext
    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { items.size }
    )
    val currentItem = items.getOrNull(pagerState.currentPage) ?: items.first()
    var dismissOffsetY by remember { mutableFloatStateOf(0f) }
    var onDemandAiTags by remember(currentItem.filename) {
        mutableStateOf(aiCategoriesByFilename[currentItem.filename].orEmpty())
    }

    LaunchedEffect(currentItem.filename, aiCategoriesByFilename) {
        val existing = aiCategoriesByFilename[currentItem.filename].orEmpty()
        if (existing.isNotEmpty()) {
            onDemandAiTags = existing
        } else if (!currentItem.isVideo && !fromTrash && AiModelDownloadManager.isModelInstalled(localCtx)) {
            val bmp = apiClient.getCachedBitmap(currentItem.filename, fromTrash)
                ?: apiClient.getRamThumbnailBitmap(currentItem.filename, fromTrash)
                ?: apiClient.loadThumbnailBitmap(currentItem.filename, fromTrash)
            if (bmp != null) {
                val classified = withContext(Dispatchers.Default) {
                    LocalPhotoCategorizer(localCtx).use { categorizer ->
                        categorizer.classifyBitmap(bmp)
                    }
                }
                if (classified.categories.isNotEmpty()) {
                    onDemandAiTags = classified.categories
                    photoAiDao?.upsert(
                        PhotoAiEntity(
                            uriString = "cloud://${currentItem.filename}",
                            mediaStoreId = 0L,
                            filename = currentItem.filename,
                            categories = classified.categories.joinToString(","),
                            topConfidence = classified.topConfidence,
                            isAnalyzed = true,
                            timestamp = System.currentTimeMillis()
                        )
                    )
                }
            }
        }
    }

    // Preload adjacent photos for 0ms swipe transitions
    LaunchedEffect(pagerState.currentPage, items.size) {
        dismissOffsetY = 0f
        val neighbors = listOf(pagerState.currentPage - 1, pagerState.currentPage + 1)
        for (idx in neighbors) {
            val neighbor = items.getOrNull(idx)
            if (neighbor != null && !neighbor.isVideo && apiClient.getCachedBitmap(neighbor.filename, fromTrash) == null) {
                launch {
                    apiClient.loadMediaBitmap(neighbor.filename, fromTrash)
                }
            }
        }
    }

    val dismissProgress = (abs(dismissOffsetY) / 420f).coerceIn(0f, 1f)
    val backdropAlpha = (1f - dismissProgress * 0.55f).coerceIn(0.35f, 1f)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF08080A).copy(alpha = backdropAlpha))
    ) {
        HorizontalPager(
            state = pagerState,
            beyondViewportPageCount = 1,
            modifier = Modifier.fillMaxSize()
        ) { pageIndex ->
            val media = items[pageIndex]
            var bmp by remember(media.filename, fromTrash) {
                mutableStateOf(
                    apiClient.getCachedBitmap(media.filename, fromTrash)
                        ?: apiClient.getRamThumbnailBitmap(media.filename, fromTrash)
                )
            }
            var isLoading by remember(media.filename) { mutableStateOf(bmp == null && !media.isVideo) }

            LaunchedEffect(media.filename, fromTrash) {
                if (!media.isVideo && apiClient.getCachedBitmap(media.filename, fromTrash) == null) {
                    if (bmp == null) isLoading = true
                    val fullBmp = apiClient.loadMediaBitmap(media.filename, fromTrash)
                    if (fullBmp != null) {
                        bmp = fullBmp
                    }
                    isLoading = false
                }
            }

            var zoomScale by remember(pageIndex) { mutableFloatStateOf(1f) }
            var offsetX by remember(pageIndex) { mutableFloatStateOf(0f) }
            var offsetY by remember(pageIndex) { mutableFloatStateOf(0f) }

            LaunchedEffect(pagerState.currentPage) {
                if (pagerState.currentPage != pageIndex) {
                    zoomScale = 1f
                    offsetX = 0f
                    offsetY = 0f
                }
            }

            val animatedZoom by animateFloatAsState(
                targetValue = zoomScale,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioNoBouncy,
                    stiffness = Spring.StiffnessMediumLow
                ),
                label = "lightboxZoom"
            )
            val animatedDismissY by animateFloatAsState(
                targetValue = if (pagerState.currentPage == pageIndex) dismissOffsetY else 0f,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioNoBouncy,
                    stiffness = Spring.StiffnessMedium
                ),
                label = "lightboxDismissY"
            )

            // Coherent page transition calculation based on continuous HorizontalPager offset
            val pageOffset = (pagerState.currentPage - pageIndex) + pagerState.currentPageOffsetFraction
            val absPageOffset = abs(pageOffset).coerceIn(0f, 1f)
            val transitionScale = 1f - (absPageOffset * 0.12f)
            val transitionAlpha = 1f - (absPageOffset * 0.5f)
            val dismissScale = 1f - (dismissProgress * 0.16f)

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = transitionScale * dismissScale
                        scaleY = transitionScale * dismissScale
                        alpha = transitionAlpha
                        translationY = animatedDismissY
                        translationX = pageOffset * size.width * 0.08f
                    }
                    .pointerInput(pageIndex, media.isVideo) {
                        if (media.isVideo) return@pointerInput
                        detectTapGestures(
                            onDoubleTap = { tapOffset ->
                                if (zoomScale > 1.05f) {
                                    zoomScale = 1f
                                    offsetX = 0f
                                    offsetY = 0f
                                } else {
                                    val targetScale = 2.5f
                                    val cx = size.width / 2f
                                    val cy = size.height / 2f
                                    offsetX = ((cx - tapOffset.x) * (targetScale - 1f)).coerceIn(-cx, cx)
                                    offsetY = ((cy - tapOffset.y) * (targetScale - 1f)).coerceIn(-cy, cy)
                                    zoomScale = targetScale
                                }
                            }
                        )
                    }
                    .pointerInput(pageIndex, media.isVideo) {
                        // Per i video il touch va lasciato al player: lo swipe sulla seek bar
                        // non deve essere rubato dal pinch/pan del lightbox.
                        if (media.isVideo) return@pointerInput
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            var verticalDismissActive = false
                            var totalDx = 0f
                            var totalDy = 0f
                            do {
                                val event = awaitPointerEvent()
                                val pointerCount = event.changes.count { it.pressed }
                                if (pointerCount >= 2) {
                                    verticalDismissActive = false
                                    dismissOffsetY = 0f
                                    val zoomChange = event.calculateZoom()
                                    val panChange = event.calculatePan()
                                    val newScale = (zoomScale * zoomChange).coerceIn(1f, 4f)
                                    zoomScale = newScale
                                    if (newScale > 1.01f) {
                                        val maxX = (size.width * (newScale - 1f)) / 2f
                                        val maxY = (size.height * (newScale - 1f)) / 2f
                                        offsetX = (offsetX + panChange.x).coerceIn(-maxX, maxX)
                                        offsetY = (offsetY + panChange.y).coerceIn(-maxY, maxY)
                                    } else {
                                        offsetX = 0f
                                        offsetY = 0f
                                    }
                                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                                } else if (pointerCount == 1) {
                                    val panChange = event.calculatePan()
                                    if (zoomScale > 1.02f) {
                                        val maxX = (size.width * (zoomScale - 1f)) / 2f
                                        val maxY = (size.height * (zoomScale - 1f)) / 2f
                                        val nextX = offsetX + panChange.x
                                        val nextY = offsetY + panChange.y
                                        val atHorizontalEdge = (nextX > maxX && panChange.x > 0f) || (nextX < -maxX && panChange.x < 0f)
                                        offsetX = nextX.coerceIn(-maxX, maxX)
                                        offsetY = nextY.coerceIn(-maxY, maxY)
                                        // Only consume if not pushing past the horizontal edge, allowing pager swipe at edge
                                        if (!atHorizontalEdge || abs(panChange.y) > abs(panChange.x)) {
                                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                                        }
                                    } else {
                                        totalDx += panChange.x
                                        totalDy += panChange.y
                                        if (!verticalDismissActive && abs(totalDy) > 18f && abs(totalDy) > abs(totalDx) * 1.35f) {
                                            verticalDismissActive = true
                                        }
                                        if (verticalDismissActive) {
                                            dismissOffsetY += panChange.y
                                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                                        }
                                        // Horizontal 1-finger drag is left unconsumed so HorizontalPager
                                        // handles smooth swipe navigation between photos!
                                    }
                                }
                            } while (event.changes.any { it.pressed })

                            if (verticalDismissActive) {
                                if (abs(dismissOffsetY) > 150f) {
                                    dismissOffsetY = 0f
                                    onClose()
                                } else {
                                    dismissOffsetY = 0f
                                }
                            }
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                val loadedBitmap = bmp
                if (media.isVideo) {
                    // Le anteprime RAM dei video (v1.1.2) non devono MAI coprire il player:
                    // i video passano sempre da VideoView + MediaController (play/pausa, seek, durata),
                    // altrimenti si vede solo l'immagine statica senza alcun controllo.
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
                                    controller.show(3000)
                                    if (autoplayVideos) {
                                        start()
                                    }
                                }
                            }
                        }
                    )
                } else if (loadedBitmap != null) {
                    Image(
                        bitmap = loadedBitmap.asImageBitmap(),
                        contentDescription = media.filename,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer(
                                scaleX = animatedZoom,
                                scaleY = animatedZoom,
                                translationX = offsetX,
                                translationY = offsetY
                            )
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

        if (items.size > 1) {
            if (pagerState.currentPage > 0) {
                Surface(
                    onClick = {
                        scope.launch {
                            pagerState.animateScrollToPage(
                                page = (pagerState.currentPage - 1).coerceAtLeast(0),
                                animationSpec = spring(
                                    dampingRatio = Spring.DampingRatioNoBouncy,
                                    stiffness = Spring.StiffnessMediumLow
                                )
                            )
                        }
                    },
                    shape = CircleShape,
                    color = Color.White.copy(alpha = 0.14f),
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = 12.dp)
                        .size(42.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.ChevronLeft,
                            contentDescription = "Foto precedente",
                            tint = Color.White
                        )
                    }
                }
            }
            if (pagerState.currentPage < items.lastIndex) {
                Surface(
                    onClick = {
                        scope.launch {
                            pagerState.animateScrollToPage(
                                page = (pagerState.currentPage + 1).coerceAtMost(items.lastIndex),
                                animationSpec = spring(
                                    dampingRatio = Spring.DampingRatioNoBouncy,
                                    stiffness = Spring.StiffnessMediumLow
                                )
                            )
                        }
                    },
                    shape = CircleShape,
                    color = Color.White.copy(alpha = 0.14f),
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(end = 12.dp)
                        .size(42.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.ChevronRight,
                            contentDescription = "Foto successiva",
                            tint = Color.White
                        )
                    }
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

        // AI Category Badges in Photo Detail / Lightbox View
        if (onDemandAiTags.isNotEmpty() && !currentItem.isVideo) {
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 86.dp, start = 16.dp, end = 16.dp)
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                onDemandAiTags.forEach { tag ->
                    Surface(
                        shape = CircleShape,
                        color = Color(0xFF2B2240).copy(alpha = 0.88f),
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp,
                            Color(0xFFD0BCFF).copy(alpha = 0.45f)
                        )
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.AutoAwesome,
                                contentDescription = null,
                                tint = Color(0xFFD0BCFF),
                                modifier = Modifier.size(13.dp)
                            )
                            Spacer(Modifier.width(5.dp))
                            Text(
                                text = tag,
                                color = Color.White,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
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
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(horizontal = 12.dp)
            ) {
                if (!fromTrash && !currentItem.isVideo) {
                    TextButton(
                        onClick = { onEditPhoto(currentItem.filename) },
                        colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFFD0BCFF))
                    ) {
                        Icon(Icons.Default.Tune, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("Modifica", fontWeight = FontWeight.SemiBold)
                    }
                }

                TextButton(
                    onClick = { onDownload(currentItem.filename) },
                    colors = ButtonDefaults.textButtonColors(contentColor = Color.White)
                ) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Salva", fontWeight = FontWeight.SemiBold)
                }

                if (fromTrash) {
                    TextButton(
                        onClick = { onRestore(currentItem.filename) },
                        colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFFA8C7FA))
                    ) {
                        Icon(Icons.Default.RestoreFromTrash, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("Ripristina", fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    TextButton(
                        onClick = { onMoveToTrash(currentItem.filename) },
                        colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFFF2B8B5))
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("Cestina", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

data class AndroidPhotoPreset(
    val id: String,
    val label: String,
    val brightness: Float,
    val contrast: Float,
    val saturation: Float,
    val warmth: Float
)

val ANDROID_PHOTO_PRESETS = listOf(
    AndroidPhotoPreset("original", "Originale", 0f, 0f, 0f, 0f),
    AndroidPhotoPreset("vivid", "Vivido", 6f, 22f, 35f, 8f),
    AndroidPhotoPreset("bw", "Bianco & Nero", 5f, 28f, -100f, 0f),
    AndroidPhotoPreset("sepia", "Seppia", 6f, 12f, -45f, 55f),
    AndroidPhotoPreset("cinema", "Cinema", -4f, 30f, -15f, -18f),
    AndroidPhotoPreset("cool", "Freddo", 4f, 10f, 8f, -35f),
    AndroidPhotoPreset("vintage", "Vintage", 8f, -12f, -25f, 32f)
)

enum class AndroidCropHandle {
    NW, N, NE, E, SE, S, SW, W, MOVE
}

data class NormalizedAndroidCropRect(
    val left: Float = 0f,
    val top: Float = 0f,
    val right: Float = 1f,
    val bottom: Float = 1f
)

fun clampAndroidCropRect(
    rect: NormalizedAndroidCropRect,
    minSpan: Float = 0.08f
): NormalizedAndroidCropRect {
    val span = minSpan.coerceIn(0.04f, 0.5f)
    var l = rect.left.coerceIn(0f, 1f - span)
    var t = rect.top.coerceIn(0f, 1f - span)
    var r = rect.right.coerceIn(l + span, 1f)
    var b = rect.bottom.coerceIn(t + span, 1f)
    if (r - l < span) {
        if (l + span <= 1f) r = l + span else l = (r - span).coerceAtLeast(0f)
    }
    if (b - t < span) {
        if (t + span <= 1f) b = t + span else t = (b - span).coerceAtLeast(0f)
    }
    return NormalizedAndroidCropRect(l, t, r, b)
}

fun fitAndroidAspectCropRect(
    srcW: Int,
    srcH: Int,
    cropRatio: String
): NormalizedAndroidCropRect {
    val targetRatio: Float = when (cropRatio) {
        "1:1" -> 1f
        "4:5" -> 4f / 5f
        "4:3" -> 4f / 3f
        "16:9" -> 16f / 9f
        else -> return NormalizedAndroidCropRect(0f, 0f, 1f, 1f)
    }
    val w = srcW.coerceAtLeast(1).toFloat()
    val h = srcH.coerceAtLeast(1).toFloat()
    val currentRatio = w / h
    var cropW = w
    var cropH = h
    if (currentRatio > targetRatio) {
        cropW = (h * targetRatio).coerceIn(1f, w)
    } else {
        cropH = (w / targetRatio).coerceIn(1f, h)
    }
    val x = ((w - cropW) / 2f).coerceAtLeast(0f)
    val y = ((h - cropH) / 2f).coerceAtLeast(0f)
    return clampAndroidCropRect(
        NormalizedAndroidCropRect(
            left = x / w,
            top = y / h,
            right = (x + cropW) / w,
            bottom = (y + cropH) / h
        )
    )
}

fun dragAndroidCropRect(
    start: NormalizedAndroidCropRect,
    handle: AndroidCropHandle,
    dxNorm: Float,
    dyNorm: Float,
    cropRatio: String,
    imgW: Int,
    imgH: Int,
    minSpan: Float = 0.08f
): NormalizedAndroidCropRect {
    if (handle == AndroidCropHandle.MOVE) {
        val clampedDx = dxNorm.coerceIn(-start.left, 1f - start.right)
        val clampedDy = dyNorm.coerceIn(-start.top, 1f - start.bottom)
        return NormalizedAndroidCropRect(
            left = start.left + clampedDx,
            top = start.top + clampedDy,
            right = start.right + clampedDx,
            bottom = start.bottom + clampedDy
        )
    }

    var l = start.left
    var t = start.top
    var r = start.right
    var b = start.bottom

    if (handle == AndroidCropHandle.NW || handle == AndroidCropHandle.W || handle == AndroidCropHandle.SW) {
        l = (start.left + dxNorm).coerceIn(0f, r - minSpan)
    }
    if (handle == AndroidCropHandle.NE || handle == AndroidCropHandle.E || handle == AndroidCropHandle.SE) {
        r = (start.right + dxNorm).coerceIn(l + minSpan, 1f)
    }
    if (handle == AndroidCropHandle.NW || handle == AndroidCropHandle.N || handle == AndroidCropHandle.NE) {
        t = (start.top + dyNorm).coerceIn(0f, b - minSpan)
    }
    if (handle == AndroidCropHandle.SW || handle == AndroidCropHandle.S || handle == AndroidCropHandle.SE) {
        b = (start.bottom + dyNorm).coerceIn(t + minSpan, 1f)
    }

    val targetPixelRatio: Float? = when (cropRatio) {
        "1:1" -> 1f
        "4:5" -> 4f / 5f
        "4:3" -> 4f / 3f
        "16:9" -> 16f / 9f
        else -> null
    }

    if (targetPixelRatio != null) {
        val imgRatio = imgW.coerceAtLeast(1).toFloat() / imgH.coerceAtLeast(1).toFloat()
        val normRatio = targetPixelRatio / imgRatio
        val newW = r - l
        val newH = b - t
        if (handle == AndroidCropHandle.N || handle == AndroidCropHandle.S) {
            val desiredW = (newH * normRatio).coerceIn(minSpan, 1f)
            val cx = (l + r) / 2f
            l = (cx - desiredW / 2f).coerceIn(0f, 1f - desiredW)
            r = l + desiredW
        } else {
            val desiredH = (newW / normRatio).coerceIn(minSpan, 1f)
            if (handle == AndroidCropHandle.NW || handle == AndroidCropHandle.NE) {
                t = (b - desiredH).coerceAtLeast(0f)
                b = t + desiredH
            } else if (handle == AndroidCropHandle.SW || handle == AndroidCropHandle.SE) {
                b = (t + desiredH).coerceAtMost(1f)
                t = b - desiredH
            } else {
                val cy = (t + b) / 2f
                t = (cy - desiredH / 2f).coerceIn(0f, 1f - desiredH)
                b = t + desiredH
            }
        }
    }

    return clampAndroidCropRect(NormalizedAndroidCropRect(l, t, r, b), minSpan)
}

fun renderEditedAndroidBitmap(
    source: android.graphics.Bitmap,
    brightness: Float,
    contrast: Float,
    saturation: Float,
    warmth: Float,
    rotationDegrees: Int,
    flipH: Boolean,
    flipV: Boolean,
    cropRect: NormalizedAndroidCropRect = NormalizedAndroidCropRect(),
    applyCrop: Boolean = true
): android.graphics.Bitmap {
    val normRot = ((rotationDegrees % 360) + 360) % 360
    val matrix = android.graphics.Matrix()
    if (normRot != 0) {
        matrix.postRotate(normRot.toFloat())
    }
    if (flipH || flipV) {
        matrix.postScale(if (flipH) -1f else 1f, if (flipV) -1f else 1f)
    }

    val transformed = if (normRot != 0 || flipH || flipV) {
        android.graphics.Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    } else {
        source
    }

    val srcW = transformed.width.coerceAtLeast(1)
    val srcH = transformed.height.coerceAtLeast(1)

    val safeBox = clampAndroidCropRect(cropRect, 0.04f)
    val cropX = if (applyCrop) (safeBox.left * srcW).toInt().coerceIn(0, srcW - 1) else 0
    val cropY = if (applyCrop) (safeBox.top * srcH).toInt().coerceIn(0, srcH - 1) else 0
    val cropW = if (applyCrop) ((safeBox.right - safeBox.left) * srcW).toInt().coerceIn(1, srcW - cropX) else srcW
    val cropH = if (applyCrop) ((safeBox.bottom - safeBox.top) * srcH).toInt().coerceIn(1, srcH - cropY) else srcH

    val outBitmap = android.graphics.Bitmap.createBitmap(
        cropW,
        cropH,
        android.graphics.Bitmap.Config.ARGB_8888
    )
    val canvas = android.graphics.Canvas(outBitmap)

    val satFactor = ((100f + saturation) / 100f).coerceAtLeast(0f)
    val satMatrix = android.graphics.ColorMatrix().apply {
        setSaturation(satFactor)
    }

    val cFactor = ((100f + contrast) / 100f).coerceAtLeast(0f)
    val cScale = cFactor * cFactor
    val bOffset = brightness * 1.6f + 128f * (1f - cScale)
    val rWarm = warmth * 0.45f
    val gWarm = warmth * 0.10f
    val bWarm = -warmth * 0.45f

    val adjustMatrix = android.graphics.ColorMatrix(
        floatArrayOf(
            cScale, 0f, 0f, 0f, bOffset + rWarm,
            0f, cScale, 0f, 0f, bOffset + gWarm,
            0f, 0f, cScale, 0f, bOffset + bWarm,
            0f, 0f, 0f, 1f, 0f
        )
    )
    satMatrix.postConcat(adjustMatrix)

    val paint = android.graphics.Paint(
        android.graphics.Paint.ANTI_ALIAS_FLAG or android.graphics.Paint.FILTER_BITMAP_FLAG
    ).apply {
        colorFilter = android.graphics.ColorMatrixColorFilter(satMatrix)
    }

    val srcRect = android.graphics.Rect(cropX, cropY, cropX + cropW, cropY + cropH)
    val dstRect = android.graphics.Rect(0, 0, cropW, cropH)
    canvas.drawBitmap(transformed, srcRect, dstRect, paint)

    return outBitmap
}

/**
 * Ultra-fast (< 1.5ms) geometry-only preview bitmap generator for 120Hz interactive rotation, flip, and crop preview.
 * Color adjustments (brightness, contrast, saturation, warmth) are applied at 0.0ms on the GPU via Compose ColorFilter.
 */
fun renderGeometryPreviewBitmap(
    source: android.graphics.Bitmap,
    rotationDegrees: Int,
    flipH: Boolean,
    flipV: Boolean,
    cropRect: NormalizedAndroidCropRect = NormalizedAndroidCropRect(),
    applyCrop: Boolean = false
): android.graphics.Bitmap {
    val normRot = ((rotationDegrees % 360) + 360) % 360
    if (normRot == 0 && !flipH && !flipV && !applyCrop) {
        return source
    }
    val matrix = android.graphics.Matrix()
    if (normRot != 0) {
        matrix.postRotate(normRot.toFloat())
    }
    if (flipH || flipV) {
        matrix.postScale(if (flipH) -1f else 1f, if (flipV) -1f else 1f)
    }

    val transformed = if (normRot != 0 || flipH || flipV) {
        android.graphics.Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    } else {
        source
    }

    if (!applyCrop) {
        return transformed
    }

    val srcW = transformed.width.coerceAtLeast(1)
    val srcH = transformed.height.coerceAtLeast(1)
    val safeBox = clampAndroidCropRect(cropRect, 0.04f)
    val cropX = (safeBox.left * srcW).toInt().coerceIn(0, srcW - 1)
    val cropY = (safeBox.top * srcH).toInt().coerceIn(0, srcH - 1)
    val cropW = ((safeBox.right - safeBox.left) * srcW).toInt().coerceIn(1, srcW - cropX)
    val cropH = ((safeBox.bottom - safeBox.top) * srcH).toInt().coerceIn(1, srcH - cropY)

    return android.graphics.Bitmap.createBitmap(transformed, cropX, cropY, cropW, cropH)
}

fun buildGpuComposeColorFilter(
    brightness: Float,
    contrast: Float,
    saturation: Float,
    warmth: Float
): androidx.compose.ui.graphics.ColorFilter? {
    if (brightness == 0f && contrast == 0f && saturation == 0f && warmth == 0f) {
        return null
    }
    val satFactor = ((100f + saturation) / 100f).coerceAtLeast(0f)
    val satMatrix = android.graphics.ColorMatrix().apply {
        setSaturation(satFactor)
    }

    val cFactor = ((100f + contrast) / 100f).coerceAtLeast(0f)
    val cScale = cFactor * cFactor
    val bOffset = brightness * 1.6f + 128f * (1f - cScale)
    val rWarm = warmth * 0.45f
    val gWarm = warmth * 0.10f
    val bWarm = -warmth * 0.45f

    val adjustMatrix = android.graphics.ColorMatrix(
        floatArrayOf(
            cScale, 0f, 0f, 0f, bOffset + rWarm,
            0f, cScale, 0f, 0f, bOffset + gWarm,
            0f, 0f, cScale, 0f, bOffset + bWarm,
            0f, 0f, 0f, 1f, 0f
        )
    )
    satMatrix.postConcat(adjustMatrix)
    return androidx.compose.ui.graphics.ColorFilter.colorMatrix(
        androidx.compose.ui.graphics.ColorMatrix(satMatrix.array)
    )
}

@Composable
fun NativePhotoEditorModal(
    apiClient: PhotoCloudApiClient,
    filename: String,
    onClose: () -> Unit,
    onSaved: (String) -> Unit,
    onTransferUpdate: (TransferOperation) -> Unit
) {
    val scope = rememberCoroutineScope()
    var sourceBitmap by remember(filename) {
        mutableStateOf(
            apiClient.getCachedBitmap(filename, false)
                ?: apiClient.getRamThumbnailBitmap(filename, false)
        )
    }
    var isLoading by remember(filename) { mutableStateOf(sourceBitmap == null) }
    var isSaving by remember { mutableStateOf(false) }

    var activePreset by remember { mutableStateOf("original") }
    var brightness by remember { mutableFloatStateOf(0f) }
    var contrast by remember { mutableFloatStateOf(0f) }
    var saturation by remember { mutableFloatStateOf(0f) }
    var warmth by remember { mutableFloatStateOf(0f) }
    var rotationDegrees by remember { mutableIntStateOf(0) }
    var flipH by remember { mutableStateOf(false) }
    var flipV by remember { mutableStateOf(false) }
    var cropRatio by remember { mutableStateOf("free") }

    // Manual Draggable Crop Grid is immediately open when entering photo edit mode
    var showCropGrid by remember { mutableStateOf(true) }
    var cropRect by remember { mutableStateOf(NormalizedAndroidCropRect(0f, 0f, 1f, 1f)) }

    LaunchedEffect(filename) {
        if (apiClient.getCachedBitmap(filename, false) == null) {
            if (sourceBitmap == null) isLoading = true
            val fullBmp = apiClient.loadMediaBitmap(filename, false)
            if (fullBmp != null) {
                sourceBitmap = fullBmp
            }
            isLoading = false
        }
    }

    // Lightweight 1080px preview source bitmap created once per photo for 0ms interactive rotation & flip
    val previewSourceBitmap = remember(sourceBitmap) {
        val src = sourceBitmap ?: return@remember null
        val maxEdge = 1080
        val w = src.width.coerceAtLeast(1)
        val h = src.height.coerceAtLeast(1)
        if (w <= maxEdge && h <= maxEdge) {
            src
        } else {
            val scale = maxEdge.toFloat() / maxOf(w, h).toFloat()
            val pw = (w * scale).toInt().coerceAtLeast(1)
            val ph = (h * scale).toInt().coerceAtLeast(1)
            android.graphics.Bitmap.createScaledBitmap(src, pw, ph, true)
        }
    }

    // Stage bitmap only depends on geometry (rotation, flip, and crop when grid is hidden).
    // Dragging cropRect while showCropGrid == true or moving color sliders does NOT re-allocate stageBitmap!
    val effectiveCropKey = if (showCropGrid) NormalizedAndroidCropRect(0f, 0f, 1f, 1f) else cropRect
    val stageBitmap = remember(
        previewSourceBitmap,
        rotationDegrees,
        flipH,
        flipV,
        showCropGrid,
        effectiveCropKey
    ) {
        val previewSrc = previewSourceBitmap ?: return@remember null
        renderGeometryPreviewBitmap(
            source = previewSrc,
            rotationDegrees = rotationDegrees,
            flipH = flipH,
            flipV = flipV,
            cropRect = effectiveCropKey,
            applyCrop = !showCropGrid
        )
    }

    val stageImageBitmap = remember(stageBitmap) {
        stageBitmap?.asImageBitmap()
    }

    // GPU-accelerated ColorFilter (0.0ms on presets and sliders)
    val gpuColorFilter = remember(brightness, contrast, saturation, warmth) {
        buildGpuComposeColorFilter(brightness, contrast, saturation, warmth)
    }

    // Full-resolution output dimensions for the header resolution badge
    val fullRotatedWidthPx = remember(sourceBitmap, rotationDegrees) {
        val src = sourceBitmap ?: return@remember 0
        val normRot = ((rotationDegrees % 360) + 360) % 360
        if (normRot == 90 || normRot == 270) src.height else src.width
    }
    val fullRotatedHeightPx = remember(sourceBitmap, rotationDegrees) {
        val src = sourceBitmap ?: return@remember 0
        val normRot = ((rotationDegrees % 360) + 360) % 360
        if (normRot == 90 || normRot == 270) src.width else src.height
    }

    val croppedWidthPx = remember(fullRotatedWidthPx, cropRect) {
        if (fullRotatedWidthPx <= 0) 0
        else ((cropRect.right - cropRect.left) * fullRotatedWidthPx).toInt().coerceAtLeast(1)
    }
    val croppedHeightPx = remember(fullRotatedHeightPx, cropRect) {
        if (fullRotatedHeightPx <= 0) 0
        else ((cropRect.bottom - cropRect.top) * fullRotatedHeightPx).toInt().coerceAtLeast(1)
    }

    fun resetEdits() {
        activePreset = "original"
        brightness = 0f
        contrast = 0f
        saturation = 0f
        warmth = 0f
        rotationDegrees = 0
        flipH = false
        flipV = false
        cropRatio = "free"
        cropRect = NormalizedAndroidCropRect(0f, 0f, 1f, 1f)
        showCropGrid = true
    }

    fun saveEditedPhoto(overwrite: Boolean) {
        val src = sourceBitmap ?: return
        if (isSaving) return
        isSaving = true
        val b = brightness
        val c = contrast
        val s = saturation
        val w = warmth
        val rot = rotationDegrees
        val fh = flipH
        val fv = flipV
        val cr = cropRect
        scope.launch {
            val jpegBytes = withContext(Dispatchers.Default) {
                val finalCroppedBmp = renderEditedAndroidBitmap(
                    source = src,
                    brightness = b,
                    contrast = c,
                    saturation = s,
                    warmth = w,
                    rotationDegrees = rot,
                    flipH = fh,
                    flipV = fv,
                    cropRect = cr,
                    applyCrop = true
                )
                val outStream = java.io.ByteArrayOutputStream()
                finalCroppedBmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 94, outStream)
                outStream.toByteArray()
            }
            val (ok, msg) = apiClient.uploadEditedPhotoBytes(
                originalFilename = filename,
                editedJpegBytes = jpegBytes,
                overwrite = overwrite,
                onTransferUpdate = onTransferUpdate
            )
            isSaving = false
            if (ok) {
                onSaved(msg)
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = Color(0xFF0A0A0F)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Surface(
                        onClick = onClose,
                        shape = CircleShape,
                        color = Color.White.copy(alpha = 0.12f),
                        modifier = Modifier.size(40.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Close, contentDescription = "Chiudi", tint = Color.White)
                        }
                    }
                    Column {
                        Text(
                            text = "Modifica Foto",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                        Text(
                            text = if (croppedWidthPx > 0) "$croppedWidthPx × $croppedHeightPx px • Trascina griglia per ritagliare" else filename,
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFFA8C7FA),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                TextButton(
                    onClick = { resetEdits() },
                    enabled = !isSaving
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Reset", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }

            // Live Image Preview Stage + Interactive Draggable Manual Crop Grid Overlay
            var stageSize by remember { mutableStateOf(IntSize.Zero) }
            var activeDragHandle by remember { mutableStateOf<AndroidCropHandle?>(null) }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 16.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Color(0xFF14141C))
                    .onSizeChanged { stageSize = it },
                contentAlignment = Alignment.Center
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = Color.White)
                } else if (stageBitmap != null && stageImageBitmap != null) {
                    val bmpW = stageBitmap.width.coerceAtLeast(1)
                    val bmpH = stageBitmap.height.coerceAtLeast(1)

                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(14.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Image(
                            bitmap = stageImageBitmap,
                            contentDescription = "Anteprima Modifica",
                            contentScale = ContentScale.Fit,
                            colorFilter = gpuColorFilter,
                            modifier = Modifier.fillMaxSize()
                        )

                        if (showCropGrid) {
                            Canvas(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .pointerInput(bmpW, bmpH, cropRatio) {
                                        detectDragGestures(
                                            onDragStart = { touchOffset ->
                                                val cw = size.width.toFloat()
                                                val ch = size.height.toFloat()
                                                if (cw <= 0f || ch <= 0f) return@detectDragGestures
                                                val imgAspect = bmpW.toFloat() / bmpH.toFloat()
                                                val boxAspect = cw / ch
                                                val fitW = if (imgAspect > boxAspect) cw else ch * imgAspect
                                                val fitH = if (imgAspect > boxAspect) cw / imgAspect else ch
                                                val offX = (cw - fitW) / 2f
                                                val offY = (ch - fitH) / 2f

                                                val cLeft = offX + cropRect.left * fitW
                                                val cTop = offY + cropRect.top * fitH
                                                val cRight = offX + cropRect.right * fitW
                                                val cBottom = offY + cropRect.bottom * fitH
                                                val cMidX = (cLeft + cRight) / 2f
                                                val cMidY = (cTop + cBottom) / 2f
                                                val hitRadius = 42.dp.toPx()

                                                activeDragHandle = when {
                                                    hypot(touchOffset.x - cLeft, touchOffset.y - cTop) <= hitRadius -> AndroidCropHandle.NW
                                                    hypot(touchOffset.x - cRight, touchOffset.y - cTop) <= hitRadius -> AndroidCropHandle.NE
                                                    hypot(touchOffset.x - cRight, touchOffset.y - cBottom) <= hitRadius -> AndroidCropHandle.SE
                                                    hypot(touchOffset.x - cLeft, touchOffset.y - cBottom) <= hitRadius -> AndroidCropHandle.SW
                                                    hypot(touchOffset.x - cMidX, touchOffset.y - cTop) <= hitRadius || (abs(touchOffset.y - cTop) <= hitRadius * 0.7f && touchOffset.x in cLeft..cRight) -> AndroidCropHandle.N
                                                    hypot(touchOffset.x - cMidX, touchOffset.y - cBottom) <= hitRadius || (abs(touchOffset.y - cBottom) <= hitRadius * 0.7f && touchOffset.x in cLeft..cRight) -> AndroidCropHandle.S
                                                    hypot(touchOffset.x - cLeft, touchOffset.y - cMidY) <= hitRadius || (abs(touchOffset.x - cLeft) <= hitRadius * 0.7f && touchOffset.y in cTop..cBottom) -> AndroidCropHandle.W
                                                    hypot(touchOffset.x - cRight, touchOffset.y - cMidY) <= hitRadius || (abs(touchOffset.x - cRight) <= hitRadius * 0.7f && touchOffset.y in cTop..cBottom) -> AndroidCropHandle.E
                                                    touchOffset.x in cLeft..cRight && touchOffset.y in cTop..cBottom -> AndroidCropHandle.MOVE
                                                    else -> AndroidCropHandle.MOVE
                                                }
                                            },
                                            onDrag = { change, dragAmount ->
                                                change.consume()
                                                val handle = activeDragHandle ?: return@detectDragGestures
                                                val cw = size.width.toFloat()
                                                val ch = size.height.toFloat()
                                                if (cw <= 0f || ch <= 0f) return@detectDragGestures
                                                val imgAspect = bmpW.toFloat() / bmpH.toFloat()
                                                val boxAspect = cw / ch
                                                val fitW = (if (imgAspect > boxAspect) cw else ch * imgAspect).coerceAtLeast(1f)
                                                val fitH = (if (imgAspect > boxAspect) cw / imgAspect else ch).coerceAtLeast(1f)

                                                val dxNorm = dragAmount.x / fitW
                                                val dyNorm = dragAmount.y / fitH
                                                cropRect = dragAndroidCropRect(
                                                    start = cropRect,
                                                    handle = handle,
                                                    dxNorm = dxNorm,
                                                    dyNorm = dyNorm,
                                                    cropRatio = cropRatio,
                                                    imgW = bmpW,
                                                    imgH = bmpH
                                                )
                                            },
                                            onDragEnd = { activeDragHandle = null },
                                            onDragCancel = { activeDragHandle = null }
                                        )
                                    }
                            ) {
                                val cw = size.width
                                val ch = size.height
                                val imgAspect = bmpW.toFloat() / bmpH.toFloat()
                                val boxAspect = cw / ch
                                val fitW = if (imgAspect > boxAspect) cw else ch * imgAspect
                                val fitH = if (imgAspect > boxAspect) cw / imgAspect else ch
                                val offX = (cw - fitW) / 2f
                                val offY = (ch - fitH) / 2f

                                val cLeft = offX + cropRect.left * fitW
                                val cTop = offY + cropRect.top * fitH
                                val cRight = offX + cropRect.right * fitW
                                val cBottom = offY + cropRect.bottom * fitH
                                val cWidth = (cRight - cLeft).coerceAtLeast(1f)
                                val cHeight = (cBottom - cTop).coerceAtLeast(1f)

                                val scrimColor = Color(0xAA06070C)
                                // Top scrim
                                drawRect(color = scrimColor, topLeft = Offset(offX, offY), size = Size(fitW, (cTop - offY).coerceAtLeast(0f)))
                                // Bottom scrim
                                drawRect(color = scrimColor, topLeft = Offset(offX, cBottom), size = Size(fitW, (offY + fitH - cBottom).coerceAtLeast(0f)))
                                // Left scrim
                                drawRect(color = scrimColor, topLeft = Offset(offX, cTop), size = Size((cLeft - offX).coerceAtLeast(0f), cHeight))
                                // Right scrim
                                drawRect(color = scrimColor, topLeft = Offset(cRight, cTop), size = Size((offX + fitW - cRight).coerceAtLeast(0f), cHeight))

                                // Rule of Thirds 3x3 Grid Lines
                                val gridColor = Color.White.copy(alpha = 0.45f)
                                val thirdW = cWidth / 3f
                                val thirdH = cHeight / 3f
                                drawLine(gridColor, Offset(cLeft + thirdW, cTop), Offset(cLeft + thirdW, cBottom), strokeWidth = 1.dp.toPx())
                                drawLine(gridColor, Offset(cLeft + thirdW * 2f, cTop), Offset(cLeft + thirdW * 2f, cBottom), strokeWidth = 1.dp.toPx())
                                drawLine(gridColor, Offset(cLeft, cTop + thirdH), Offset(cRight, cTop + thirdH), strokeWidth = 1.dp.toPx())
                                drawLine(gridColor, Offset(cLeft, cTop + thirdH * 2f), Offset(cRight, cTop + thirdH * 2f), strokeWidth = 1.dp.toPx())

                                // Outer white crop border
                                drawRect(
                                    color = Color.White,
                                    topLeft = Offset(cLeft, cTop),
                                    size = Size(cWidth, cHeight),
                                    style = Stroke(width = 2.dp.toPx())
                                )

                                // 4 Corner Handles (Material You Accent #A8C7FA)
                                val handleRadius = 8.dp.toPx()
                                val accentColor = Color(0xFFA8C7FA)
                                listOf(
                                    Offset(cLeft, cTop),
                                    Offset(cRight, cTop),
                                    Offset(cRight, cBottom),
                                    Offset(cLeft, cBottom)
                                ).forEach { corner ->
                                    drawCircle(color = Color(0xFF041E49), radius = handleRadius + 2.dp.toPx(), center = corner)
                                    drawCircle(color = accentColor, radius = handleRadius, center = corner)
                                }

                                // 4 Edge Pill Handles
                                val edgeW = 24.dp.toPx()
                                val edgeThick = 6.dp.toPx()
                                val cMidX = (cLeft + cRight) / 2f
                                val cMidY = (cTop + cBottom) / 2f
                                drawRoundRect(
                                    color = Color.White,
                                    topLeft = Offset(cMidX - edgeW / 2f, cTop - edgeThick / 2f),
                                    size = Size(edgeW, edgeThick),
                                    cornerRadius = CornerRadius(edgeThick, edgeThick)
                                )
                                drawRoundRect(
                                    color = Color.White,
                                    topLeft = Offset(cMidX - edgeW / 2f, cBottom - edgeThick / 2f),
                                    size = Size(edgeW, edgeThick),
                                    cornerRadius = CornerRadius(edgeThick, edgeThick)
                                )
                                drawRoundRect(
                                    color = Color.White,
                                    topLeft = Offset(cLeft - edgeThick / 2f, cMidY - edgeW / 2f),
                                    size = Size(edgeThick, edgeW),
                                    cornerRadius = CornerRadius(edgeThick, edgeThick)
                                )
                                drawRoundRect(
                                    color = Color.White,
                                    topLeft = Offset(cRight - edgeThick / 2f, cMidY - edgeW / 2f),
                                    size = Size(edgeThick, edgeW),
                                    cornerRadius = CornerRadius(edgeThick, edgeThick)
                                )
                            }
                        }
                    }
                } else {
                    Text(
                        text = "Impossibile caricare la foto per la modifica",
                        color = Color.White.copy(alpha = 0.7f)
                    )
                }
            }

            // Scrollable Controls Sheet
            Surface(
                shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                tonalElevation = 6.dp,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 390.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // 1. Transform & Interactive Manual Crop Grid
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "RITAGLIO MANUALE TRASCINABILE & RUOTA",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                        FilterChip(
                            selected = showCropGrid,
                            onClick = { showCropGrid = !showCropGrid },
                            label = {
                                Text(
                                    if (showCropGrid) "Griglia Attiva" else "Mostra Griglia",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold
                                )
                            },
                            shape = CircleShape
                        )
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf(
                            "free" to "Libero (Manuale)",
                            "1:1" to "1:1 Quadrato",
                            "4:5" to "4:5 Ritratto",
                            "4:3" to "4:3 Foto",
                            "16:9" to "16:9 Cinema"
                        ).forEach { (ratioKey, ratioLabel) ->
                            FilterChip(
                                selected = cropRatio == ratioKey,
                                onClick = {
                                    cropRatio = ratioKey
                                    showCropGrid = true
                                    val bmp = stageBitmap
                                    if (bmp != null && ratioKey != "free") {
                                        cropRect = fitAndroidAspectCropRect(bmp.width, bmp.height, ratioKey)
                                    }
                                },
                                label = { Text(ratioLabel) },
                                shape = CircleShape
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        FilledTonalButton(
                            onClick = {
                                rotationDegrees = (rotationDegrees - 90 + 360) % 360
                                val bmp = stageBitmap
                                if (bmp != null && cropRatio != "free") {
                                    cropRect = fitAndroidAspectCropRect(bmp.height, bmp.width, cropRatio)
                                }
                            },
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 8.dp)
                        ) {
                            Text("-90°", fontWeight = FontWeight.Bold)
                        }
                        FilledTonalButton(
                            onClick = {
                                rotationDegrees = (rotationDegrees + 90) % 360
                                val bmp = stageBitmap
                                if (bmp != null && cropRatio != "free") {
                                    cropRect = fitAndroidAspectCropRect(bmp.height, bmp.width, cropRatio)
                                }
                            },
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 8.dp)
                        ) {
                            Text("+90°", fontWeight = FontWeight.Bold)
                        }
                        FilledTonalButton(
                            onClick = { flipH = !flipH },
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 8.dp)
                        ) {
                            Text("Specchia O.", fontWeight = FontWeight.Bold, maxLines = 1)
                        }
                        FilledTonalButton(
                            onClick = { flipV = !flipV },
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 8.dp)
                        ) {
                            Text("Specchia V.", fontWeight = FontWeight.Bold, maxLines = 1)
                        }
                    }

                    // 2. Filter Presets
                    Text(
                        text = "FILTRI RAPIDI",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        ANDROID_PHOTO_PRESETS.forEach { preset ->
                            FilterChip(
                                selected = activePreset == preset.id,
                                onClick = {
                                    activePreset = preset.id
                                    brightness = preset.brightness
                                    contrast = preset.contrast
                                    saturation = preset.saturation
                                    warmth = preset.warmth
                                },
                                label = { Text(preset.label, fontWeight = FontWeight.SemiBold) },
                                shape = CircleShape
                            )
                        }
                    }

                    // 3. Fine Adjustments Sliders
                    Text(
                        text = "REGOLAZIONI FINE",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )

                    EditorSliderControl(
                        label = "Luminosità",
                        value = brightness,
                        onValueChange = {
                            activePreset = "custom"
                            brightness = it
                        }
                    )
                    EditorSliderControl(
                        label = "Contrasto",
                        value = contrast,
                        onValueChange = {
                            activePreset = "custom"
                            contrast = it
                        }
                    )
                    EditorSliderControl(
                        label = "Saturazione",
                        value = saturation,
                        onValueChange = {
                            activePreset = "custom"
                            saturation = it
                        }
                    )
                    EditorSliderControl(
                        label = "Calore",
                        value = warmth,
                        onValueChange = {
                            activePreset = "custom"
                            warmth = it
                        }
                    )

                    // 4. Save Actions (Overwrite or Save Copy)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = { saveEditedPhoto(overwrite = true) },
                            enabled = !isSaving && stageBitmap != null,
                            shape = CircleShape,
                            modifier = Modifier.weight(1f).height(48.dp)
                        ) {
                            Text("Sovrascrivi", fontWeight = FontWeight.Bold)
                        }
                        Button(
                            onClick = { saveEditedPhoto(overwrite = false) },
                            enabled = !isSaving && stageBitmap != null,
                            shape = CircleShape,
                            modifier = Modifier.weight(1f).height(48.dp)
                        ) {
                            if (isSaving) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary
                                )
                            } else {
                                Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Salva Copia", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EditorSliderControl(
    label: String,
    value: Float,
    onValueChange: (Float) -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "${value.toInt()}",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }
        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = -100f..100f
        )
    }
}

/**
 * Integrated Document & Media Viewer Engine for Android (PDF with PdfRenderer zoom/scroll/page nav,
 * Word/ODT/RTF formatted paper reader, Excel/CSV multi-sheet table viewer, PowerPoint slide deck,
 * Text/Code viewer, and Audio player, plus FileProvider "Apri con..." external chooser).
 */
@Composable
fun NativeDocumentViewerModal(
    apiClient: PhotoCloudApiClient,
    item: MediaItemModel,
    fromTrash: Boolean,
    onClose: () -> Unit,
    onOpenWithExternalApp: () -> Unit,
    onDownloadToDevice: () -> Unit,
    onTransferUpdate: (TransferOperation) -> Unit
) {
    val spec = remember(item.filename) { PhotoCloudApiClient.resolveViewerSpec(item.filename) }
    var isLoading by remember(item.filename) { mutableStateOf(true) }
    var errorMessage by remember(item.filename) { mutableStateOf<String?>(null) }
    var previewModel by remember(item.filename) { mutableStateOf<DocumentPreviewModel?>(null) }
    var cachedFile by remember(item.filename) { mutableStateOf<File?>(null) }

    LaunchedEffect(item.filename, fromTrash) {
        isLoading = true
        errorMessage = null
        try {
            if (spec.viewerType == "pdf" || spec.viewerType == "audio") {
                val file = apiClient.downloadFileToCache(
                    filename = item.filename,
                    fromTrash = fromTrash,
                    onTransferUpdate = onTransferUpdate
                )
                if (file == null || !file.exists()) {
                    errorMessage = "Impossibile caricare il file per la visualizzazione."
                } else {
                    cachedFile = file
                }
            } else {
                val model = apiClient.fetchDocumentPreview(
                    filename = item.filename,
                    fromTrash = fromTrash,
                    onTransferUpdate = onTransferUpdate
                )
                if (model == null) {
                    errorMessage = "Impossibile analizzare il documento selezionato."
                } else {
                    previewModel = model
                }
            }
        } catch (e: Exception) {
            errorMessage = e.localizedMessage ?: "Errore apertura documento"
        } finally {
            isLoading = false
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            // Top Header
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                tonalElevation = 4.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        IconButton(onClick = onClose) {
                            Icon(Icons.Default.Close, contentDescription = "Chiudi")
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = item.filename,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "${spec.label} • ${if (item.size > 0L) PhotoCloudApiClient.formatBytesHuman(item.size) else spec.extension.uppercase(Locale.ROOT)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        FilledTonalButton(
                            onClick = onOpenWithExternalApp,
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text("Apri con...", style = MaterialTheme.typography.labelMedium)
                        }
                        IconButton(onClick = onDownloadToDevice) {
                            Icon(
                                imageVector = Icons.Default.Download,
                                contentDescription = "Salva in Download",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }

            // Main Stage
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                when {
                    isLoading -> {
                        Column(
                            modifier = Modifier.align(Alignment.Center),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            CircularProgressIndicator()
                            Text(
                                text = "Decrittazione e apertura documento...",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    errorMessage != null -> {
                        Column(
                            modifier = Modifier
                                .align(Alignment.Center)
                                .padding(28.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ErrorOutline,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error,
                                modifier = Modifier.size(48.dp)
                            )
                            Text(
                                text = errorMessage ?: "Impossibile visualizzare il file",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                textAlign = TextAlign.Center
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                OutlinedButton(onClick = onOpenWithExternalApp) {
                                    Text("Apri con app esterna")
                                }
                                Button(onClick = onDownloadToDevice) {
                                    Text("Scarica file")
                                }
                            }
                        }
                    }
                    spec.viewerType == "pdf" && cachedFile != null -> {
                        NativePdfRendererView(
                            pdfFile = cachedFile!!,
                            onOpenExternal = onOpenWithExternalApp
                        )
                    }
                    spec.viewerType == "audio" && cachedFile != null -> {
                        NativeAudioPlayerView(
                            audioFile = cachedFile!!,
                            filename = item.filename
                        )
                    }
                    spec.viewerType == "word" && previewModel != null -> {
                        NativeWordDocumentView(model = previewModel!!)
                    }
                    spec.viewerType == "spreadsheet" && previewModel != null -> {
                        NativeSpreadsheetDocumentView(model = previewModel!!)
                    }
                    spec.viewerType == "presentation" && previewModel != null -> {
                        NativePresentationDocumentView(model = previewModel!!)
                    }
                    previewModel != null -> {
                        NativeTextCodeDocumentView(model = previewModel!!)
                    }
                }
            }
        }
    }
}

@Composable
private fun NativePdfRendererView(
    pdfFile: File,
    onOpenExternal: () -> Unit
) {
    var pageCount by remember(pdfFile) { mutableStateOf(0) }
    var currentPage by remember(pdfFile) { mutableStateOf(0) }
    var zoomScale by remember { mutableStateOf(1f) }
    var pageBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var renderError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(pdfFile, currentPage, zoomScale) {
        withContext(Dispatchers.IO) {
            try {
                ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY)?.use { pfd ->
                    PdfRenderer(pfd).use { renderer ->
                        val count = renderer.pageCount.coerceAtLeast(1)
                        pageCount = count
                        val safePageIdx = currentPage.coerceIn(0, count - 1)
                        renderer.openPage(safePageIdx).use { page ->
                            val densityFactor = (2.0f * zoomScale).coerceIn(1.5f, 4.0f)
                            val bmpW = (page.width * densityFactor).toInt().coerceIn(400, 2800)
                            val bmpH = (page.height * densityFactor).toInt().coerceIn(400, 3800)
                            val bmp = Bitmap.createBitmap(bmpW, bmpH, Bitmap.Config.ARGB_8888)
                            bmp.eraseColor(android.graphics.Color.WHITE)
                            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            pageBitmap = bmp
                        }
                    }
                }
            } catch (e: Exception) {
                renderError = e.localizedMessage ?: "Impossibile decodificare il PDF"
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // PDF Toolbar (Page Navigation + Zoom Controls)
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    FilledTonalButton(
                        onClick = { if (currentPage > 0) currentPage-- },
                        enabled = currentPage > 0,
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text("◀ Prec")
                    }
                    Text(
                        text = "Pag. ${currentPage + 1} / ${pageCount.coerceAtLeast(1)}",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold
                    )
                    FilledTonalButton(
                        onClick = { if (currentPage < pageCount - 1) currentPage++ },
                        enabled = currentPage < pageCount - 1,
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text("Succ ▶")
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    IconButton(
                        onClick = { zoomScale = (zoomScale - 0.25f).coerceAtLeast(0.75f) },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(Icons.Default.ZoomOut, contentDescription = "Zoom -")
                    }
                    Text(
                        text = "${(zoomScale * 100).toInt()}%",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(
                        onClick = { zoomScale = (zoomScale + 0.25f).coerceAtMost(3.0f) },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(Icons.Default.ZoomIn, contentDescription = "Zoom +")
                    }
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF14161D))
                .verticalScroll(rememberScrollState())
                .horizontalScroll(rememberScrollState())
                .padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            if (renderError != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = renderError ?: "Errore PDF",
                        color = Color.White,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = onOpenExternal) {
                        Text("Apri con lettore PDF esterno")
                    }
                }
            } else {
                val bmp = pageBitmap
                if (bmp != null) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "Pagina PDF ${currentPage + 1}",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .width((360 * zoomScale).dp)
                            .clip(RoundedCornerShape(8.dp))
                    )
                } else {
                    CircularProgressIndicator(color = Color.White)
                }
            }
        }
    }
}

@Composable
private fun NativeWordDocumentView(model: DocumentPreviewModel) {
    var searchQuery by remember { mutableStateOf("") }
    var fontScale by remember { mutableStateOf(1f) }

    val filteredBlocks = remember(model.blocks, searchQuery) {
        if (searchQuery.isBlank()) model.blocks
        else model.blocks.filter { it.text.contains(searchQuery.trim(), ignoreCase = true) }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Cerca nel documento...") },
                    singleLine = true,
                    shape = CircleShape,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = { fontScale = (fontScale - 0.1f).coerceAtLeast(0.8f) }) {
                    Icon(Icons.Default.ZoomOut, contentDescription = "Riduci testo")
                }
                IconButton(onClick = { fontScale = (fontScale + 0.1f).coerceAtMost(1.6f) }) {
                    Icon(Icons.Default.ZoomIn, contentDescription = "Ingrandisci testo")
                }
            }
        }

        LazyColumn(
            contentPadding = PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            items(filteredBlocks) { block ->
                when (block.type) {
                    "heading" -> {
                        Text(
                            text = block.text,
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontSize = (18 * fontScale).sp,
                                fontWeight = FontWeight.Bold
                            ),
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    "list-item" -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("•", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                            Text(
                                text = block.text,
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = (15 * fontScale).sp)
                            )
                        }
                    }
                    else -> {
                        Text(
                            text = block.text,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = (15 * fontScale).sp,
                                lineHeight = (22 * fontScale).sp
                            ),
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeSpreadsheetDocumentView(model: DocumentPreviewModel) {
    var activeSheetIndex by remember { mutableStateOf(0) }
    var filterQuery by remember { mutableStateOf("") }

    val sheets = model.sheets
    val currentSheet = sheets.getOrNull(activeSheetIndex.coerceIn(0, (sheets.size - 1).coerceAtLeast(0)))

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (sheets.size > 1) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        sheets.forEachIndexed { idx, s ->
                            FilterChip(
                                selected = idx == activeSheetIndex,
                                onClick = { activeSheetIndex = idx },
                                label = { Text("${s.name} (${s.totalRows})") }
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                }
                OutlinedTextField(
                    value = filterQuery,
                    onValueChange = { filterQuery = it },
                    placeholder = { Text("Filtra righe del foglio...") },
                    singleLine = true,
                    shape = CircleShape,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        if (currentSheet == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Nessun dato tabellare trovato")
            }
        } else {
            val filteredRows = remember(currentSheet, filterQuery) {
                if (filterQuery.isBlank()) currentSheet.rows
                else currentSheet.rows.filter { row ->
                    row.any { it.contains(filterQuery.trim(), ignoreCase = true) }
                }
            }

            LazyColumn(
                contentPadding = PaddingValues(12.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .horizontalScroll(rememberScrollState())
            ) {
                item {
                    Row(
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                            .padding(vertical = 8.dp)
                    ) {
                        Text(
                            text = "#",
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.width(48.dp).padding(horizontal = 6.dp)
                        )
                        currentSheet.headers.forEach { h ->
                            Text(
                                text = h,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.width(140.dp).padding(horizontal = 8.dp)
                            )
                        }
                    }
                    HorizontalDivider()
                }

                items(filteredRows.size) { rIdx ->
                    val row = filteredRows[rIdx]
                    Row(
                        modifier = Modifier
                            .padding(vertical = 6.dp)
                    ) {
                        Text(
                            text = "${rIdx + 1}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.width(48.dp).padding(horizontal = 6.dp)
                        )
                        currentSheet.headers.indices.forEach { cIdx ->
                            Text(
                                text = row.getOrNull(cIdx) ?: "",
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.width(140.dp).padding(horizontal = 8.dp)
                            )
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                }
            }
        }
    }
}

@Composable
private fun NativePresentationDocumentView(model: DocumentPreviewModel) {
    val slides = model.slides
    var currentSlideIdx by remember { mutableStateOf(0) }
    val slide = slides.getOrNull(currentSlideIdx.coerceIn(0, (slides.size - 1).coerceAtLeast(0)))

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                FilledTonalButton(
                    onClick = { if (currentSlideIdx > 0) currentSlideIdx-- },
                    enabled = currentSlideIdx > 0
                ) {
                    Text("◀ Slide Prec.")
                }
                Text(
                    text = "Slide ${currentSlideIdx + 1} / ${slides.size.coerceAtLeast(1)}",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
                FilledTonalButton(
                    onClick = { if (currentSlideIdx < slides.size - 1) currentSlideIdx++ },
                    enabled = currentSlideIdx < slides.size - 1
                ) {
                    Text("Slide Succ. ▶")
                }
            }
        }

        if (slide != null) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    tonalElevation = 6.dp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 280.dp)
                ) {
                    Column(modifier = Modifier.padding(24.dp)) {
                        Text(
                            text = "SLIDE ${slide.index}",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = slide.title,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.height(16.dp))
                        slide.bullets.forEach { b ->
                            Row(
                                modifier = Modifier.padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text("•", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                Text(text = b, style = MaterialTheme.typography.bodyLarge)
                            }
                        }
                    }
                }

                if (slide.notes.isNotBlank()) {
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "Note del relatore",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = slide.notes,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeTextCodeDocumentView(model: DocumentPreviewModel) {
    val lines = remember(model.rawText, model.blocks) {
        val raw = model.rawText.ifBlank { model.blocks.joinToString("\n") { it.text } }
        raw.lines()
    }
    var searchQuery by remember { mutableStateOf("") }
    val filteredLines = remember(lines, searchQuery) {
        if (searchQuery.isBlank()) lines.mapIndexed { idx, s -> (idx + 1) to s }
        else lines.mapIndexedNotNull { idx, s ->
            if (s.contains(searchQuery.trim(), ignoreCase = true)) (idx + 1) to s else null
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth()
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = { Text("Filtra righe (${lines.size} totali)...") },
                singleLine = true,
                shape = CircleShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            )
        }

        LazyColumn(
            contentPadding = PaddingValues(12.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            items(filteredLines.size) { i ->
                val (lineNum, text) = filteredLines[i]
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "$lineNum",
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.width(42.dp),
                        textAlign = TextAlign.End
                    )
                    Text(
                        text = text,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }
    }
}

@Composable
private fun NativeAudioPlayerView(
    audioFile: File,
    filename: String
) {
    var isPlaying by remember { mutableStateOf(false) }
    var playerError by remember { mutableStateOf<String?>(null) }

    val mediaPlayer = remember(audioFile) {
        try {
            MediaPlayer().apply {
                setDataSource(audioFile.absolutePath)
                prepare()
                setOnCompletionListener { isPlaying = false }
            }
        } catch (e: Exception) {
            playerError = e.localizedMessage
            null
        }
    }

    DisposableEffect(mediaPlayer) {
        onDispose {
            try {
                mediaPlayer?.stop()
            } catch (_: Exception) {
            }
            try {
                mediaPlayer?.release()
            } catch (_: Exception) {
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            tonalElevation = 6.dp,
            modifier = Modifier.fillMaxWidth().widthIn(max = 400.dp)
        ) {
            Column(
                modifier = Modifier.padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.size(72.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.AudioFile,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(36.dp)
                        )
                    }
                }
                Text(
                    text = filename,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
                if (playerError != null) {
                    Text(
                        text = playerError ?: "Formato audio non supportato",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                } else {
                    Button(
                        onClick = {
                            val mp = mediaPlayer ?: return@Button
                            if (mp.isPlaying) {
                                mp.pause()
                                isPlaying = false
                            } else {
                                mp.start()
                                isPlaying = true
                            }
                        },
                        shape = CircleShape,
                        modifier = Modifier.height(48.dp)
                    ) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = null
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(if (isPlaying) "Pausa" else "Riproduci Audio", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}



