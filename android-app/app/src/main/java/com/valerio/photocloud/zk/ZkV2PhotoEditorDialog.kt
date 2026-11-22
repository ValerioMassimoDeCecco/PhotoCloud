package com.valerio.photocloud.zk

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import androidx.compose.foundation.Canvas as ComposeCanvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.RotateLeft
import androidx.compose.material.icons.automirrored.filled.RotateRight
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Compare
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

enum class ZkPhotoFilterPreset(
    val label: String,
    val brightness: Float,
    val contrast: Float,
    val saturation: Float,
    val warmth: Float
) {
    ORIGINAL("Originale", 0f, 0f, 0f, 0f),
    VIVID("Vivido", 4f, 18f, 32f, 8f),
    BW("B&N", 2f, 22f, -100f, 0f),
    SEPIA("Seppia", 4f, 10f, -35f, 48f),
    CINEMA("Cinema", -4f, 24f, -12f, -14f),
    COOL("Freddo", 2f, 10f, 8f, -34f),
    VINTAGE("Vintage", 6f, -10f, -24f, 30f)
}

enum class ZkCropAspect(val label: String, val ratio: Float?) {
    FREE("Libero", null),
    SQUARE("1:1", 1f),
    FOUR_THREE("4:3", 4f / 3f),
    FOUR_FIVE("4:5", 4f / 5f),
    SIXTEEN_NINE("16:9", 16f / 9f)
}

private enum class ZkEditorTab(val label: String, val icon: ImageVector) {
    FILTERS("Filtri", Icons.Default.AutoFixHigh),
    ADJUST("Regola", Icons.Default.Tune),
    CROP("Ritaglia", Icons.Default.Crop)
}

private enum class ZkAdjustParam(val label: String) {
    BRIGHTNESS("Luminosità"),
    CONTRAST("Contrasto"),
    SATURATION("Saturazione"),
    WARMTH("Calore")
}

internal enum class ZkCropHandle {
    MOVE, NW, NE, SW, SE
}

private class ZkRenderedPhotoExport(
    val jpegBytes: ByteArray,
    val thumb320: ByteArray,
    val thumb1280: ByteArray,
    val width: Int,
    val height: Int
)

data class ZkNormalizedCropBox(
    val left: Float = 0f,
    val top: Float = 0f,
    val right: Float = 1f,
    val bottom: Float = 1f
) {
    fun clamped(minSpan: Float = 0.12f): ZkNormalizedCropBox {
        val span = minSpan.coerceIn(0.05f, 0.5f)
        var l = left.coerceIn(0f, 1f - span)
        var t = top.coerceIn(0f, 1f - span)
        var r = right.coerceIn(l + span, 1f)
        var b = bottom.coerceIn(t + span, 1f)
        if (r - l < span) {
            if (l + span <= 1f) r = l + span else l = (r - span).coerceAtLeast(0f)
        }
        if (b - t < span) {
            if (t + span <= 1f) b = t + span else t = (b - span).coerceAtLeast(0f)
        }
        return ZkNormalizedCropBox(l, t, r, b)
    }

    fun isFullImage(): Boolean {
        return left <= 0.005f && top <= 0.005f && right >= 0.995f && bottom >= 0.995f
    }
}

internal object ZkCropBoxMath {
    fun fitAspect(srcWidth: Int, srcHeight: Int, aspect: ZkCropAspect): ZkNormalizedCropBox {
        val target = aspect.ratio ?: return ZkNormalizedCropBox()
        val w = srcWidth.coerceAtLeast(1).toFloat()
        val h = srcHeight.coerceAtLeast(1).toFloat()
        val current = w / h
        return if (current > target) {
            val cropW = (h * target / w).coerceIn(0.12f, 1f)
            val margin = (1f - cropW) / 2f
            ZkNormalizedCropBox(margin, 0f, 1f - margin, 1f)
        } else {
            val cropH = (w / target / h).coerceIn(0.12f, 1f)
            val margin = (1f - cropH) / 2f
            ZkNormalizedCropBox(0f, margin, 1f, 1f - margin)
        }
    }

    fun hitTestHandle(
        normX: Float,
        normY: Float,
        box: ZkNormalizedCropBox,
        cornerRadiusNorm: Float = 0.11f
    ): ZkCropHandle? {
        fun near(ax: Float, ay: Float): Boolean =
            abs(normX - ax) <= cornerRadiusNorm && abs(normY - ay) <= cornerRadiusNorm

        if (near(box.left, box.top)) return ZkCropHandle.NW
        if (near(box.right, box.top)) return ZkCropHandle.NE
        if (near(box.left, box.bottom)) return ZkCropHandle.SW
        if (near(box.right, box.bottom)) return ZkCropHandle.SE
        if (normX in box.left..box.right && normY in box.top..box.bottom) {
            return ZkCropHandle.MOVE
        }
        return null
    }

