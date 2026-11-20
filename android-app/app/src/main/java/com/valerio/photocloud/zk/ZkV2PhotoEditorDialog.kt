package com.valerio.photocloud.zk

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import androidx.compose.foundation.Canvas as ComposeCanvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Compare
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.Redo
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.RotateLeft
import androidx.compose.material.icons.filled.RotateRight
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Undo
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class ZkPhotoFilterPreset(
    val label: String,
    val brightness: Float,
    val contrast: Float,
    val saturation: Float,
    val warmth: Float
) {
    ORIGINAL("Originale", 0f, 1f, 1f, 0f),
    VIVID("Vivido", 0.04f, 1.15f, 1.32f, 0.06f),
    BW("B&W", 0.02f, 1.18f, 0f, 0f),
    SEPIA("Seppia", 0.03f, 1.06f, 0.35f, 0.42f),
    CINEMA("Cinema", -0.04f, 1.22f, 0.88f, -0.08f),
    COOL("Freddo", 0f, 1.05f, 1.05f, -0.28f),
    VINTAGE("Vintage", 0.06f, 0.92f, 0.72f, 0.24f)
}

enum class ZkCropAspectPreset(val label: String, val ratio: Float?) {
    FREE("Libero", null),
    SQUARE("1:1", 1f),
    FOUR_THREE("4:3", 4f / 3f),
    FOUR_FIVE("4:5", 4f / 5f),
    SIXTEEN_NINE("16:9", 16f / 9f)
}

@Immutable
data class ZkPhotoEditParams(
    val brightness: Float = 0f,     // -0.5 .. +0.5
    val contrast: Float = 1f,       // 0.5 .. 1.8
    val saturation: Float = 1f,     // 0.0 .. 2.0
    val warmth: Float = 0f,         // -0.5 .. +0.5
    val rotationDeg: Int = 0,       // 0, 90, 180, 270
    val flipHorizontal: Boolean = false,
    val flipVertical: Boolean = false,
    val cropInsetFraction: Float = 0f, // 0 .. 0.35 uniform trim
    val cropAspect: ZkCropAspectPreset = ZkCropAspectPreset.FREE,
    val activePreset: ZkPhotoFilterPreset = ZkPhotoFilterPreset.ORIGINAL
) {
    fun isIdentity(): Boolean =
        brightness == 0f &&
            contrast == 1f &&
            saturation == 1f &&
            warmth == 0f &&
            (rotationDeg % 360 == 0) &&
            !flipHorizontal &&
            !flipVertical &&
            cropInsetFraction == 0f &&
            cropAspect == ZkCropAspectPreset.FREE
}

private enum class EditorToolTab(val label: String) {
    FILTERS("Filtri"),
    ADJUST("Regola"),
    CROP("Ritaglia & Ruota")
}

internal object ZkPhotoBitmapProcessor {
    fun buildColorMatrix(params: ZkPhotoEditParams): ColorMatrix {
        val result = ColorMatrix()

        // Saturation
        val satMatrix = ColorMatrix().apply { setSaturation(params.saturation.coerceIn(0f, 2f)) }
        result.postConcat(satMatrix)

        // Contrast & Brightness
        val c = params.contrast.coerceIn(0.4f, 2.0f)
        val b = (params.brightness.coerceIn(-0.6f, 0.6f) * 255f)
        val t = (-0.5f * c + 0.5f) * 255f + b
        val bcMatrix = ColorMatrix(
            floatArrayOf(
                c, 0f, 0f, 0f, t,
                0f, c, 0f, 0f, t,
                0f, 0f, c, 0f, t,
                0f, 0f, 0f, 1f, 0f
            )
        )
        result.postConcat(bcMatrix)

        // Warmth (red/blue channel shift)
        val w = params.warmth.coerceIn(-0.6f, 0.6f)
        if (w != 0f) {
            val rGain = (1f + w * 0.28f).coerceIn(0.6f, 1.4f)
            val gGain = (1f + w * 0.06f).coerceIn(0.8f, 1.2f)
            val bGain = (1f - w * 0.28f).coerceIn(0.6f, 1.4f)
            val warmMatrix = ColorMatrix(
                floatArrayOf(
                    rGain, 0f, 0f, 0f, 0f,
                    0f, gGain, 0f, 0f, 0f,
                    0f, 0f, bGain, 0f, 0f,
                    0f, 0f, 0f, 1f, 0f
                )
            )
            result.postConcat(warmMatrix)
        }
        return result
    }

