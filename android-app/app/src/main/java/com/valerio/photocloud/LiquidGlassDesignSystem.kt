package com.valerio.photocloud

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * PhotoCloud Dual-Theme & Liquid Glass Optical Design System for Android (Jetpack Compose)
 * Modeled on Kyant0/AndroidLiquidGlass (`io.github.kyant0:backdrop`):
 * - Theme 1 (`DesignThemeMode.ORIGINAL`): 100% original Material You 120Hz theme untouched.
 * - Theme 2 (`DesignThemeMode.LIQUID_GLASS`): Optical refractive glass surfaces, multi-orb
 *   backdrop canvas, specular rim highlights, luminous borders, and real-time customization studio.
 */
enum class DesignThemeMode(val id: String, val label: String) {
    ORIGINAL("original", "Tema 1 — Originale"),
    LIQUID_GLASS("liquid_glass", "Tema 2 — Liquid Glass")
}

enum class NavBarGlassStyle(val id: String, val label: String) {
    CAPSULE("capsule", "Capsula (Capsule)"),
    FLOATING("floating", "Sospesa (Floating)"),
    CRYSTAL("crystal", "Cristallo (Crystal)")
}

enum class CardGlassStyle(val id: String, val label: String) {
    ELEVATED("elevated", "Elevato (Elevated)"),
    FROSTED("frosted", "Satinato (Frosted)"),
    PRISM("prism", "Prisma (Prism)")
}

@Immutable
data class LiquidGlassConfig(
    // General Appearance (Aspetto generale)
    val glassIntensity: Int = 78,          // 0..100
    val transparency: Int = 68,            // 0..100
    val opacity: Int = 32,                 // 0..100
    val blurRadius: Int = 28,              // 0..60 dp
    val backdropSaturation: Int = 185,     // 50..250 %
    val brightness: Int = 106,             // 50..150 %
    val contrast: Int = 108,               // 50..150 %
    val visualDepth: Int = 75,             // 0..100

    // Colors (Colori & tonalità vetro)
    val primaryColorHex: String = "#38BDF8",
    val secondaryColorHex: String = "#818CF8",
    val glassColorHex: String = "#E0F2FE",
    val surfaceToneColorHex: String = "#0B132B",
    val borderColorHex: String = "#BAE6FD",
    val iconColorHex: String = "#E0F2FE",
    val textColorHex: String = "#F8FAFC",
    val accentColorHex: String = "#00F5D4",
    val useCustomColors: Boolean = false,

    // Visual Effects (Effetti visivi & rifrazione)
    val specularHighlights: Boolean = true,
    val highlightIntensity: Int = 80,      // 0..100
    val luminousBorders: Boolean = true,
    val borderGlowIntensity: Int = 72,     // 0..100
    val surfaceGradient: Boolean = true,
    val gradientAngle: Int = 135,          // 0..360 deg
    val shadowsEnabled: Boolean = true,
    val shadowIntensity: Int = 70,         // 0..100
    val depthEffect: Boolean = true,
    val refractionIntensity: Int = 65,     // 0..100
    val animationsEnabled: Boolean = true,
    val animationIntensity: Int = 80,      // 0..100

    // Components (Componenti & geometria)
    val componentCornerRadius: Int = 24,   // 8..40 dp
    val navBarGlassStyle: NavBarGlassStyle = NavBarGlassStyle.CAPSULE,
    val cardGlassStyle: CardGlassStyle = CardGlassStyle.ELEVATED
) {
    val primaryColor: Color get() = parseHexColor(primaryColorHex, Color(0xFF38BDF8))
    val secondaryColor: Color get() = parseHexColor(secondaryColorHex, Color(0xFF818CF8))
    val glassColor: Color get() = parseHexColor(glassColorHex, Color(0xFFE0F2FE))
    val surfaceToneColor: Color get() = parseHexColor(surfaceToneColorHex, Color(0xFF0B132B))
    val borderColor: Color get() = parseHexColor(borderColorHex, Color(0xFFBAE6FD))
    val iconColor: Color get() = parseHexColor(iconColorHex, Color(0xFFE0F2FE))
    val textColor: Color get() = parseHexColor(textColorHex, Color(0xFFF8FAFC))
    val accentColor: Color get() = parseHexColor(accentColorHex, Color(0xFF00F5D4))
}

@Immutable
data class LiquidGlassPreset(
    val id: String,
    val name: String,
    val subtitle: String,
    val config: LiquidGlassConfig
)

val LocalLiquidGlassActive = compositionLocalOf { false }
val LocalLiquidGlassConfig = compositionLocalOf { LiquidGlassConfig() }

fun sanitizeHexString(raw: String?, fallback: String): String {
    if (raw.isNullOrBlank()) return fallback
    val cleaned = raw.trim().uppercase()
    if (Regex("^#[0-9A-F]{6}$").matches(cleaned)) return cleaned
    if (Regex("^#[0-9A-F]{3}$").matches(cleaned)) {
        val r = cleaned[1]
        val g = cleaned[2]
        val b = cleaned[3]
        return "#$r$r$g$g$b$b"
    }
    return fallback
}

fun parseHexColor(hex: String, fallback: Color): Color {
    return try {
        val clean = sanitizeHexString(hex, "").removePrefix("#")
        if (clean.length != 6) return fallback
        val rgb = clean.toLong(16)
        Color(0xFF000000L or rgb)
    } catch (_: Exception) {
        fallback
    }
}