    fun dragHandle(
        start: ZkNormalizedCropBox,
        handle: ZkCropHandle,
        dxNorm: Float,
        dyNorm: Float,
        aspect: ZkCropAspect,
        srcWidth: Int,
        srcHeight: Int,
        minSpan: Float = 0.14f
    ): ZkNormalizedCropBox {
        if (handle == ZkCropHandle.MOVE) {
            val dx = dxNorm.coerceIn(-start.left, 1f - start.right)
            val dy = dyNorm.coerceIn(-start.top, 1f - start.bottom)
            return ZkNormalizedCropBox(
                left = start.left + dx,
                top = start.top + dy,
                right = start.right + dx,
                bottom = start.bottom + dy
            )
        }

        var l = start.left
        var t = start.top
        var r = start.right
        var b = start.bottom

        when (handle) {
            ZkCropHandle.NW -> {
                l = (start.left + dxNorm).coerceIn(0f, r - minSpan)
                t = (start.top + dyNorm).coerceIn(0f, b - minSpan)
            }
            ZkCropHandle.NE -> {
                r = (start.right + dxNorm).coerceIn(l + minSpan, 1f)
                t = (start.top + dyNorm).coerceIn(0f, b - minSpan)
            }
            ZkCropHandle.SW -> {
                l = (start.left + dxNorm).coerceIn(0f, r - minSpan)
                b = (start.bottom + dyNorm).coerceIn(t + minSpan, 1f)
            }
            ZkCropHandle.SE -> {
                r = (start.right + dxNorm).coerceIn(l + minSpan, 1f)
                b = (start.bottom + dyNorm).coerceIn(t + minSpan, 1f)
            }
            ZkCropHandle.MOVE -> Unit
        }

        val targetRatio = aspect.ratio
        if (targetRatio != null && srcWidth > 0 && srcHeight > 0) {
            val imgRatio = srcWidth.toFloat() / srcHeight.toFloat()
            val normRatio = targetRatio / imgRatio
            val newW = (r - l).coerceAtLeast(minSpan)
            val desiredH = (newW / normRatio).coerceIn(minSpan, 1f)
            if (handle == ZkCropHandle.NW || handle == ZkCropHandle.NE) {
                t = (b - desiredH).coerceAtLeast(0f)
                val actualH = b - t
                val actualW = (actualH * normRatio).coerceIn(minSpan, 1f)
                if (handle == ZkCropHandle.NW) {
                    l = (r - actualW).coerceAtLeast(0f)
                } else {
                    r = (l + actualW).coerceAtMost(1f)
                }
            } else {
                b = (t + desiredH).coerceAtMost(1f)
                val actualH = b - t
                val actualW = (actualH * normRatio).coerceIn(minSpan, 1f)
                if (handle == ZkCropHandle.SW) {
                    l = (r - actualW).coerceAtLeast(0f)
                } else {
                    r = (l + actualW).coerceAtMost(1f)
                }
            }
        }

        return ZkNormalizedCropBox(l, t, r, b).clamped(minSpan)
    }
}

data class ZkPhotoEditParams(
    val brightness: Float = 0f,
    val contrast: Float = 0f,
    val saturation: Float = 0f,
    val warmth: Float = 0f,
    val rotationDeg: Int = 0,
    val flipH: Boolean = false,
    val flipV: Boolean = false,
    val aspect: ZkCropAspect = ZkCropAspect.FREE,
    val cropBox: ZkNormalizedCropBox = ZkNormalizedCropBox(),
    val preset: ZkPhotoFilterPreset = ZkPhotoFilterPreset.ORIGINAL
) {
    fun hasChanges(): Boolean {
        return brightness != 0f ||
            contrast != 0f ||
            saturation != 0f ||
            warmth != 0f ||
            rotationDeg != 0 ||
            flipH ||
            flipV ||
            !cropBox.isFullImage() ||
            preset != ZkPhotoFilterPreset.ORIGINAL
    }
}

object ZkPhotoEditorRenderer {
    fun buildColorMatrix(params: ZkPhotoEditParams): ColorMatrix {
        val cm = ColorMatrix()

        val satFactor = ((params.saturation + 100f) / 100f).coerceIn(0f, 2f)
        val satMatrix = ColorMatrix().apply { setSaturation(satFactor) }
        cm.postConcat(satMatrix)

        val cFactor = ((params.contrast + 100f) / 100f).pow(1.6f).coerceIn(0.2f, 3.0f)
        val cTranslate = 128f * (1f - cFactor)
        val bOffset = (params.brightness / 100f) * 90f
        val wShift = (params.warmth / 100f) * 38f

        val toneMatrix = ColorMatrix(
            floatArrayOf(
                cFactor, 0f, 0f, 0f, cTranslate + bOffset + wShift,
                0f, cFactor, 0f, 0f, cTranslate + bOffset + wShift * 0.18f,
                0f, 0f, cFactor, 0f, cTranslate + bOffset - wShift,
                0f, 0f, 0f, 1f, 0f
            )
        )
        cm.postConcat(toneMatrix)
        return cm
    }