    fun computeCropRect(width: Int, height: Int, params: ZkPhotoEditParams): Rect {
        val inset = params.cropInsetFraction.coerceIn(0f, 0.35f)
        var left = (width * inset).roundToInt()
        var top = (height * inset).roundToInt()
        var right = (width * (1f - inset)).roundToInt()
        var bottom = (height * (1f - inset)).roundToInt()

        val targetRatio = params.cropAspect.ratio
        if (targetRatio != null && targetRatio > 0f) {
            val curW = (right - left).coerceAtLeast(1)
            val curH = (bottom - top).coerceAtLeast(1)
            val curRatio = curW.toFloat() / curH.toFloat()
            if (curRatio > targetRatio) {
                val targetW = (curH * targetRatio).roundToInt().coerceIn(1, curW)
                val cx = (left + right) / 2
                left = cx - targetW / 2
                right = left + targetW
            } else {
                val targetH = (curW / targetRatio).roundToInt().coerceIn(1, curH)
                val cy = (top + bottom) / 2
                top = cy - targetH / 2
                bottom = top + targetH
            }
        }
        left = left.coerceIn(0, (width - 1).coerceAtLeast(0))
        top = top.coerceIn(0, (height - 1).coerceAtLeast(0))
        right = right.coerceIn(left + 1, width.coerceAtLeast(1))
        bottom = bottom.coerceIn(top + 1, height.coerceAtLeast(1))
        return Rect(left, top, right, bottom)
    }

    fun renderEditedBitmap(source: Bitmap, params: ZkPhotoEditParams): Bitmap {
        // 1. Apply rotation & flips
        val matrix = Matrix().apply {
            if (params.rotationDeg % 360 != 0) {
                postRotate((params.rotationDeg % 360).toFloat())
            }
            val sx = if (params.flipHorizontal) -1f else 1f
            val sy = if (params.flipVertical) -1f else 1f
            if (sx != 1f || sy != 1f) {
                postScale(sx, sy)
            }
        }
        val transformed = if (!matrix.isIdentity) {
            Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
        } else {
            source
        }

        // 2. Apply crop + color matrix in a single pass
        val cropRect = computeCropRect(transformed.width, transformed.height, params)
        val outW = cropRect.width().coerceAtLeast(1)
        val outH = cropRect.height().coerceAtLeast(1)
        val output = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            colorFilter = ColorMatrixColorFilter(buildColorMatrix(params))
        }
        canvas.drawBitmap(transformed, cropRect, Rect(0, 0, outW, outH), paint)
        if (transformed !== source) {
            transformed.recycle()
        }
        return output
    }

    fun encodeJpeg(bitmap: Bitmap, quality: Int = 92): ByteArray {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(60, 100), out)
        return out.toByteArray()
    }

    fun generateThumbJpeg(source: Bitmap, maxEdge: Int, quality: Int = 84): ByteArray {
        val w = source.width
        val h = source.height
        val longest = max(w, h)
        val scaled = if (longest > maxEdge) {
            val scale = maxEdge.toFloat() / longest.toFloat()
            Bitmap.createScaledBitmap(
                source,
                max(1, (w * scale).roundToInt()),
                max(1, (h * scale).roundToInt()),
                true
            )
        } else {
            source
        }
        return try {
            encodeJpeg(scaled, quality)
        } finally {
            if (scaled !== source) scaled.recycle()
        }
    }
}

/**
 * Full Client-Side E2EE Photo Editor Dialog for Android Zero-Knowledge v2.
 * All decryption, pixel rendering, and thumbnail generation run strictly in RAM.
 */