object LiquidGlassPresets {
    val builtIn: List<LiquidGlassPreset> = listOf(
        LiquidGlassPreset(
            id = "arctic_crystal",
            name = "Cristallo Artico",
            subtitle = "Rifrazione pura ciano-ghiaccio AndroidLiquidGlass",
            config = LiquidGlassConfig()
        ),
        LiquidGlassPreset(
            id = "liquid_amethyst",
            name = "Ametista Liquida",
            subtitle = "Vetro profondo viola-indaco con riflessi speculari",
            config = LiquidGlassConfig(
                glassIntensity = 84,
                transparency = 64,
                opacity = 36,
                blurRadius = 32,
                backdropSaturation = 195,
                brightness = 108,
                contrast = 112,
                visualDepth = 82,
                primaryColorHex = "#C084FC",
                secondaryColorHex = "#818CF8",
                glassColorHex = "#F3E8FF",
                surfaceToneColorHex = "#130924",
                borderColorHex = "#E9D5FF",
                iconColorHex = "#F3E8FF",
                textColorHex = "#FAF5FF",
                accentColorHex = "#F472B6",
                highlightIntensity = 88,
                borderGlowIntensity = 80,
                refractionIntensity = 74,
                cardGlassStyle = CardGlassStyle.PRISM
            )
        ),
        LiquidGlassPreset(
            id = "emerald_abyss",
            name = "Smeraldo Abissale",
            subtitle = "Superfici stratificate acquamarina ad alta saturazione",
            config = LiquidGlassConfig(
                glassIntensity = 80,
                transparency = 66,
                opacity = 34,
                blurRadius = 30,
                backdropSaturation = 200,
                brightness = 105,
                contrast = 110,
                visualDepth = 78,
                primaryColorHex = "#34D399",
                secondaryColorHex = "#2DD4BF",
                glassColorHex = "#D1FAE5",
                surfaceToneColorHex = "#061A17",
                borderColorHex = "#A7F3D0",
                iconColorHex = "#ECFDF5",
                textColorHex = "#F0FDF4",
                accentColorHex = "#10B981",
                highlightIntensity = 82,
                borderGlowIntensity = 76,
                refractionIntensity = 68,
                navBarGlassStyle = NavBarGlassStyle.FLOATING,
                cardGlassStyle = CardGlassStyle.ELEVATED
            )
        ),
        LiquidGlassPreset(
            id = "rose_quartz",
            name = "Quarzo Rosa",
            subtitle = "Luce soffusa corallo-pesca con bordi luminosi satinati",
            config = LiquidGlassConfig(
                glassIntensity = 76,
                transparency = 70,
                opacity = 30,
                blurRadius = 26,
                backdropSaturation = 175,
                brightness = 110,
                contrast = 105,
                visualDepth = 70,
                primaryColorHex = "#FB7185",
                secondaryColorHex = "#F472B6",
                glassColorHex = "#FFE4E6",
                surfaceToneColorHex = "#1F0B16",
                borderColorHex = "#FECDD3",
                iconColorHex = "#FFF1F2",
                textColorHex = "#FFF1F2",
                accentColorHex = "#FDA4AF",
                highlightIntensity = 85,
                borderGlowIntensity = 75,
                refractionIntensity = 60,
                cardGlassStyle = CardGlassStyle.FROSTED
            )
        ),
        LiquidGlassPreset(
            id = "obsidian_mirror",
            name = "Ossidiana Speculare",
            subtitle = "Vetro fumé scuro ad alto contrasto con rifrazione nitida",
            config = LiquidGlassConfig(
                glassIntensity = 88,
                transparency = 54,
                opacity = 46,
                blurRadius = 36,
                backdropSaturation = 160,
                brightness = 98,
                contrast = 118,
                visualDepth = 90,
                primaryColorHex = "#94A3B8",
                secondaryColorHex = "#64748B",
                glassColorHex = "#E2E8F0",
                surfaceToneColorHex = "#05070E",
                borderColorHex = "#CBD5E1",
                iconColorHex = "#F1F5F9",
                textColorHex = "#F8FAFC",
                accentColorHex = "#38BDF8",
                highlightIntensity = 92,
                borderGlowIntensity = 84,
                refractionIntensity = 80,
                navBarGlassStyle = NavBarGlassStyle.CRYSTAL,
                cardGlassStyle = CardGlassStyle.PRISM
            )
        ),
        LiquidGlassPreset(
            id = "solar_amber",
            name = "Ambra Rifrattiva",
            subtitle = "Calore dorato con rifrazione prismatica e profondità calda",
            config = LiquidGlassConfig(
                glassIntensity = 82,
                transparency = 65,
                opacity = 35,
                blurRadius = 28,
                backdropSaturation = 190,
                brightness = 109,
                contrast = 109,
                visualDepth = 76,
                primaryColorHex = "#FBBF24",
                secondaryColorHex = "#FB923C",
                glassColorHex = "#FEF3C7",
                surfaceToneColorHex = "#1C1206",
                borderColorHex = "#FDE68A",
                iconColorHex = "#FFFBEB",
                textColorHex = "#FFFBEB",
                accentColorHex = "#F59E0B",
                highlightIntensity = 84,
                borderGlowIntensity = 78,
                refractionIntensity = 70,
                cardGlassStyle = CardGlassStyle.ELEVATED
            )
        )
    )
}