    fun render(
        source: Bitmap,
        params: ZkPhotoEditParams,
        maxOutputEdge: Int? = null,
        applyCrop: Boolean = true
    ): Bitmap {
        val rot = ((params.rotationDeg % 360) + 360) % 360
        val matrix = Matrix().apply {
            if (params.flipH || params.flipV) {
                postScale(if (params.flipH) -1f else 1f, if (params.flipV) -1f else 1f)
            }
            if (rot != 0) {
                postRotate(rot.toFloat())
            }
        }
        val transformed = if (!matrix.isIdentity) {
            Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
        } else {
            source
        }

        val box = if (applyCrop) params.cropBox.clamped(0.05f) else ZkNormalizedCropBox()
        val cropX = (box.left * transformed.width).roundToInt().coerceIn(0, (transformed.width - 1).coerceAtLeast(0))
        val cropY = (box.top * transformed.height).roundToInt().coerceIn(0, (transformed.height - 1).coerceAtLeast(0))
        val cropW = ((box.right - box.left) * transformed.width).roundToInt()
            .coerceIn(1, (transformed.width - cropX).coerceAtLeast(1))
        val cropH = ((box.bottom - box.top) * transformed.height).roundToInt()
            .coerceIn(1, (transformed.height - cropY).coerceAtLeast(1))

        val scale = if (maxOutputEdge != null && max(cropW, cropH) > maxOutputEdge) {
            maxOutputEdge.toFloat() / max(cropW, cropH).toFloat()
        } else {
            1f
        }
        val outW = max(1, (cropW * scale).roundToInt())
        val outH = max(1, (cropH * scale).roundToInt())

        val output = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            colorFilter = ColorMatrixColorFilter(buildColorMatrix(params))
        }
        val srcRect = android.graphics.Rect(cropX, cropY, cropX + cropW, cropY + cropH)
        val dstRect = android.graphics.Rect(0, 0, outW, outH)
        canvas.drawBitmap(transformed, srcRect, dstRect, paint)
        if (transformed !== source) {
            transformed.recycle()
        }
        return output
    }
}