@Composable
fun ZkV2PhotoEditorDialog(
    item: DecryptedZkItem,
    repository: ZkVaultRepository,
    onDismiss: () -> Unit,
    onSavedCopy: (DecryptedZkItem) -> Unit,
    onOverwritten: (DecryptedZkItem) -> Unit
) {
    val scope = rememberCoroutineScope()
    var originalBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var previewBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var isSaving by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    var params by remember { mutableStateOf(ZkPhotoEditParams()) }
    var undoStack by remember { mutableStateOf<List<ZkPhotoEditParams>>(emptyList()) }
    var redoStack by remember { mutableStateOf<List<ZkPhotoEditParams>>(emptyList()) }
    var compareOriginal by remember { mutableStateOf(false) }
    var activeTab by remember { mutableStateOf(EditorToolTab.FILTERS) }

    fun pushParams(next: ZkPhotoEditParams) {
        if (next == params) return
        undoStack = (undoStack + params).takeLast(24)
        redoStack = emptyList()
        params = next
    }

    LaunchedEffect(item.blobId) {
        isLoading = true
        errorMessage = null
        try {
            val rawBytes = repository.decryptBlobToBytes(item.blobId)
            val decoded = withContext(Dispatchers.Default) {
                BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size)
            }
            rawBytes.zeroize()
            if (decoded == null) {
                errorMessage = "Impossibile decodificare l'immagine per la modifica."
            } else {
                originalBitmap = decoded
            }
        } catch (t: Throwable) {
            errorMessage = t.message ?: "Errore decifratura immagine."
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(originalBitmap, params, compareOriginal) {
        val orig = originalBitmap ?: return@LaunchedEffect
        val rendered = withContext(Dispatchers.Default) {
            // Downscale for snappy interactive preview in RAM
            val maxPreviewEdge = 1280
            val longest = max(orig.width, orig.height)
            val base = if (longest > maxPreviewEdge) {
                val scale = maxPreviewEdge.toFloat() / longest.toFloat()
                Bitmap.createScaledBitmap(
                    orig,
                    max(1, (orig.width * scale).roundToInt()),
                    max(1, (orig.height * scale).roundToInt()),
                    true
                )
            } else {
                orig
            }
            try {
                if (compareOriginal) {
                    base.copy(Bitmap.Config.ARGB_8888, false)
                } else {
                    ZkPhotoBitmapProcessor.renderEditedBitmap(base, params)
                }
            } finally {
                if (base !== orig) base.recycle()
            }
        }
        val oldPreview = previewBitmap
        previewBitmap = rendered
        if (oldPreview != null && oldPreview !== orig && !oldPreview.isRecycled) {
            oldPreview.recycle()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            previewBitmap?.let { if (it !== originalBitmap && !it.isRecycled) it.recycle() }
            originalBitmap?.let { if (!it.isRecycled) it.recycle() }
        }
    }

    fun exportAndSave(overwrite: Boolean) {
        val orig = originalBitmap ?: return
        if (isSaving) return
        scope.launch {
            isSaving = true
            errorMessage = null
            statusMessage = if (overwrite) "Cifratura e sovrascrittura E2EE..." else "Cifratura copia E2EE..."
            try {
                val rendered = withContext(Dispatchers.Default) {
                    ZkPhotoBitmapProcessor.renderEditedBitmap(orig, params)
                }
                val jpegBytes: ByteArray
                val thumb320: ByteArray
                val thumb1280: ByteArray
                val outW = rendered.width
                val outH = rendered.height
                try {
                    jpegBytes = withContext(Dispatchers.Default) {
                        ZkPhotoBitmapProcessor.encodeJpeg(rendered, 92)
                    }
                    thumb320 = withContext(Dispatchers.Default) {
                        ZkPhotoBitmapProcessor.generateThumbJpeg(rendered, 320, 82)
                    }
                    thumb1280 = withContext(Dispatchers.Default) {
                        ZkPhotoBitmapProcessor.generateThumbJpeg(rendered, 1280, 85)
                    }
                } finally {
                    if (!rendered.isRecycled) rendered.recycle()
                }

                try {
                    if (overwrite) {
                        val updated = repository.replaceItemWithEditedBytes(
                            item = item,
                            editedBytes = jpegBytes,
                            newWidth = outW,
                            newHeight = outH,
                            mime = "image/jpeg",
                            thumb320Jpeg = thumb320,
                            thumb1280Jpeg = thumb1280
                        )
                        onOverwritten(updated)
                    } else {
                        val baseName = item.meta.name.substringBeforeLast('.').ifBlank { "foto" }
                        val copyName = "${baseName}_modificata.jpg"
                        val created = repository.uploadEditedCopyBytes(
                            name = copyName,
                            mime = "image/jpeg",
                            editedBytes = jpegBytes,
                            width = outW,
                            height = outH,
                            takenAtMs = item.meta.takenAt,
                            exifSubset = item.meta.exifSubset,
                            thumb320Jpeg = thumb320,
                            thumb1280Jpeg = thumb1280
                        )
                        onSavedCopy(created)
                    }
                } finally {
                    jpegBytes.zeroize()
                    thumb320.zeroize()
                    thumb1280.zeroize()
                }
            } catch (t: Throwable) {
                errorMessage = t.message ?: "Salvataggio cifrato fallito."
                statusMessage = null
            } finally {
                isSaving = false
            }
        }
    }

    Dialog(
        onDismissRequest = { if (!isSaving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Color(0xFF0A0B0E)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
            ) {
                // Top Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { if (!isSaving) onDismiss() }) {
                        Icon(Icons.Default.Close, contentDescription = "Chiudi", tint = Color(0xFFF3F4F6))
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Editor E2EE",
                            style = MaterialTheme.typography.titleMedium,
                            color = Color(0xFFF3F4F6),
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = item.meta.name,
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFF9CA3AF),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    IconButton(
                        enabled = undoStack.isNotEmpty() && !isSaving,
                        onClick = {
                            val prev = undoStack.lastOrNull() ?: return@IconButton
                            undoStack = undoStack.dropLast(1)
                            redoStack = redoStack + params
                            params = prev
                        }
                    ) {
                        Icon(
                            Icons.Default.Undo,
                            contentDescription = "Annulla",
                            tint = if (undoStack.isNotEmpty()) Color(0xFFF3F4F6) else Color(0xFF4B5563)
                        )
                    }
                    IconButton(
                        enabled = redoStack.isNotEmpty() && !isSaving,
                        onClick = {
                            val next = redoStack.lastOrNull() ?: return@IconButton
                            redoStack = redoStack.dropLast(1)
                            undoStack = undoStack + params
                            params = next
                        }
                    ) {
                        Icon(
                            Icons.Default.Redo,
                            contentDescription = "Ripeti",
                            tint = if (redoStack.isNotEmpty()) Color(0xFFF3F4F6) else Color(0xFF4B5563)
                        )
                    }
                    IconButton(
                        enabled = !params.isIdentity() && !isSaving,
                        onClick = { compareOriginal = !compareOriginal }
                    ) {
                        Icon(
                            Icons.Default.Compare,
                            contentDescription = "Confronta originale",
                            tint = if (compareOriginal) Color(0xFF38BDF8) else Color(0xFFD1D5DB)
                        )
                    }
                    IconButton(
                        enabled = !params.isIdentity() && !isSaving,
                        onClick = { pushParams(ZkPhotoEditParams()) }
                    ) {
                        Icon(
                            Icons.Default.RestartAlt,
                            contentDescription = "Ripristina",
                            tint = if (!params.isIdentity()) Color(0xFFF3F4F6) else Color(0xFF4B5563)
                        )
                    }
                }

                // Canvas Preview Area
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .background(Color(0xFF050608))
                        .padding(12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    when {
                        isLoading -> {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(color = Color(0xFF38BDF8))
                                Spacer(Modifier.height(10.dp))
                                Text("Decifratura foto in RAM...", color = Color(0xFF9CA3AF), fontSize = 13.sp)
                            }
                        }
                        previewBitmap != null -> {
                            val bmp = previewBitmap!!
                            Image(
                                bitmap = bmp.asImageBitmap(),
                                contentDescription = "Anteprima modifica",
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxSize()
                            )
                            if (activeTab == EditorToolTab.CROP && !compareOriginal) {
                                ComposeCanvas(modifier = Modifier.fillMaxSize().padding(18.dp)) {
                                    val thirdW = size.width / 3f
                                    val thirdH = size.height / 3f
                                    drawRect(
                                        color = Color(0xAA38BDF8),
                                        topLeft = Offset.Zero,
                                        size = Size(size.width, size.height),
                                        style = Stroke(width = 2f)
                                    )
                                    for (i in 1..2) {
                                        drawLine(
                                            color = Color(0x55FFFFFF),
                                            start = Offset(thirdW * i, 0f),
                                            end = Offset(thirdW * i, size.height),
                                            strokeWidth = 1f
                                        )
                                        drawLine(
                                            color = Color(0x55FFFFFF),
                                            start = Offset(0f, thirdH * i),
                                            end = Offset(size.width, thirdH * i),
                                            strokeWidth = 1f
                                        )
                                    }
                                }
                            }
                            if (compareOriginal) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopCenter)
                                        .background(Color(0xCC0F172A), RoundedCornerShape(6.dp))
                                        .padding(horizontal = 10.dp, vertical = 4.dp)
                                ) {
                                    Text("ORIGINALE", color = Color(0xFF38BDF8), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                        else -> {
                            Text(errorMessage ?: "Immagine non disponibile.", color = Color(0xFFF87171))
                        }
                    }

                    if (isSaving) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Color(0xAA000000)),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(color = Color(0xFF38BDF8))
                                Spacer(Modifier.height(10.dp))
                                Text(statusMessage ?: "Salvataggio E2EE...", color = Color(0xFFF3F4F6), fontSize = 13.sp)
                            }
                        }
                    }
                }

                if (errorMessage != null && !isLoading) {
                    Text(
                        text = errorMessage!!,
                        color = Color(0xFFF87171),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                    )
                }

                // Tool Controls Panel
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF11131A))
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Tab Switcher
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        EditorToolTab.entries.forEach { tab ->
                            val selected = activeTab == tab
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) Color(0xFF1E293B) else Color(0xFF161922))
                                    .border(
                                        1.dp,
                                        if (selected) Color(0xFF38BDF8) else Color(0xFF262A36),
                                        RoundedCornerShape(8.dp)
                                    )
                                    .clickable { activeTab = tab }
                                    .padding(vertical = 8.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = tab.label,
                                    color = if (selected) Color(0xFF38BDF8) else Color(0xFF9CA3AF),
                                    fontSize = 12.sp,
                                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
                                )
                            }
                        }
                    }

                    when (activeTab) {
                        EditorToolTab.FILTERS -> {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                ZkPhotoFilterPreset.entries.forEach { preset ->
                                    val selected = params.activePreset == preset
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(if (selected) Color(0xFF0C4A6E) else Color(0xFF1A1E29))
                                            .border(
                                                1.dp,
                                                if (selected) Color(0xFF38BDF8) else Color(0xFF2B3040),
                                                RoundedCornerShape(8.dp)
                                            )
                                            .clickable(enabled = !isSaving) {
                                                pushParams(
                                                    params.copy(
                                                        brightness = preset.brightness,
                                                        contrast = preset.contrast,
                                                        saturation = preset.saturation,
                                                        warmth = preset.warmth,
                                                        activePreset = preset
                                                    )
                                                )
                                            }
                                            .padding(horizontal = 14.dp, vertical = 10.dp)
                                    ) {
                                        Text(
                                            text = preset.label,
                                            color = if (selected) Color.White else Color(0xFFD1D5DB),
                                            fontSize = 13.sp,
                                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
                                        )
                                    }
                                }
                            }
                        }

                        EditorToolTab.ADJUST -> {
                            EditorSliderRow(
                                label = "Luminosità",
                                value = params.brightness,
                                range = -0.45f..0.45f,
                                displayValue = "${(params.brightness * 100).roundToInt()}%",
                                onValueChange = { params = params.copy(brightness = it) },
                                onValueChangeFinished = { pushParams(params) }
                            )
                            EditorSliderRow(
                                label = "Contrasto",
                                value = params.contrast,
                                range = 0.55f..1.75f,
                                displayValue = "${(params.contrast * 100).roundToInt()}%",
                                onValueChange = { params = params.copy(contrast = it) },
                                onValueChangeFinished = { pushParams(params) }
                            )
                            EditorSliderRow(
                                label = "Saturazione",
                                value = params.saturation,
                                range = 0f..1.9f,
                                displayValue = "${(params.saturation * 100).roundToInt()}%",
                                onValueChange = { params = params.copy(saturation = it) },
                                onValueChangeFinished = { pushParams(params) }
                            )
                            EditorSliderRow(
                                label = "Calore",
                                value = params.warmth,
                                range = -0.45f..0.45f,
                                displayValue = "${(params.warmth * 100).roundToInt()}%",
                                onValueChange = { params = params.copy(warmth = it) },
                                onValueChangeFinished = { pushParams(params) }
                            )
                        }

                        EditorToolTab.CROP -> {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedButton(
                                    onClick = { pushParams(params.copy(rotationDeg = (params.rotationDeg + 270) % 360)) },
                                    modifier = Modifier.weight(1f),
                                    enabled = !isSaving
                                ) {
                                    Icon(Icons.Default.RotateLeft, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("-90°", fontSize = 12.sp)
                                }
                                OutlinedButton(
                                    onClick = { pushParams(params.copy(rotationDeg = (params.rotationDeg + 90) % 360)) },
                                    modifier = Modifier.weight(1f),
                                    enabled = !isSaving
                                ) {
                                    Icon(Icons.Default.RotateRight, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("+90°", fontSize = 12.sp)
                                }
                                OutlinedButton(
                                    onClick = { pushParams(params.copy(flipHorizontal = !params.flipHorizontal)) },
                                    modifier = Modifier.weight(1f),
                                    enabled = !isSaving
                                ) {
                                    Icon(Icons.Default.Flip, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Specchia", fontSize = 12.sp)
                                }
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                ZkCropAspectPreset.entries.forEach { aspect ->
                                    val selected = params.cropAspect == aspect
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(if (selected) Color(0xFF0C4A6E) else Color(0xFF1A1E29))
                                            .border(
                                                1.dp,
                                                if (selected) Color(0xFF38BDF8) else Color(0xFF2B3040),
                                                RoundedCornerShape(8.dp)
                                            )
                                            .clickable(enabled = !isSaving) {
                                                pushParams(params.copy(cropAspect = aspect))
                                            }
                                            .padding(horizontal = 12.dp, vertical = 8.dp)
                                    ) {
                                        Text(
                                            text = aspect.label,
                                            color = if (selected) Color.White else Color(0xFFD1D5DB),
                                            fontSize = 12.sp
                                        )
                                    }
                                }
                            }
                            EditorSliderRow(
                                label = "Ritaglio zoom",
                                value = params.cropInsetFraction,
                                range = 0f..0.32f,
                                displayValue = "${(params.cropInsetFraction * 200).roundToInt()}%",
                                onValueChange = { params = params.copy(cropInsetFraction = it) },
                                onValueChangeFinished = { pushParams(params) }
                            )
                        }
                    }

                    // Action Buttons (Save Copy / Overwrite)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = { exportAndSave(overwrite = false) },
                            enabled = originalBitmap != null && !isSaving,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Salva copia", fontSize = 13.sp)
                        }
                        Button(
                            onClick = { exportAndSave(overwrite = true) },
                            enabled = originalBitmap != null && !isSaving,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Sovrascrivi", fontSize = 13.sp, color = Color.White)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EditorSliderRow(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    displayValue: String,
    onValueChange: (Float) -> Unit,
    onValueChangeFinished: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            color = Color(0xFFD1D5DB),
            fontSize = 12.sp,
            modifier = Modifier.width(88.dp)
        )
        Slider(
            value = value,
            onValueChange = onValueChange,
            onValueChangeFinished = onValueChangeFinished,
            valueRange = range,
            colors = SliderDefaults.colors(
                thumbColor = Color(0xFF38BDF8),
                activeTrackColor = Color(0xFF38BDF8),
                inactiveTrackColor = Color(0xFF2B3040)
            ),
            modifier = Modifier.weight(1f)
        )
        Text(
            text = displayValue,
            color = Color(0xFF9CA3AF),
            fontSize = 12.sp,
            modifier = Modifier.width(42.dp)
        )
    }
}