object LiquidGlassConfigStore {
    private const val KEY_DESIGN_THEME = "design_theme_mode"
    private const val KEY_LG_CONFIG_JSON = "liquid_glass_config_json"
    private const val KEY_LG_SAVED_PRESETS = "liquid_glass_saved_presets_json"

    fun loadDesignTheme(prefs: SharedPreferences): DesignThemeMode {
        val raw = prefs.getString(KEY_DESIGN_THEME, DesignThemeMode.ORIGINAL.id)
        return DesignThemeMode.entries.find { it.id == raw } ?: DesignThemeMode.ORIGINAL
    }

    fun saveDesignTheme(prefs: SharedPreferences, mode: DesignThemeMode) {
        prefs.edit().putString(KEY_DESIGN_THEME, mode.id).apply()
    }

    fun loadConfig(prefs: SharedPreferences): LiquidGlassConfig {
        val raw = prefs.getString(KEY_LG_CONFIG_JSON, null) ?: return LiquidGlassConfig()
        return importFromJson(raw) ?: LiquidGlassConfig()
    }

    fun saveConfig(prefs: SharedPreferences, config: LiquidGlassConfig) {
        prefs.edit().putString(KEY_LG_CONFIG_JSON, toJsonObject(config).toString()).apply()
    }

    fun loadSavedPresets(prefs: SharedPreferences): List<LiquidGlassPreset> {
        val raw = prefs.getString(KEY_LG_SAVED_PRESETS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val result = ArrayList<LiquidGlassPreset>(arr.length())
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val id = obj.optString("id", "custom_$i")
                val name = obj.optString("name", "Preset Utente")
                val subtitle = obj.optString("subtitle", "Configurazione salvata")
                val cfgObj = obj.optJSONObject("config") ?: continue
                result.add(
                    LiquidGlassPreset(
                        id = id,
                        name = name,
                        subtitle = subtitle,
                        config = fromJsonObject(cfgObj)
                    )
                )
            }
            result
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveCustomPreset(
        prefs: SharedPreferences,
        name: String,
        config: LiquidGlassConfig
    ): List<LiquidGlassPreset> {
        val existing = loadSavedPresets(prefs).toMutableList()
        val cleanName = name.trim().ifBlank { "Mio Liquid Glass" }.take(36)
        val preset = LiquidGlassPreset(
            id = "custom_${System.currentTimeMillis()}",
            name = cleanName,
            subtitle = "Configurazione salvata dall'utente",
            config = config
        )
        existing.add(0, preset)
        val trimmed = existing.take(12)
        val arr = JSONArray()
        trimmed.forEach { p ->
            val obj = JSONObject()
            obj.put("id", p.id)
            obj.put("name", p.name)
            obj.put("subtitle", p.subtitle)
            obj.put("config", toJsonObject(p.config))
            arr.put(obj)
        }
        prefs.edit().putString(KEY_LG_SAVED_PRESETS, arr.toString()).apply()
        return trimmed
    }

    fun toJsonObject(c: LiquidGlassConfig): JSONObject {
        return JSONObject().apply {
            put("glassIntensity", c.glassIntensity.coerceIn(0, 100))
            put("transparency", c.transparency.coerceIn(0, 100))
            put("opacity", c.opacity.coerceIn(0, 100))
            put("blurRadius", c.blurRadius.coerceIn(0, 60))
            put("backdropSaturation", c.backdropSaturation.coerceIn(50, 250))
            put("brightness", c.brightness.coerceIn(50, 150))
            put("contrast", c.contrast.coerceIn(50, 150))
            put("visualDepth", c.visualDepth.coerceIn(0, 100))

            put("primaryColor", sanitizeHexString(c.primaryColorHex, "#38BDF8"))
            put("secondaryColor", sanitizeHexString(c.secondaryColorHex, "#818CF8"))
            put("glassColor", sanitizeHexString(c.glassColorHex, "#E0F2FE"))
            put("surfaceToneColor", sanitizeHexString(c.surfaceToneColorHex, "#0B132B"))
            put("borderColor", sanitizeHexString(c.borderColorHex, "#BAE6FD"))
            put("iconColor", sanitizeHexString(c.iconColorHex, "#E0F2FE"))
            put("textColor", sanitizeHexString(c.textColorHex, "#F8FAFC"))
            put("accentColor", sanitizeHexString(c.accentColorHex, "#00F5D4"))
            put("useCustomColors", c.useCustomColors)

            put("specularHighlights", c.specularHighlights)
            put("highlightIntensity", c.highlightIntensity.coerceIn(0, 100))
            put("luminousBorders", c.luminousBorders)
            put("borderGlowIntensity", c.borderGlowIntensity.coerceIn(0, 100))
            put("surfaceGradient", c.surfaceGradient)
            put("gradientAngle", c.gradientAngle.coerceIn(0, 360))
            put("shadowsEnabled", c.shadowsEnabled)
            put("shadowIntensity", c.shadowIntensity.coerceIn(0, 100))
            put("depthEffect", c.depthEffect)
            put("refractionIntensity", c.refractionIntensity.coerceIn(0, 100))
            put("animationsEnabled", c.animationsEnabled)
            put("animationIntensity", c.animationIntensity.coerceIn(0, 100))

            put("componentCornerRadius", c.componentCornerRadius.coerceIn(8, 40))
            put("navBarGlassStyle", c.navBarGlassStyle.id)
            put("cardGlassStyle", c.cardGlassStyle.id)
        }
    }

    fun fromJsonObject(obj: JSONObject): LiquidGlassConfig {
        val d = LiquidGlassConfig()
        val transparency = obj.optInt("transparency", d.transparency).coerceIn(0, 100)
        val opacity = if (obj.has("opacity")) {
            obj.optInt("opacity", d.opacity).coerceIn(0, 100)
        } else {
            (100 - transparency).coerceIn(0, 100)
        }
        val navId = obj.optString("navBarGlassStyle", d.navBarGlassStyle.id)
        val cardId = obj.optString("cardGlassStyle", d.cardGlassStyle.id)

        return LiquidGlassConfig(
            glassIntensity = obj.optInt("glassIntensity", d.glassIntensity).coerceIn(0, 100),
            transparency = transparency,
            opacity = opacity,
            blurRadius = obj.optInt("blurRadius", d.blurRadius).coerceIn(0, 60),
            backdropSaturation = obj.optInt("backdropSaturation", d.backdropSaturation).coerceIn(50, 250),
            brightness = obj.optInt("brightness", d.brightness).coerceIn(50, 150),
            contrast = obj.optInt("contrast", d.contrast).coerceIn(50, 150),
            visualDepth = obj.optInt("visualDepth", d.visualDepth).coerceIn(0, 100),

            primaryColorHex = sanitizeHexString(obj.optString("primaryColor", d.primaryColorHex), d.primaryColorHex),
            secondaryColorHex = sanitizeHexString(obj.optString("secondaryColor", d.secondaryColorHex), d.secondaryColorHex),
            glassColorHex = sanitizeHexString(obj.optString("glassColor", d.glassColorHex), d.glassColorHex),
            surfaceToneColorHex = sanitizeHexString(obj.optString("surfaceToneColor", d.surfaceToneColorHex), d.surfaceToneColorHex),
            borderColorHex = sanitizeHexString(obj.optString("borderColor", d.borderColorHex), d.borderColorHex),
            iconColorHex = sanitizeHexString(obj.optString("iconColor", d.iconColorHex), d.iconColorHex),
            textColorHex = sanitizeHexString(obj.optString("textColor", d.textColorHex), d.textColorHex),
            accentColorHex = sanitizeHexString(obj.optString("accentColor", d.accentColorHex), d.accentColorHex),
            useCustomColors = obj.optBoolean("useCustomColors", d.useCustomColors),

            specularHighlights = obj.optBoolean("specularHighlights", d.specularHighlights),
            highlightIntensity = obj.optInt("highlightIntensity", d.highlightIntensity).coerceIn(0, 100),
            luminousBorders = obj.optBoolean("luminousBorders", d.luminousBorders),
            borderGlowIntensity = obj.optInt("borderGlowIntensity", d.borderGlowIntensity).coerceIn(0, 100),
            surfaceGradient = obj.optBoolean("surfaceGradient", d.surfaceGradient),
            gradientAngle = obj.optInt("gradientAngle", d.gradientAngle).coerceIn(0, 360),
            shadowsEnabled = obj.optBoolean("shadowsEnabled", d.shadowsEnabled),
            shadowIntensity = obj.optInt("shadowIntensity", d.shadowIntensity).coerceIn(0, 100),
            depthEffect = obj.optBoolean("depthEffect", d.depthEffect),
            refractionIntensity = obj.optInt("refractionIntensity", d.refractionIntensity).coerceIn(0, 100),
            animationsEnabled = obj.optBoolean("animationsEnabled", d.animationsEnabled),
            animationIntensity = obj.optInt("animationIntensity", d.animationIntensity).coerceIn(0, 100),

            componentCornerRadius = obj.optInt("componentCornerRadius", d.componentCornerRadius).coerceIn(8, 40),
            navBarGlassStyle = NavBarGlassStyle.entries.find { it.id == navId } ?: d.navBarGlassStyle,
            cardGlassStyle = CardGlassStyle.entries.find { it.id == cardId } ?: d.cardGlassStyle
        )
    }

    fun exportToJson(config: LiquidGlassConfig): String {
        val root = JSONObject()
        root.put("schema", "photocloud.liquid_glass.v1")
        root.put("config", toJsonObject(config))
        return root.toString(2)
    }

    fun importFromJson(jsonText: String): LiquidGlassConfig? {
        return try {
            val parsed = JSONObject(jsonText.trim())
            val cfgObj = parsed.optJSONObject("config") ?: parsed
            fromJsonObject(cfgObj)
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * Full-screen multi-orb optical backdrop canvas rendered when `DesignThemeMode.LIQUID_GLASS` is active.
 */
@Composable
fun LiquidGlassBackdropCanvas(
    config: LiquidGlassConfig,
    isDarkTheme: Boolean,
    modifier: Modifier = Modifier
) {
    val primary = config.primaryColor
    val secondary = config.secondaryColor
    val accent = config.accentColor
    val surfaceTone = if (isDarkTheme || config.useCustomColors) {
        config.surfaceToneColor
    } else {
        Color(0xFFEBF4FF)
    }
    val saturationBoost = (config.backdropSaturation / 185f).coerceIn(0.5f, 1.5f)
    val orbAlpha = (0.24f * saturationBoost * (config.glassIntensity / 100f)).coerceIn(0.08f, 0.48f)

    Canvas(modifier = modifier.fillMaxSize()) {
        drawRect(color = surfaceTone)

        val w = size.width
        val h = size.height
        if (w <= 0f || h <= 0f) return@Canvas

        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(primary.copy(alpha = orbAlpha), Color.Transparent),
                center = Offset(w * 0.16f, h * 0.18f),
                radius = w * 0.65f
            ),
            center = Offset(w * 0.16f, h * 0.18f),
            radius = w * 0.65f
        )

        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(secondary.copy(alpha = orbAlpha * 0.92f), Color.Transparent),
                center = Offset(w * 0.85f, h * 0.26f),
                radius = w * 0.62f
            ),
            center = Offset(w * 0.85f, h * 0.26f),
            radius = w * 0.62f
        )

        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(accent.copy(alpha = orbAlpha * 0.78f), Color.Transparent),
                center = Offset(w * 0.52f, h * 0.82f),
                radius = w * 0.7f
            ),
            center = Offset(w * 0.52f, h * 0.82f),
            radius = w * 0.7f
        )
    }
}

