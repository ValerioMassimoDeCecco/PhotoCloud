package com.valerio.photocloud.zk

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Plaintext EXIF subset embedded inside `encMeta` (compatible with Web SDK `BlobPlaintextMeta`).
 * GPS fields (`lat`, `lon`, `altitude`) are NEVER populated unless `includeGps = true` is explicitly passed.
 */
data class ZkPlaintextExifSubset(
    val make: String? = null,
    val model: String? = null,
    val lensModel: String? = null,
    val fNumber: Double? = null,
    val exposureTime: String? = null,
    val iso: Int? = null,
    val focalLength: Double? = null,
    val lat: Double? = null,
    val lon: Double? = null,
    val altitude: Double? = null
) {
    fun withoutGps(): ZkPlaintextExifSubset {
        return copy(lat = null, lon = null, altitude = null)
    }

    fun isEmpty(): Boolean {
        return make == null &&
            model == null &&
            lensModel == null &&
            fNumber == null &&
            exposureTime == null &&
            iso == null &&
            focalLength == null &&
            lat == null &&
            lon == null &&
            altitude == null
    }

    fun toJson(): JSONObject {
        return JSONObject().apply {
            if (!make.isNullOrBlank()) put("make", make)
            if (!model.isNullOrBlank()) put("model", model)
            if (!lensModel.isNullOrBlank()) put("lensModel", lensModel)
            if (fNumber != null) put("fNumber", fNumber)
            if (!exposureTime.isNullOrBlank()) put("exposureTime", exposureTime)
            if (iso != null) put("iso", iso)
            if (focalLength != null) put("focalLength", focalLength)
            if (lat != null) put("lat", lat)
            if (lon != null) put("lon", lon)
            if (altitude != null) put("altitude", altitude)
        }
    }

    companion object {
        fun fromJson(obj: JSONObject?): ZkPlaintextExifSubset? {
            if (obj == null) return null
            val parsed = ZkPlaintextExifSubset(
                make = if (obj.has("make") && !obj.isNull("make")) obj.optString("make") else null,
                model = if (obj.has("model") && !obj.isNull("model")) obj.optString("model") else null,
                lensModel = if (obj.has("lensModel") && !obj.isNull("lensModel")) obj.optString("lensModel") else null,
                fNumber = if (obj.has("fNumber") && !obj.isNull("fNumber")) obj.optDouble("fNumber") else null,
                exposureTime = if (obj.has("exposureTime") && !obj.isNull("exposureTime")) obj.optString("exposureTime") else null,
                iso = if (obj.has("iso") && !obj.isNull("iso")) obj.optInt("iso") else null,
                focalLength = if (obj.has("focalLength") && !obj.isNull("focalLength")) obj.optDouble("focalLength") else null,
                lat = if (obj.has("lat") && !obj.isNull("lat")) obj.optDouble("lat") else null,
                lon = if (obj.has("lon") && !obj.isNull("lon")) obj.optDouble("lon") else null,
                altitude = if (obj.has("altitude") && !obj.isNull("altitude")) obj.optDouble("altitude") else null
            )
            return if (parsed.isEmpty()) null else parsed
        }
    }
}

data class ZkThumbVariantMeta(
    val present: Boolean,
    val width: Int,
    val height: Int,
    val sizeBytes: Int
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("present", present)
            .put("width", width)
            .put("height", height)
            .put("sizeBytes", sizeBytes)
    }

    companion object {
        fun fromJson(obj: JSONObject?): ZkThumbVariantMeta? {
            if (obj == null) return null
            return ZkThumbVariantMeta(
                present = obj.optBoolean("present", false),
                width = obj.optInt("width", 0),
                height = obj.optInt("height", 0),
                sizeBytes = obj.optInt("sizeBytes", 0)
            )
        }
    }
}

data class ZkThumbsMeta(
    val sm: ZkThumbVariantMeta? = null,
    val md: ZkThumbVariantMeta? = null
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            if (sm != null) put("sm", sm.toJson())
            if (md != null) put("md", md.toJson())
        }
    }

    companion object {
        fun fromJson(obj: JSONObject?): ZkThumbsMeta? {
            if (obj == null) return null
            val sm = ZkThumbVariantMeta.fromJson(obj.optJSONObject("sm"))
            val md = ZkThumbVariantMeta.fromJson(obj.optJSONObject("md"))
            return if (sm == null && md == null) null else ZkThumbsMeta(sm = sm, md = md)
        }
    }
}

/**
 * Spec-compliant `encMeta` plaintext payload (`docs/zk-spec.md` §5, aligned with `src/lib/zk/metaAndDedup.ts`).
 */