@Composable
fun ZkV2PhotoEditorDialog(
    item: DecryptedZkItem,
    repository: ZkVaultRepository,
    onUserActivity: () -> Unit = {},
    onDismiss: () -> Unit,
    onSavedCopy: (DecryptedZkItem) -> Unit,
    onOverwritten: (DecryptedZkItem) -> Unit
) {
    val scope = rememberCoroutineScope()
    var originalBitmap by remember(item.blobId) { mutableStateOf<Bitmap?>(null) }
    var previewBaseBitmap by remember(item.blobId) { mutableStateOf<Bitmap?>(null) }
    var previewBitmap by remember(item.blobId) { mutableStateOf<Bitmap?>(null) }
    var filterThumbs by remember(item.blobId) { mutableStateOf<Map<ZkPhotoFilterPreset, Bitmap>>(emptyMap()) }
    var loadError by remember(item.blobId) { mutableStateOf<String?>(null) }
    var isLoading by remember(item.blobId) { mutableStateOf(true) }
    var isSaving by remember(item.blobId) { mutableStateOf(false) }
    var activeTab by remember { mutableStateOf(ZkEditorTab.FILTERS) }
    var activeAdjustParam by remember { mutableStateOf(ZkAdjustParam.BRIGHTNESS) }
    var compareOriginal by remember { mutableStateOf(false) }

    var params by remember(item.blobId) { mutableStateOf(ZkPhotoEditParams()) }
    var undoStack by remember(item.blobId) { mutableStateOf<List<ZkPhotoEditParams>>(emptyList()) }
    var redoStack by remember(item.blobId) { mutableStateOf<List<ZkPhotoEditParams>>(emptyList()) }
    var stageSize by remember { mutableStateOf(IntSize.Zero) }

    fun pushParams(next: ZkPhotoEditParams) {
        if (next == params) return
        onUserActivity()
        undoStack = (undoStack + params).takeLast(30)
        redoStack = emptyList()
        params = next
    }

    LaunchedEffect(item.blobId) {
        onUserActivity()
        isLoading = true
        loadError = null
        try {
            val bytes = repository.decryptBlobToBytes(item.blobId)
            val decoded = withContext(Dispatchers.Default) {
                try {
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                } finally {
                    bytes.zeroize()
                }
            }
            if (decoded == null) {
                loadError = "Impossibile decodificare l'immagine."
            } else {
                originalBitmap = decoded
                val base = withContext(Dispatchers.Default) {
                    val maxEdge = max(decoded.width, decoded.height)
                    if (maxEdge > 1440) {
                        val s = 1440f / maxEdge.toFloat()
                        Bitmap.createScaledBitmap(
                            decoded,
                            max(1, (decoded.width * s).roundToInt()),
                            max(1, (decoded.height * s).roundToInt()),
                            true
                        )
                    } else {
                        decoded
                    }
                }
                previewBaseBitmap = base
                val thumbs = withContext(Dispatchers.Default) {
                    val small = Bitmap.createScaledBitmap(decoded, 128, 128, true)
                    val map = linkedMapOf<ZkPhotoFilterPreset, Bitmap>()
                    for (preset in ZkPhotoFilterPreset.entries) {
                        map[preset] = ZkPhotoEditorRenderer.render(
                            source = small,
                            params = ZkPhotoEditParams(
                                brightness = preset.brightness,
                                contrast = preset.contrast,
                                saturation = preset.saturation,
                                warmth = preset.warmth,
                                preset = preset
                            ),
                            maxOutputEdge = 128,
                            applyCrop = false
                        )
                    }
                    if (small !== decoded) small.recycle()
                    map
                }
                filterThumbs = thumbs
            }
        } catch (t: Throwable) {
            loadError = t.message ?: "Errore caricamento immagine."
        } finally {
            isLoading = false
        }
    }

    // In Crop tab, display full uncropped rotated bitmap so the user drags the crop box directly on it
    val showUncroppedForCrop = activeTab == ZkEditorTab.CROP && !compareOriginal
    LaunchedEffect(previewBaseBitmap, params, compareOriginal, showUncroppedForCrop) {
        val base = previewBaseBitmap ?: return@LaunchedEffect
        val rendered = withContext(Dispatchers.Default) {
            if (compareOriginal) {
                base.copy(Bitmap.Config.ARGB_8888, false)
            } else {
                ZkPhotoEditorRenderer.render(
                    source = base,
                    params = params,
                    maxOutputEdge = 1280,
                    applyCrop = !showUncroppedForCrop
                )
            }
        }
        val prev = previewBitmap
        previewBitmap = rendered
        if (prev != null && prev !== base && prev !== originalBitmap) {
            prev.recycle()
        }
    }

    DisposableEffect(item.blobId) {
        onDispose {
            filterThumbs.values.forEach { if (!it.isRecycled) it.recycle() }
        }
    }

    fun encodeScaledJpeg(source: Bitmap, maxEdge: Int, quality: Int): ByteArray {
        val largest = max(source.width, source.height)
        val scaled = if (largest > maxEdge && largest > 0) {
            val factor = maxEdge.toFloat() / largest.toFloat()
            Bitmap.createScaledBitmap(
                source,
                max(1, (source.width * factor).roundToInt()),
                max(1, (source.height * factor).roundToInt()),
                true
            )
        } else {
            source
        }
        return try {
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
            out.toByteArray()
        } finally {
            if (scaled !== source && !scaled.isRecycled) {
                scaled.recycle()
            }
        }
    }

    fun saveEdited(overwrite: Boolean) {
        val src = originalBitmap ?: return
        if (isSaving) return
        onUserActivity()
        isSaving = true
        loadError = null
        scope.launch {
            try {
                val exported = withContext(Dispatchers.Default) {
                    val rendered = ZkPhotoEditorRenderer.render(src, params, maxOutputEdge = null, applyCrop = true)
                    val baos = ByteArrayOutputStream()
                    try {
                        rendered.compress(Bitmap.CompressFormat.JPEG, 92, baos)
                        val t320 = encodeScaledJpeg(rendered, maxEdge = 320, quality = 80)
                        val t1280 = encodeScaledJpeg(rendered, maxEdge = 1280, quality = 85)
                        ZkRenderedPhotoExport(
                            jpegBytes = baos.toByteArray(),
                            thumb320 = t320,
                            thumb1280 = t1280,
                            width = rendered.width,
                            height = rendered.height
                        )
                    } finally {
                        rendered.recycle()
                    }
                }
                try {
                    if (overwrite) {
                        val updated = repository.replaceItemWithEditedBytes(
                            item = item,
                            editedBytes = exported.jpegBytes,
                            newWidth = exported.width,
                            newHeight = exported.height,
                            mime = "image/jpeg",
                            thumb320Jpeg = exported.thumb320,
                            thumb1280Jpeg = exported.thumb1280
                        )
                        onOverwritten(updated)
                    } else {
                        val copyBase = item.meta.name.substringBeforeLast('.', item.meta.name)
                        val copyName = "${copyBase}_modificata.jpg"
                        val created = repository.uploadEditedCopyBytes(
                            name = copyName,
                            mime = "image/jpeg",
                            editedBytes = exported.jpegBytes,
                            width = exported.width,
                            height = exported.height,
                            takenAtMs = item.meta.takenAt,
                            exifSubset = item.meta.exifSubset,
                            thumb320Jpeg = exported.thumb320,
                            thumb1280Jpeg = exported.thumb1280
                        )
                        onSavedCopy(created)
                    }
                } finally {
                    exported.jpegBytes.zeroize()
                    exported.thumb320.zeroize()
                    exported.thumb1280.zeroize()
                }
            } catch (t: Throwable) {
                loadError = t.message ?: "Errore salvataggio foto cifrata."
            } finally {
                isSaving = false
            }
        }
    }

    Dialog(
        onDismissRequest = { if (!isSaving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF050505))
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            // Minimal single-row top bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0B0F19))
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                IconButton(onClick = { if (!isSaving) onDismiss() }) {
                    Icon(Icons.Default.Close, contentDescription = "Annulla", tint = Color.White)
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(
                        enabled = undoStack.isNotEmpty() && !isSaving,
                        onClick = {
                            if (undoStack.isNotEmpty()) {
                                onUserActivity()
                                redoStack = listOf(params) + redoStack
                                params = undoStack.last()
                                undoStack = undoStack.dropLast(1)
                            }
                        }
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Undo,
                            contentDescription = "Annulla ultima modifica",
                            tint = if (undoStack.isNotEmpty()) Color.White else Color(0xFF555E70)
                        )
                    }
                    IconButton(
                        enabled = redoStack.isNotEmpty() && !isSaving,
                        onClick = {
                            if (redoStack.isNotEmpty()) {
                                onUserActivity()
                                undoStack = undoStack + params
                                params = redoStack.first()
                                redoStack = redoStack.drop(1)
                            }
                        }
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Redo,
                            contentDescription = "Ripeti modifica",
                            tint = if (redoStack.isNotEmpty()) Color.White else Color(0xFF555E70)
                        )
                    }
                    IconButton(
                        enabled = params.hasChanges() && !isSaving,
                        onClick = {
                            onUserActivity()
                            compareOriginal = !compareOriginal
                        }
                    ) {
                        Icon(
                            Icons.Default.Compare,
                            contentDescription = "Confronta con originale",
                            tint = when {
                                compareOriginal -> Color(0xFF38BDF8)
                                params.hasChanges() -> Color.White
                                else -> Color(0xFF555E70)
                            }
                        )
                    }
                    IconButton(
                        enabled = params.hasChanges() && !isSaving,
                        onClick = {
                            compareOriginal = false
                            pushParams(ZkPhotoEditParams())
                        }
                    ) {
                        Icon(
                            Icons.Default.RestartAlt,
                            contentDescription = "Ripristina originale",
                            tint = if (params.hasChanges()) Color.White else Color(0xFF555E70)
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(
                        enabled = !isLoading && !isSaving && originalBitmap != null,
                        onClick = { saveEdited(overwrite = false) },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text("Copia", color = Color.White, style = MaterialTheme.typography.labelMedium)
                    }
                    Button(
                        enabled = !isLoading && !isSaving && originalBitmap != null,
                        onClick = { saveEdited(overwrite = true) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
                    ) {
                        Text(
                            if (isSaving) "Salvo..." else "Salva",
                            color = Color.White,
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                }
            }

            if (loadError != null) {
                Text(
                    text = loadError!!,
                    color = Color(0xFFFCA5A5),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                )
            }

            // Dominant dark photo stage (~65-70% viewport)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(14.dp)
                    .onSizeChanged { stageSize = it },
                contentAlignment = Alignment.Center
            ) {
                val bmp = previewBitmap
                if (isLoading) {
                    CircularProgressIndicator(color = Color(0xFF38BDF8))
                } else if (bmp != null) {
                    // Compute exact displayed image rect inside stage for interactive crop overlay
                    val fitScale = if (stageSize.width > 0 && stageSize.height > 0 && bmp.width > 0 && bmp.height > 0) {
                        min(stageSize.width.toFloat() / bmp.width, stageSize.height.toFloat() / bmp.height)
                    } else {
                        1f
                    }
                    val imgW = (bmp.width * fitScale).coerceAtLeast(1f)
                    val imgH = (bmp.height * fitScale).coerceAtLeast(1f)
                    val imgLeft = (stageSize.width - imgW) / 2f
                    val imgTop = (stageSize.height - imgH) / 2f

                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .then(
                                if (activeTab != ZkEditorTab.CROP) {
                                    Modifier.pointerInput(item.blobId) {
                                        detectTapGestures(
                                            onPress = {
                                                if (params.hasChanges()) {
                                                    compareOriginal = true
                                                    tryAwaitRelease()
                                                    compareOriginal = false
                                                }
                                            }
                                        )
                                    }
                                } else {
                                    Modifier
                                }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = item.meta.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize()
                        )

                        if (compareOriginal) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = Color(0xCC0B0F19),
                                modifier = Modifier
                                    .align(Alignment.TopCenter)
                                    .padding(top = 8.dp)
                            ) {
                                Text(
                                    text = "Originale",
                                    color = Color.White,
                                    style = MaterialTheme.typography.labelSmall,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                                )
                            }
                        }

                        // Real interactive draggable crop overlay in Ritaglia tab
                        if (showUncroppedForCrop && stageSize.width > 0 && stageSize.height > 0) {
                            var activeHandle by remember { mutableStateOf<ZkCropHandle?>(null) }
                            var dragStartBox by remember { mutableStateOf(params.cropBox) }
                            var totalDx by remember { mutableStateOf(0f) }
                            var totalDy by remember { mutableStateOf(0f) }

                            ComposeCanvas(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .pointerInput(params.aspect, bmp.width, bmp.height, imgW, imgH, imgLeft, imgTop) {
                                        detectDragGestures(
                                            onDragStart = { startOffset ->
                                                val nx = (startOffset.x - imgLeft) / imgW
                                                val ny = (startOffset.y - imgTop) / imgH
                                                activeHandle = ZkCropBoxMath.hitTestHandle(nx, ny, params.cropBox)
                                                dragStartBox = params.cropBox
                                                totalDx = 0f
                                                totalDy = 0f
                                                if (activeHandle != null) {
                                                    onUserActivity()
                                                }
                                            },
                                            onDragEnd = {
                                                if (activeHandle != null && params.cropBox != dragStartBox) {
                                                    undoStack = (undoStack + params.copy(cropBox = dragStartBox)).takeLast(30)
                                                    redoStack = emptyList()
                                                }
                                                activeHandle = null
                                            },
                                            onDragCancel = {
                                                activeHandle = null
                                            },
                                            onDrag = { change, dragAmount ->
                                                val h = activeHandle ?: return@detectDragGestures
                                                change.consume()
                                                totalDx += dragAmount.x
                                                totalDy += dragAmount.y
                                                val updatedBox = ZkCropBoxMath.dragHandle(
                                                    start = dragStartBox,
                                                    handle = h,
                                                    dxNorm = totalDx / imgW,
                                                    dyNorm = totalDy / imgH,
                                                    aspect = params.aspect,
                                                    srcWidth = bmp.width,
                                                    srcHeight = bmp.height
                                                )
                                                params = params.copy(cropBox = updatedBox)
                                            }
                                        )
                                    }
                            ) {
                                val box = params.cropBox
                                val cl = imgLeft + box.left * imgW
                                val ct = imgTop + box.top * imgH
                                val cr = imgLeft + box.right * imgW
                                val cb = imgTop + box.bottom * imgH
                                val cw = (cr - cl).coerceAtLeast(1f)
                                val ch = (cb - ct).coerceAtLeast(1f)
                                val scrim = Color(0xAA000000)

                                // Dimmed exterior regions around crop box
                                drawRect(scrim, topLeft = Offset(imgLeft, imgTop), size = Size(imgW, (ct - imgTop).coerceAtLeast(0f)))
                                drawRect(scrim, topLeft = Offset(imgLeft, cb), size = Size(imgW, (imgTop + imgH - cb).coerceAtLeast(0f)))
                                drawRect(scrim, topLeft = Offset(imgLeft, ct), size = Size((cl - imgLeft).coerceAtLeast(0f), ch))
                                drawRect(scrim, topLeft = Offset(cr, ct), size = Size((imgLeft + imgW - cr).coerceAtLeast(0f), ch))

                                // Rule of thirds grid
                                val gridColor = Color.White.copy(alpha = 0.35f)
                                drawLine(gridColor, Offset(cl + cw / 3f, ct), Offset(cl + cw / 3f, cb), strokeWidth = 1.5f)
                                drawLine(gridColor, Offset(cl + 2f * cw / 3f, ct), Offset(cl + 2f * cw / 3f, cb), strokeWidth = 1.5f)
                                drawLine(gridColor, Offset(cl, ct + ch / 3f), Offset(cr, ct + ch / 3f), strokeWidth = 1.5f)
                                drawLine(gridColor, Offset(cl, ct + 2f * ch / 3f), Offset(cr, ct + 2f * ch / 3f), strokeWidth = 1.5f)

                                // Crisp border
                                drawRect(
                                    color = Color.White.copy(alpha = 0.85f),
                                    topLeft = Offset(cl, ct),
                                    size = Size(cw, ch),
                                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2.5f)
                                )

                                // Bold corner L-brackets
                                val arm = 22.dp.toPx().coerceAtMost(min(cw, ch) * 0.35f)
                                val bracketStroke = 5.dp.toPx()
                                val accent = Color.White
                                // NW
                                drawLine(accent, Offset(cl, ct), Offset(cl + arm, ct), strokeWidth = bracketStroke)
                                drawLine(accent, Offset(cl, ct), Offset(cl, ct + arm), strokeWidth = bracketStroke)
                                // NE
                                drawLine(accent, Offset(cr, ct), Offset(cr - arm, ct), strokeWidth = bracketStroke)
                                drawLine(accent, Offset(cr, ct), Offset(cr, ct + arm), strokeWidth = bracketStroke)
                                // SW
                                drawLine(accent, Offset(cl, cb), Offset(cl + arm, cb), strokeWidth = bracketStroke)
                                drawLine(accent, Offset(cl, cb), Offset(cl, cb - arm), strokeWidth = bracketStroke)
                                // SE
                                drawLine(accent, Offset(cr, cb), Offset(cr - arm, cb), strokeWidth = bracketStroke)
                                drawLine(accent, Offset(cr, cb), Offset(cr, cb - arm), strokeWidth = bracketStroke)
                            }
                        }
                    }
                }
            }

            // Bottom intuitive dock
            Surface(
                color = Color(0xFF0B0F19),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    when (activeTab) {
                        ZkEditorTab.FILTERS -> {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                ZkPhotoFilterPreset.entries.forEach { preset ->
                                    val selected = params.preset == preset
                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                        modifier = Modifier
                                            .width(72.dp)
                                            .clickable {
                                                pushParams(
                                                    params.copy(
                                                        preset = preset,
                                                        brightness = preset.brightness,
                                                        contrast = preset.contrast,
                                                        saturation = preset.saturation,
                                                        warmth = preset.warmth
                                                    )
                                                )
                                            }
                                    ) {
                                        val thumb = filterThumbs[preset]
                                        Box(
                                            modifier = Modifier
                                                .size(64.dp)
                                                .clip(RoundedCornerShape(10.dp))
                                                .background(Color(0xFF151C2C))
                                                .border(
                                                    width = if (selected) 2.5.dp else 1.dp,
                                                    color = if (selected) Color(0xFF38BDF8) else Color(0xFF263044),
                                                    shape = RoundedCornerShape(10.dp)
                                                ),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            if (thumb != null && !thumb.isRecycled) {
                                                Image(
                                                    bitmap = thumb.asImageBitmap(),
                                                    contentDescription = preset.label,
                                                    contentScale = ContentScale.Crop,
                                                    modifier = Modifier.fillMaxSize()
                                                )
                                            }
                                        }
                                        Text(
                                            text = preset.label,
                                            color = if (selected) Color(0xFF38BDF8) else Color(0xFFC8D2E3),
                                            style = MaterialTheme.typography.labelSmall,
                                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                        }

                        ZkEditorTab.ADJUST -> {
                            val activeValue = when (activeAdjustParam) {
                                ZkAdjustParam.BRIGHTNESS -> params.brightness
                                ZkAdjustParam.CONTRAST -> params.contrast
                                ZkAdjustParam.SATURATION -> params.saturation
                                ZkAdjustParam.WARMTH -> params.warmth
                            }

                            // Single active parameter selector row (clean, zero clutter)
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                ZkAdjustParam.entries.forEach { param ->
                                    val selected = activeAdjustParam == param
                                    val paramVal = when (param) {
                                        ZkAdjustParam.BRIGHTNESS -> params.brightness
                                        ZkAdjustParam.CONTRAST -> params.contrast
                                        ZkAdjustParam.SATURATION -> params.saturation
                                        ZkAdjustParam.WARMTH -> params.warmth
                                    }
                                    val modified = abs(paramVal) >= 1f
                                    Surface(
                                        shape = RoundedCornerShape(10.dp),
                                        color = if (selected) Color(0xFF1E293B) else Color(0xFF111827),
                                        border = androidx.compose.foundation.BorderStroke(
                                            1.dp,
                                            if (selected) Color(0xFF38BDF8) else Color(0xFF222B3C)
                                        ),
                                        modifier = Modifier
                                            .weight(1f)
                                            .clickable { activeAdjustParam = param }
                                    ) {
                                        Column(
                                            horizontalAlignment = Alignment.CenterHorizontally,
                                            modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp)
                                        ) {
                                            Text(
                                                text = param.label,
                                                color = if (selected) Color.White else Color(0xFF94A3B8),
                                                style = MaterialTheme.typography.labelSmall,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Spacer(Modifier.height(3.dp))
                                            Box(
                                                modifier = Modifier
                                                    .size(5.dp)
                                                    .clip(CircleShape)
                                                    .background(if (modified) Color(0xFF38BDF8) else Color.Transparent)
                                            )
                                        }
                                    }
                                }
                            }

                            // Single comfortable thumb slider for the active parameter
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = activeAdjustParam.label,
                                        color = Color(0xFFE2E8F0),
                                        style = MaterialTheme.typography.labelMedium
                                    )
                                    TextButton(
                                        onClick = {
                                            pushParams(
                                                when (activeAdjustParam) {
                                                    ZkAdjustParam.BRIGHTNESS -> params.copy(brightness = 0f, preset = ZkPhotoFilterPreset.ORIGINAL)
                                                    ZkAdjustParam.CONTRAST -> params.copy(contrast = 0f, preset = ZkPhotoFilterPreset.ORIGINAL)
                                                    ZkAdjustParam.SATURATION -> params.copy(saturation = 0f, preset = ZkPhotoFilterPreset.ORIGINAL)
                                                    ZkAdjustParam.WARMTH -> params.copy(warmth = 0f, preset = ZkPhotoFilterPreset.ORIGINAL)
                                                }
                                            )
                                        },
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                    ) {
                                        val rounded = activeValue.roundToInt()
                                        Text(
                                            text = if (rounded > 0) "+$rounded" else "$rounded",
                                            color = if (rounded != 0) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                                            style = MaterialTheme.typography.labelMedium,
                                            fontFamily = FontFamily.Monospace
                                        )
                                    }
                                }
                                Slider(
                                    value = activeValue,
                                    onValueChange = { v ->
                                        onUserActivity()
                                        params = when (activeAdjustParam) {
                                            ZkAdjustParam.BRIGHTNESS -> params.copy(brightness = v, preset = ZkPhotoFilterPreset.ORIGINAL)
                                            ZkAdjustParam.CONTRAST -> params.copy(contrast = v, preset = ZkPhotoFilterPreset.ORIGINAL)
                                            ZkAdjustParam.SATURATION -> params.copy(saturation = v, preset = ZkPhotoFilterPreset.ORIGINAL)
                                            ZkAdjustParam.WARMTH -> params.copy(warmth = v, preset = ZkPhotoFilterPreset.ORIGINAL)
                                        }
                                    },
                                    onValueChangeFinished = {
                                        undoStack = (undoStack + params).takeLast(30)
                                        redoStack = emptyList()
                                    },
                                    valueRange = -100f..100f,
                                    colors = SliderDefaults.colors(
                                        thumbColor = Color.White,
                                        activeTrackColor = Color(0xFF38BDF8),
                                        inactiveTrackColor = Color(0xFF28344A)
                                    )
                                )
                            }
                        }

                        ZkEditorTab.CROP -> {
                            // 1-tap rotate & flip strip
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceEvenly
                            ) {
                                TextButton(onClick = {
                                    pushParams(params.copy(rotationDeg = (params.rotationDeg + 270) % 360, cropBox = ZkNormalizedCropBox()))
                                }) {
                                    Icon(Icons.AutoMirrored.Filled.RotateLeft, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("-90°", color = Color.White, style = MaterialTheme.typography.labelMedium)
                                }
                                TextButton(onClick = {
                                    pushParams(params.copy(rotationDeg = (params.rotationDeg + 90) % 360, cropBox = ZkNormalizedCropBox()))
                                }) {
                                    Icon(Icons.AutoMirrored.Filled.RotateRight, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("+90°", color = Color.White, style = MaterialTheme.typography.labelMedium)
                                }
                                TextButton(onClick = {
                                    pushParams(params.copy(flipH = !params.flipH))
                                }) {
                                    Icon(Icons.Default.Flip, contentDescription = null, tint = if (params.flipH) Color(0xFF38BDF8) else Color.White, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Specchia O", color = if (params.flipH) Color(0xFF38BDF8) else Color.White, style = MaterialTheme.typography.labelMedium)
                                }
                                TextButton(onClick = {
                                    pushParams(params.copy(flipV = !params.flipV))
                                }) {
                                    Icon(Icons.Default.Flip, contentDescription = null, tint = if (params.flipV) Color(0xFF38BDF8) else Color.White, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Specchia V", color = if (params.flipV) Color(0xFF38BDF8) else Color.White, style = MaterialTheme.typography.labelMedium)
                                }
                            }

                            // Aspect ratio presets
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                val srcW = previewBitmap?.width ?: originalBitmap?.width ?: 1000
                                val srcH = previewBitmap?.height ?: originalBitmap?.height ?: 1000
                                ZkCropAspect.entries.forEach { aspect ->
                                    val selected = params.aspect == aspect
                                    OutlinedButton(
                                        onClick = {
                                            pushParams(
                                                params.copy(
                                                    aspect = aspect,
                                                    cropBox = ZkCropBoxMath.fitAspect(srcW, srcH, aspect)
                                                )
                                            )
                                        },
                                        colors = ButtonDefaults.outlinedButtonColors(
                                            containerColor = if (selected) Color(0xFF0284C7) else Color(0xFF111827)
                                        ),
                                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text(
                                            text = aspect.label,
                                            color = Color.White,
                                            style = MaterialTheme.typography.labelSmall,
                                            maxLines = 1
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Bottom 3-tab selector (Filtri / Regola / Ritaglia)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        ZkEditorTab.entries.forEach { tab ->
                            val selected = activeTab == tab
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (selected) Color(0xFF1D283A) else Color.Transparent,
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable {
                                        onUserActivity()
                                        activeTab = tab
                                    }
                            ) {
                                Row(
                                    horizontalArrangement = Arrangement.Center,
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(vertical = 8.dp)
                                ) {
                                    Icon(
                                        imageVector = tab.icon,
                                        contentDescription = null,
                                        tint = if (selected) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        text = tab.label,
                                        color = if (selected) Color.White else Color(0xFF94A3B8),
                                        style = MaterialTheme.typography.labelMedium,
                                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
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