/**
 * Custom Compose optical surface modifier implementing Kyant0/AndroidLiquidGlass
 * multi-angle specular highlights, SDF lens rim refraction, and directional glass fill.
 */
fun Modifier.liquidGlassSurface(
    config: LiquidGlassConfig,
    isActive: Boolean,
    cornerRadiusDp: Float = config.componentCornerRadius.toFloat(),
    isElevated: Boolean = false
): Modifier {
    if (!isActive) return this

    return this.drawWithCache {
        val cornerPx = cornerRadiusDp.dp.toPx()
        val intensity = (config.glassIntensity / 100f).coerceIn(0f, 1f)
        val baseAlpha = ((config.opacity / 100f) * (0.52f + intensity * 0.44f)).coerceIn(0.08f, 0.88f)
        val fillAlpha = if (isElevated) (baseAlpha + 0.12f).coerceAtMost(0.92f) else baseAlpha
        val highlightAlpha = if (config.specularHighlights) {
            ((config.highlightIntensity / 100f) * 0.54f).coerceIn(0f, 0.85f)
        } else 0f
        val borderAlpha = if (config.luminousBorders) {
            ((config.borderGlowIntensity / 100f) * 0.66f).coerceIn(0.12f, 0.92f)
        } else 0.16f
        val refractionAlpha = ((config.refractionIntensity / 100f) * 0.36f * intensity).coerceIn(0f, 0.6f)

        val rad = Math.toRadians(config.gradientAngle.toDouble())
        val cosA = cos(rad).toFloat()
        val sinA = sin(rad).toFloat()
        val start = Offset(
            x = size.width * (0.5f - 0.5f * cosA),
            y = size.height * (0.5f - 0.5f * sinA)
        )
        val end = Offset(
            x = size.width * (0.5f + 0.5f * cosA),
            y = size.height * (0.5f + 0.5f * sinA)
        )

        val surfaceBrush = if (config.surfaceGradient) {
            Brush.linearGradient(
                colors = listOf(
                    config.glassColor.copy(alpha = (fillAlpha + highlightAlpha * 0.32f).coerceAtMost(0.92f)),
                    config.surfaceToneColor.copy(alpha = fillAlpha),
                    config.primaryColor.copy(alpha = (fillAlpha * 0.58f).coerceAtMost(0.85f))
                ),
                start = start,
                end = end
            )
        } else {
            Brush.linearGradient(
                colors = listOf(
                    config.surfaceToneColor.copy(alpha = fillAlpha),
                    config.surfaceToneColor.copy(alpha = fillAlpha)
                )
            )
        }

        val rimBrush = Brush.linearGradient(
            colors = listOf(
                Color.White.copy(alpha = highlightAlpha),
                config.borderColor.copy(alpha = borderAlpha),
                config.accentColor.copy(alpha = refractionAlpha),
                config.primaryColor.copy(alpha = borderAlpha * 0.85f)
            ),
            start = Offset(0f, 0f),
            end = Offset(size.width, size.height)
        )

        onDrawBehind {
            drawRoundRect(
                brush = surfaceBrush,
                cornerRadius = CornerRadius(cornerPx, cornerPx)
            )
            if (refractionAlpha > 0.02f) {
                drawRoundRect(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            Color.Transparent,
                            config.primaryColor.copy(alpha = refractionAlpha * 0.55f),
                            config.accentColor.copy(alpha = refractionAlpha * 0.85f)
                        ),
                        center = Offset(size.width * 0.5f, size.height * 0.5f),
                        radius = maxOf(size.width, size.height) * 0.72f
                    ),
                    cornerRadius = CornerRadius(cornerPx, cornerPx),
                    style = Stroke(width = 2.5.dp.toPx())
                )
            }
            drawRoundRect(
                brush = rimBrush,
                cornerRadius = CornerRadius(cornerPx, cornerPx),
                style = Stroke(width = 1.25.dp.toPx())
            )
        }
    }
}