data class ZkBlobPlaintextMeta(
    val v: Int = 1,
    val name: String,
    val mime: String,
    val size: Long,
    val takenAt: Long? = null,
    val createdAt: Long,
    val width: Int? = null,
    val height: Int? = null,
    val duration: Double? = null,
    val isFavorite: Boolean = false,
    val exifSubset: ZkPlaintextExifSubset? = null,
    val dedupTag: String? = null,
    val thumbs: ZkThumbsMeta? = null
) {
    fun toJsonString(): String {
        val obj = JSONObject()
            .put("v", v)
            .put("name", name)
            .put("mime", mime)
            .put("size", size)
            .put("createdAt", createdAt)
        if (takenAt != null) obj.put("takenAt", takenAt)
        if (width != null) obj.put("width", width)
        if (height != null) obj.put("height", height)
        if (duration != null) obj.put("duration", duration)
        if (isFavorite) obj.put("isFavorite", true)
        if (exifSubset != null && !exifSubset.isEmpty()) obj.put("exifSubset", exifSubset.toJson())
        if (!dedupTag.isNullOrBlank()) obj.put("dedupTag", dedupTag)
        if (thumbs != null) obj.put("thumbs", thumbs.toJson())
        return obj.toString()
    }

    companion object {
        fun fromJsonString(jsonText: String): ZkBlobPlaintextMeta {
            val obj = JSONObject(jsonText)
            return ZkBlobPlaintextMeta(
                v = obj.optInt("v", 1),
                name = obj.optString("name", "file"),
                mime = obj.optString("mime", "application/octet-stream"),
                size = obj.optLong("size", 0L),
                takenAt = if (obj.has("takenAt") && !obj.isNull("takenAt")) obj.optLong("takenAt") else null,
                createdAt = obj.optLong("createdAt", 0L),
                width = if (obj.has("width") && !obj.isNull("width")) obj.optInt("width") else null,
                height = if (obj.has("height") && !obj.isNull("height")) obj.optInt("height") else null,
                duration = if (obj.has("duration") && !obj.isNull("duration")) obj.optDouble("duration") else null,
                isFavorite = obj.optBoolean("isFavorite", false),
                exifSubset = ZkPlaintextExifSubset.fromJson(obj.optJSONObject("exifSubset")),
                dedupTag = if (obj.has("dedupTag") && !obj.isNull("dedupTag")) obj.optString("dedupTag") else null,
                thumbs = ZkThumbsMeta.fromJson(obj.optJSONObject("thumbs"))
            )
        }
    }
}

data class ZkMetaBuildInput(
    val name: String,
    val mime: String,
    val sizeBytes: Long,
    val takenAtMs: Long? = null,
    val createdAtMs: Long = System.currentTimeMillis(),
    val width: Int? = null,
    val height: Int? = null,
    val durationSec: Double? = null,
    val rawExif: ZkPlaintextExifSubset? = null,
    val includeGps: Boolean = false,
    val dedupTag: String? = null,
    val thumbs: ZkThumbsMeta? = null
)

fun interface ZkMetaBuilder {
    fun build(input: ZkMetaBuildInput): ZkBlobPlaintextMeta
}

/**
 * Default metadata builder enforcing GPS exclusion by default (`includeGps = false`).
 */
object DefaultZkMetaBuilder : ZkMetaBuilder {
    override fun build(input: ZkMetaBuildInput): ZkBlobPlaintextMeta {
        val sanitizedExif = input.rawExif?.let { exif ->
            val filtered = if (input.includeGps) exif else exif.withoutGps()
            if (filtered.isEmpty()) null else filtered
        }
        return ZkBlobPlaintextMeta(
            v = 1,
            name = input.name.ifBlank { "file" },
            mime = input.mime.ifBlank { "application/octet-stream" },
            size = input.sizeBytes.coerceAtLeast(0L),
            takenAt = input.takenAtMs,
            createdAt = input.createdAtMs,
            width = input.width,
            height = input.height,
            duration = input.durationSec,
            isFavorite = false,
            exifSubset = sanitizedExif,
            dedupTag = input.dedupTag,
            thumbs = input.thumbs
        )
    }
}

data class ZkThumbData(
    val jpegBytes: ByteArray,
    val width: Int,
    val height: Int
) {
    fun zeroize() = jpegBytes.zeroize()
}

data class ZkThumbPair(
    val sm320: ZkThumbData? = null,
    val md1280: ZkThumbData? = null
) {
    fun toThumbsMeta(): ZkThumbsMeta? {
        val sm = sm320?.let { ZkThumbVariantMeta(true, it.width, it.height, it.jpegBytes.size) }
        val md = md1280?.let { ZkThumbVariantMeta(true, it.width, it.height, it.jpegBytes.size) }
        return if (sm == null && md == null) null else ZkThumbsMeta(sm = sm, md = md)
    }

    fun zeroizeAll() {
        sm320?.zeroize()
        md1280?.zeroize()
    }
}

/**
 * Pure interface for client-side thumbnail generation (320px and 1280px variants).
 * Plaintext thumbnails stay strictly in RAM and are zeroized after AEAD encryption.
 */
interface ZkThumbnailGenerator {
    suspend fun generate(source: ZkPlaintextSource): ZkThumbPair
}

object NoOpZkThumbnailGenerator : ZkThumbnailGenerator {
    override suspend fun generate(source: ZkPlaintextSource): ZkThumbPair = ZkThumbPair()
}