/**
 * Complete Dual-Theme Selector & Liquid Glass Customization Studio Section
 * embedded in the Android Native Settings Screen (`NativeSettingsScreen`).
 */
@Composable
fun LiquidGlassStudioSection(
    context: Context,
    designThemeMode: DesignThemeMode,
    liquidConfig: LiquidGlassConfig,
    savedPresets: List<LiquidGlassPreset>,
    onSelectDesignTheme: (DesignThemeMode) -> Unit,
    onUpdateLiquidConfig: (LiquidGlassConfig) -> Unit,
    onSaveCustomPreset: (String) -> Unit,
    onResetDefaults: () -> Unit,
    onShowInfo: (String) -> Unit
) {
    var customPresetName by remember { mutableStateOf("") }
    var showJsonDialog by remember { mutableStateOf(false) }
    var jsonDialogText by remember { mutableStateOf("") }

    SettingsSectionCard(
        title = "Sistema di Design & Liquid Glass",
        icon = Icons.Default.AutoAwesome
    ) {
        Text(
            text = "Seleziona tra il Tema Originale (Material You 120Hz invariato) e il sistema ottico completo Liquid Glass ispirato a Kyant0/AndroidLiquidGlass:",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(Modifier.height(12.dp))

        // 1. Theme Selector Cards (Tema 1 Originale vs Tema 2 Liquid Glass)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            DesignThemeMode.entries.forEach { mode ->
                val selected = designThemeMode == mode
                Surface(
                    onClick = {
                        onSelectDesignTheme(mode)
                        onShowInfo(
                            if (mode == DesignThemeMode.LIQUID_GLASS) {
                                "Tema Liquid Glass attivato in tempo reale"
                            } else {
                                "Tema Originale ripristinato"
                            }
                        )
                    },
                    shape = RoundedCornerShape(20.dp),
                    color = if (selected) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceContainerHigh
                    },
                    modifier = Modifier
                        .weight(1f)
                        .border(
                            width = if (selected) 2.dp else 1.dp,
                            color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                            shape = RoundedCornerShape(20.dp)
                        )
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = if (mode == DesignThemeMode.ORIGINAL) "Originale" else "Liquid Glass",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold
                            )
                            Icon(
                                imageVector = if (mode == DesignThemeMode.ORIGINAL) Icons.Default.Palette else Icons.Default.AutoAwesome,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Text(
                            text = if (mode == DesignThemeMode.ORIGINAL) {
                                "Material You classico invariato"
                            } else {
                                "Rifrazione SDF, blur e riflessi"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        // 2. Full Liquid Glass Studio (Visible when Liquid Glass is active)
        if (designThemeMode == DesignThemeMode.LIQUID_GLASS) {
            Spacer(Modifier.height(16.dp))

            // Real-Time Interactive Preview Stage
            Text(
                text = "Anteprima Ottica in Tempo Reale",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(8.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(22.dp))
                    .background(
                        Brush.linearGradient(
                            colors = listOf(
                                liquidConfig.surfaceToneColor,
                                liquidConfig.primaryColor.copy(alpha = 0.42f),
                                liquidConfig.secondaryColor.copy(alpha = 0.42f)
                            )
                        )
                    )
                    .padding(16.dp)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(liquidConfig.componentCornerRadius.dp))
                        .liquidGlassSurface(
                            config = liquidConfig,
                            isActive = true,
                            cornerRadiusDp = liquidConfig.componentCornerRadius.toFloat(),
                            isElevated = true
                        )
                        .padding(16.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 10.dp)) {
                            Text(
                                text = "Superficie Ottica Liquid Glass",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = liquidConfig.textColor
                            )
                            Text(
                                text = "Intensità ${liquidConfig.glassIntensity}% • Blur ${liquidConfig.blurRadius}dp • Rifrazione ${liquidConfig.refractionIntensity}%",
                                style = MaterialTheme.typography.labelSmall,
                                color = liquidConfig.textColor.copy(alpha = 0.82f)
                            )
                        }
                        Surface(
                            shape = CircleShape,
                            color = liquidConfig.primaryColor
                        ) {
                            Text(
                                text = "120Hz",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF041322),
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Preconfigured Presets
            Text(
                text = "Preset Preconfigurati & Salvati",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                LiquidGlassPresets.builtIn.forEach { preset ->
                    FilterChip(
                        selected = liquidConfig.primaryColorHex == preset.config.primaryColorHex &&
                            liquidConfig.glassIntensity == preset.config.glassIntensity,
                        onClick = {
                            onUpdateLiquidConfig(preset.config)
                            onShowInfo("Preset applicato: ${preset.name}")
                        },
                        label = { Text(preset.name) }
                    )
                }
                savedPresets.forEach { userPreset ->
                    FilterChip(
                        selected = false,
                        onClick = {
                            onUpdateLiquidConfig(userPreset.config)
                            onShowInfo("Configurazione caricata: ${userPreset.name}")
                        },
                        label = { Text("★ ${userPreset.name}") }
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = customPresetName,
                    onValueChange = { customPresetName = it },
                    placeholder = { Text("Nome preset...", fontSize = 12.sp) },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                FilledTonalButton(
                    onClick = {
                        val name = customPresetName.ifBlank { "Mio Liquid Glass" }
                        onSaveCustomPreset(name)
                        customPresetName = ""
                        onShowInfo("Preset '$name' salvato")
                    }
                ) {
                    Text("Salva")
                }
            }

            Spacer(Modifier.height(16.dp))

            // General Appearance Sliders
            Text(
                text = "Aspetto Generale",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(6.dp))

            LiquidSliderControl(
                label = "Intensità Effetto Vetro",
                valueText = "${liquidConfig.glassIntensity}%",
                value = liquidConfig.glassIntensity.toFloat(),
                range = 0f..100f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(glassIntensity = it.roundToInt())) }
            )
            LiquidSliderControl(
                label = "Trasparenza",
                valueText = "${liquidConfig.transparency}%",
                value = liquidConfig.transparency.toFloat(),
                range = 0f..100f,
                onValueChange = {
                    val t = it.roundToInt().coerceIn(0, 100)
                    onUpdateLiquidConfig(liquidConfig.copy(transparency = t, opacity = 100 - t))
                }
            )
            LiquidSliderControl(
                label = "Opacità",
                valueText = "${liquidConfig.opacity}%",
                value = liquidConfig.opacity.toFloat(),
                range = 0f..100f,
                onValueChange = {
                    val o = it.roundToInt().coerceIn(0, 100)
                    onUpdateLiquidConfig(liquidConfig.copy(opacity = o, transparency = 100 - o))
                }
            )
            LiquidSliderControl(
                label = "Sfocatura Ottica (Blur)",
                valueText = "${liquidConfig.blurRadius} dp",
                value = liquidConfig.blurRadius.toFloat(),
                range = 0f..60f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(blurRadius = it.roundToInt())) }
            )
            LiquidSliderControl(
                label = "Saturazione Sfondo",
                valueText = "${liquidConfig.backdropSaturation}%",
                value = liquidConfig.backdropSaturation.toFloat(),
                range = 50f..250f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(backdropSaturation = it.roundToInt())) }
            )
            LiquidSliderControl(
                label = "Luminosità",
                valueText = "${liquidConfig.brightness}%",
                value = liquidConfig.brightness.toFloat(),
                range = 50f..150f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(brightness = it.roundToInt())) }
            )
            LiquidSliderControl(
                label = "Contrasto",
                valueText = "${liquidConfig.contrast}%",
                value = liquidConfig.contrast.toFloat(),
                range = 50f..150f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(contrast = it.roundToInt())) }
            )
            LiquidSliderControl(
                label = "Profondità Visiva",
                valueText = "${liquidConfig.visualDepth}%",
                value = liquidConfig.visualDepth.toFloat(),
                range = 0f..100f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(visualDepth = it.roundToInt())) }
            )

            Spacer(Modifier.height(14.dp))

            // Color Palette Swatches
            Text(
                text = "Colori & Tonalità Vetro",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(6.dp))
            SettingsSwitchRow(
                title = "Colori Personalizzati anche in Tema Chiaro",
                subtitle = "Usa le tonalità superficie scure/colorate anche in modalità chiara",
                checked = liquidConfig.useCustomColors,
                onCheckedChange = { onUpdateLiquidConfig(liquidConfig.copy(useCustomColors = it)) }
            )
            Spacer(Modifier.height(6.dp))
            val colorSwatches = listOf(
                "#38BDF8" to "Ciano Artico",
                "#C084FC" to "Ametista",
                "#34D399" to "Smeraldo",
                "#FB7185" to "Quarzo Rosa",
                "#FBBF24" to "Ambra",
                "#94A3B8" to "Ossidiana"
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                colorSwatches.forEach { (hex, label) ->
                    val swatchColor = parseHexColor(hex, Color.Cyan)
                    val isSelected = liquidConfig.primaryColorHex.equals(hex, ignoreCase = true)
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(42.dp)
                            .clip(CircleShape)
                            .background(swatchColor)
                            .border(
                                width = if (isSelected) 3.dp else 1.dp,
                                color = if (isSelected) Color.White else Color.Transparent,
                                shape = CircleShape
                            )
                            .clickable {
                                onUpdateLiquidConfig(
                                    liquidConfig.copy(
                                        primaryColorHex = hex,
                                        accentColorHex = hex,
                                        borderColorHex = hex
                                    )
                                )
                                onShowInfo("Tonalità vetro: $label")
                            }
                    ) {
                        if (isSelected) {
                            Icon(
                                imageVector = Icons.Default.Check,
                                contentDescription = label,
                                tint = Color.Black,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Visual Effects & Refraction
            Text(
                text = "Effetti Visivi & Rifrazione",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
            SettingsSwitchRow(
                title = "Riflessi Luminosi Speculari",
                subtitle = "Riflessi ottici lungo i bordi superiori e inferiori del vetro",
                checked = liquidConfig.specularHighlights,
                onCheckedChange = { onUpdateLiquidConfig(liquidConfig.copy(specularHighlights = it)) }
            )
            if (liquidConfig.specularHighlights) {
                LiquidSliderControl(
                    label = "Intensità Riflessi",
                    valueText = "${liquidConfig.highlightIntensity}%",
                    value = liquidConfig.highlightIntensity.toFloat(),
                    range = 0f..100f,
                    onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(highlightIntensity = it.roundToInt())) }
                )
            }

            SettingsSwitchRow(
                title = "Bordi Luminosi",
                subtitle = "Contorno cristallino ad alta rifrazione",
                checked = liquidConfig.luminousBorders,
                onCheckedChange = { onUpdateLiquidConfig(liquidConfig.copy(luminousBorders = it)) }
            )
            if (liquidConfig.luminousBorders) {
                LiquidSliderControl(
                    label = "Intensità Bordi Luminosi",
                    valueText = "${liquidConfig.borderGlowIntensity}%",
                    value = liquidConfig.borderGlowIntensity.toFloat(),
                    range = 0f..100f,
                    onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(borderGlowIntensity = it.roundToInt())) }
                )
            }

            SettingsSwitchRow(
                title = "Gradiente delle Superfici",
                subtitle = "Sfumatura direzionale su barre, schede e modali",
                checked = liquidConfig.surfaceGradient,
                onCheckedChange = { onUpdateLiquidConfig(liquidConfig.copy(surfaceGradient = it)) }
            )
            if (liquidConfig.surfaceGradient) {
                LiquidSliderControl(
                    label = "Angolo Gradiente Superfici",
                    valueText = "${liquidConfig.gradientAngle}°",
                    value = liquidConfig.gradientAngle.toFloat(),
                    range = 0f..360f,
                    onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(gradientAngle = it.roundToInt())) }
                )
            }

            SettingsSwitchRow(
                title = "Ombre Multilivello & Profondità 3D",
                subtitle = "Separazione spaziale tra livelli e sfondo",
                checked = liquidConfig.shadowsEnabled,
                onCheckedChange = {
                    onUpdateLiquidConfig(liquidConfig.copy(shadowsEnabled = it, depthEffect = it))
                }
            )
            LiquidSliderControl(
                label = "Intensità Rifrazioni Ottiche",
                valueText = "${liquidConfig.refractionIntensity}%",
                value = liquidConfig.refractionIntensity.toFloat(),
                range = 0f..100f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(refractionIntensity = it.roundToInt())) }
            )

            SettingsSwitchRow(
                title = "Animazioni e Transizioni Fluide",
                subtitle = "Interpolazione elastica delle superfici Liquid Glass",
                checked = liquidConfig.animationsEnabled,
                onCheckedChange = { onUpdateLiquidConfig(liquidConfig.copy(animationsEnabled = it)) }
            )

            Spacer(Modifier.height(14.dp))

            // Component Geometry & Styles
            Text(
                text = "Componenti & Geometria",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
            LiquidSliderControl(
                label = "Arrotondamento Componenti",
                valueText = "${liquidConfig.componentCornerRadius} dp",
                value = liquidConfig.componentCornerRadius.toFloat(),
                range = 8f..40f,
                onValueChange = { onUpdateLiquidConfig(liquidConfig.copy(componentCornerRadius = it.roundToInt())) }
            )

            Spacer(Modifier.height(6.dp))
            Text(
                text = "Stile Barra Superiore & Navbar",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                NavBarGlassStyle.entries.forEach { style ->
                    FilterChip(
                        selected = liquidConfig.navBarGlassStyle == style,
                        onClick = { onUpdateLiquidConfig(liquidConfig.copy(navBarGlassStyle = style)) },
                        label = { Text(style.label) }
                    )
                }
            }

            Spacer(Modifier.height(6.dp))
            Text(
                text = "Stile Schede & Card",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                CardGlassStyle.entries.forEach { style ->
                    FilterChip(
                        selected = liquidConfig.cardGlassStyle == style,
                        onClick = { onUpdateLiquidConfig(liquidConfig.copy(cardGlassStyle = style)) },
                        label = { Text(style.label) }
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            // Export / Import JSON & Reset
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilledTonalButton(
                    onClick = {
                        jsonDialogText = LiquidGlassConfigStore.exportToJson(liquidConfig)
                        showJsonDialog = true
                    },
                    shape = CircleShape,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Esporta / Importa JSON", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }

                OutlinedButton(
                    onClick = {
                        onResetDefaults()
                        onShowInfo("Valori predefiniti Liquid Glass ripristinati")
                    },
                    shape = CircleShape
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Reset")
                }
            }
        }
    }

    if (showJsonDialog) {
        AlertDialog(
            onDismissRequest = { showJsonDialog = false },
            title = { Text("Configurazione JSON Liquid Glass", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Copia questo JSON per esportarlo (compatibile anche con la Web App) oppure incolla una configurazione JSON per importarla:",
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedTextField(
                        value = jsonDialogText,
                        onValueChange = { jsonDialogText = it },
                        textStyle = LocalTextStyle.current.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val imported = LiquidGlassConfigStore.importFromJson(jsonDialogText)
                        if (imported != null) {
                            onUpdateLiquidConfig(imported)
                            showJsonDialog = false
                            onShowInfo("Configurazione JSON Liquid Glass importata")
                        } else {
                            onShowInfo("JSON non valido")
                        }
                    }
                ) {
                    Text("Importa JSON")
                }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(
                        onClick = {
                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                            cm?.setPrimaryClip(ClipData.newPlainText("LiquidGlassConfig", jsonDialogText))
                            onShowInfo("JSON copiato negli appunti")
                        }
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Copia")
                    }
                    TextButton(onClick = { showJsonDialog = false }) {
                        Text("Chiudi")
                    }
                }
            }
        )
    }
}

@Composable
private fun LiquidSliderControl(
    label: String,
    valueText: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onValueChange: (Float) -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = valueText,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }
        Slider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = onValueChange,
            valueRange = range
        )
    }
}