/**
 * Android on-device thumbnail generator with anti-OOM subsampling (`inJustDecodeBounds` + power-of-2
 * `inSampleSize`), EXIF orientation correction, and `MediaMetadataRetriever` video poster extraction.
 * Never writes any plaintext image or video frame to disk.
 */
class AndroidZkThumbnailGenerator(
    private val context: Context
) : ZkThumbnailGenerator {

    companion object {
        const val SM_MAX_EDGE = 320
        const val MD_MAX_EDGE = 1280
        const val MAX_THUMB_BYTES = 1_800_000 // safely below server 2 MiB ceiling
    }

    override suspend fun generate(source: ZkPlaintextSource): ZkThumbPair {
        val mime = source.mimeType.lowercase()
        val uri = (source as? AndroidUriPlaintextSource)?.uri
        return when {
            mime.startsWith("image/") -> generateImageThumbs(source)
            mime.startsWith("video/") && uri != null -> generateVideoThumbs(uri)
            else -> ZkThumbPair()
        }
    }

    private fun generateImageThumbs(source: ZkPlaintextSource): ZkThumbPair {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        source.openInputStream().use { input ->
            BitmapFactory.decodeStream(input, null, bounds)
        }
        val origW = bounds.outWidth
        val origH = bounds.outHeight
        if (origW <= 0 || origH <= 0) return ZkThumbPair()

        val orientation = readExifOrientation(source)
        val sampleSize = computePowerOfTwoSampleSize(origW, origH, MD_MAX_EDGE)
        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val sampled = source.openInputStream().use { input ->
            BitmapFactory.decodeStream(input, null, decodeOpts)
        } ?: return ZkThumbPair()

        var oriented: Bitmap = sampled
        try {
            oriented = applyExifOrientation(sampled, orientation)
            val md = scaleAndCompressJpeg(oriented, MD_MAX_EDGE, 82)
            val sm = scaleAndCompressJpeg(oriented, SM_MAX_EDGE, 78)
            return ZkThumbPair(sm320 = sm, md1280 = md)
        } finally {
            if (oriented !== sampled && !oriented.isRecycled) oriented.recycle()
            if (!sampled.isRecycled) sampled.recycle()
        }
    }

    private fun generateVideoThumbs(uri: Uri): ZkThumbPair {
        val retriever = MediaMetadataRetriever()
        var frame: Bitmap? = null
        return try {
            retriever.setDataSource(context.applicationContext, uri)
            frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.frameAtTime
            val bmp = frame ?: return ZkThumbPair()
            val md = scaleAndCompressJpeg(bmp, MD_MAX_EDGE, 80)
            val sm = scaleAndCompressJpeg(bmp, SM_MAX_EDGE, 75)
            ZkThumbPair(sm320 = sm, md1280 = md)
        } catch (_: Throwable) {
            ZkThumbPair()
        } finally {
            frame?.let { if (!it.isRecycled) it.recycle() }
            try {
                retriever.release()
            } catch (_: Throwable) {
            }
        }
    }

    private fun readExifOrientation(source: ZkPlaintextSource): Int {
        return try {
            source.openInputStream().use { input ->
                ExifInterface(input).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
                )
            }
        } catch (_: Throwable) {
            ExifInterface.ORIENTATION_NORMAL
        }
    }

    private fun applyExifOrientation(src: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(270f)
                matrix.postScale(-1f, 1f)
            }
            else -> return src
        }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
    }

    private fun scaleAndCompressJpeg(src: Bitmap, maxEdge: Int, initialQuality: Int): ZkThumbData? {
        val longest = max(src.width, src.height)
        val targetBitmap: Bitmap
        val createdScaled: Boolean
        if (longest > maxEdge) {
            val ratio = maxEdge.toFloat() / longest.toFloat()
            val targetW = max(1, (src.width * ratio).roundToInt())
            val targetH = max(1, (src.height * ratio).roundToInt())
            targetBitmap = Bitmap.createScaledBitmap(src, targetW, targetH, true)
            createdScaled = targetBitmap !== src
        } else {
            targetBitmap = src
            createdScaled = false
        }
        try {
            var quality = initialQuality
            while (quality >= 40) {
                val out = ByteArrayOutputStream()
                targetBitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
                val bytes = out.toByteArray()
                if (bytes.size <= MAX_THUMB_BYTES) {
                    return ZkThumbData(bytes, targetBitmap.width, targetBitmap.height)
                }
                bytes.zeroize()
                quality -= 15
            }
            return null
        } finally {
            if (createdScaled && !targetBitmap.isRecycled) {
                targetBitmap.recycle()
            }
        }
    }

    internal fun computePowerOfTwoSampleSize(width: Int, height: Int, maxEdge: Int): Int {
        var sample = 1
        var halfW = width / 2
        var halfH = height / 2
        while (max(halfW, halfH) >= maxEdge) {
            sample *= 2
            halfW /= 2
            halfH /= 2
        }
        return max(1, sample)
    }
}
