package com.valerio.photocloud

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.imageclassifier.ImageClassifier
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.Closeable
import java.io.File
import java.io.InputStream
import java.util.Locale

data class AiClassificationResult(
    val categories: List<String>,
    val topConfidence: Float,
    val usedGpuDelegate: Boolean
)

/**
 * Production-grade thread-safe On-Device AI Photo Categorizer powered by Google MediaPipe Tasks Vision
 * and EfficientNet-Lite (`efficientnet_lite4.tflite` bundled in `assets/`).
 *
 * Features:
 * - Resilient initialization: attempts hardware GPU delegate (`Delegate.GPU`) inside `try-catch (Throwable)`
 *   and automatically falls back to `Delegate.CPU` without ever crashing on unsupported GPU drivers/JNI.
 * - Anti-OOM pre-processing: decodes Uri/File bounds first, computes dynamic `inSampleSize`, scales to max
 *   `380x380px`, enforces `Bitmap.Config.ARGB_8888`, and applies EXIF orientation via `ExifInterface`.
 * - Thread-safe inference: guarded by `Mutex` on `Dispatchers.Default` with `scoreThreshold = 0.55f` and
 *   `maxResults = 4` (plus automatic fallback pass if fine-grained ImageNet synsets score below 0.55f).
 */
class LocalPhotoCategorizer(context: Context) : Closeable {

    private val appContext: Context = context.applicationContext
    private val classifierMutex = Mutex()

    @Volatile
    private var primaryClassifier: ImageClassifier? = null

    @Volatile
    private var fallbackLowThresholdClassifier: ImageClassifier? = null

    @Volatile
    var isUsingGpuDelegate: Boolean = false
        private set

    @Volatile
    private var isClosed: Boolean = false

    init {
        initializeClassifierWithFallback()
    }

    private fun initializeClassifierWithFallback() {
        // 1. Try GPU Delegate first inside try-catch (Throwable) to catch any JNI / OpenGL / OpenCL / Vulkan errors
        try {
            val gpuBaseOptions = BaseOptions.builder()
                .setDelegate(Delegate.GPU)
                .setModelAssetPath(MODEL_ASSET_PATH)
                .build()
            val gpuOptions = ImageClassifier.ImageClassifierOptions.builder()
                .setBaseOptions(gpuBaseOptions)
                .setScoreThreshold(SCORE_THRESHOLD)
                .setMaxResults(MAX_RESULTS)
                .build()
            primaryClassifier = ImageClassifier.createFromOptions(appContext, gpuOptions)
            isUsingGpuDelegate = true
            Log.i(TAG, "ImageClassifier initialized successfully with Delegate.GPU ($MODEL_ASSET_PATH)")
            return
        } catch (gpuError: Throwable) {
            Log.w(
                TAG,
                "GPU delegate initialization failed (${gpuError.javaClass.simpleName}: ${gpuError.message}); falling back immediately to Delegate.CPU",
                gpuError
            )
        }

        // 2. Resilient fallback to Delegate.CPU
        try {
            val cpuBaseOptions = BaseOptions.builder()
                .setDelegate(Delegate.CPU)
                .setModelAssetPath(MODEL_ASSET_PATH)
                .build()
            val cpuOptions = ImageClassifier.ImageClassifierOptions.builder()
                .setBaseOptions(cpuBaseOptions)
                .setScoreThreshold(SCORE_THRESHOLD)
                .setMaxResults(MAX_RESULTS)
                .build()
            primaryClassifier = ImageClassifier.createFromOptions(appContext, cpuOptions)
            isUsingGpuDelegate = false
            Log.i(TAG, "ImageClassifier initialized successfully with Delegate.CPU fallback ($MODEL_ASSET_PATH)")
        } catch (cpuError: Throwable) {
            Log.e(TAG, "CPU delegate initialization failed: ${cpuError.message}", cpuError)
            primaryClassifier = null
            isUsingGpuDelegate = false
        }
    }

    private fun getOrCreateSecondaryClassifier(): ImageClassifier? {
        fallbackLowThresholdClassifier?.let { return it }
        return try {
            val cpuBase = BaseOptions.builder()
                .setDelegate(Delegate.CPU)
                .setModelAssetPath(MODEL_ASSET_PATH)
                .build()
            val opts = ImageClassifier.ImageClassifierOptions.builder()
                .setBaseOptions(cpuBase)
                .setScoreThreshold(0.18f)
                .setMaxResults(MAX_RESULTS)
                .build()
            ImageClassifier.createFromOptions(appContext, opts).also {
                fallbackLowThresholdClassifier = it
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Secondary classifier creation skipped: ${t.message}")
            null
        }
    }

    /**
     * Classifies an image from a ContentResolver [Uri] without ever loading full resolution in memory.
     */
    suspend fun classifyUri(uri: Uri): AiClassificationResult = withContext(Dispatchers.Default) {
        val bitmap = decodeAndPrepareBitmapFromUri(uri, MAX_INFERENCE_DIMENSION)
            ?: return@withContext AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)
        try {
            classifyPreparedBitmap(bitmap)
        } finally {
            if (!bitmap.isRecycled) {
                try {
                    bitmap.recycle()
                } catch (_: Throwable) {
                }
            }
        }
    }

    /**
     * Classifies an image from a local [File] without ever loading full resolution in memory.
     */
    suspend fun classifyFile(file: File): AiClassificationResult = withContext(Dispatchers.Default) {
        if (!file.exists() || file.length() <= 0L) {
            return@withContext AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)
        }
        val bitmap = decodeAndPrepareBitmapFromFile(file, MAX_INFERENCE_DIMENSION)
            ?: return@withContext AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)
        try {
            classifyPreparedBitmap(bitmap)
        } finally {
            if (!bitmap.isRecycled) {
                try {
                    bitmap.recycle()
                } catch (_: Throwable) {
                }
            }
        }
    }

    /**
     * Classifies an existing [Bitmap], scaling to max 380x380 and ensuring `ARGB_8888`.
     */
    suspend fun classifyBitmap(source: Bitmap): AiClassificationResult = withContext(Dispatchers.Default) {
        val prepared = ensureMaxDimensionAndArgb8888(source, MAX_INFERENCE_DIMENSION, recycleInputIfDifferent = false)
            ?: return@withContext AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)
        try {
            classifyPreparedBitmap(prepared)
        } finally {
            if (prepared !== source && !prepared.isRecycled) {
                try {
                    prepared.recycle()
                } catch (_: Throwable) {
                }
            }
        }
    }

    private suspend fun classifyPreparedBitmap(argbBitmap: Bitmap): AiClassificationResult =
        classifierMutex.withLock {
            if (isClosed) {
                return@withLock AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)
            }
            val classifier = primaryClassifier
                ?: return@withLock AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)

            return@withLock try {
                val mpImage = BitmapImageBuilder(argbBitmap).build()
                var result = try {
                    classifier.classify(mpImage)
                } catch (gpuRuntimeErr: Throwable) {
                    // If GPU execution fails mid-run on a tricky device driver, switch seamlessly to CPU
                    Log.w(TAG, "Runtime inference failed on current delegate, switching to CPU delegate", gpuRuntimeErr)
                    switchToCpuClassifierLocked()
                    primaryClassifier?.classify(mpImage)
                }

                var rawCategories = result?.classificationResult()
                    ?.classifications()
                    ?.firstOrNull()
                    ?.categories()
                    .orEmpty()

                if (rawCategories.isEmpty()) {
                    // Fine-grained ImageNet 1000-class distributions often spread probability across closely
                    // related breeds/synsets; query secondary pass so every valid photo receives clean tags.
                    val secondary = getOrCreateSecondaryClassifier()
                    val secondaryRes = secondary?.classify(mpImage)
                    rawCategories = secondaryRes?.classificationResult()
                        ?.classifications()
                        ?.firstOrNull()
                        ?.categories()
                        .orEmpty()
                }

                if (rawCategories.isEmpty()) {
                    AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)
                } else {
                    val topScore = rawCategories.maxOfOrNull { it.score() } ?: 0f
                    val formattedSet = LinkedHashSet<String>()
                    for (cat in rawCategories.sortedByDescending { it.score() }) {
                        val rawName = cat.displayName().takeIf { !it.isNullOrBlank() }
                            ?: cat.categoryName()
                            ?: continue
                        val macroCategory = mapToSemanticMacroCategory(rawName)
                        if (macroCategory != null) {
                            formattedSet.add(macroCategory)
                        }
                        val cleanedLabel = formatReadableLabel(rawName)
                        if (cleanedLabel.isNotBlank()) {
                            formattedSet.add(cleanedLabel)
                        }
                        if (formattedSet.size >= MAX_RESULTS) break
                    }
                    AiClassificationResult(
                        categories = formattedSet.take(MAX_RESULTS),
                        topConfidence = topScore,
                        usedGpuDelegate = isUsingGpuDelegate
                    )
                }
            } catch (t: Throwable) {
                Log.w(TAG, "Error during image classification: ${t.message}", t)
                AiClassificationResult(emptyList(), 0f, isUsingGpuDelegate)
            }
        }

    private fun switchToCpuClassifierLocked() {
        try {
            primaryClassifier?.close()
        } catch (_: Throwable) {
        }
        try {
            val cpuBase = BaseOptions.builder()
                .setDelegate(Delegate.CPU)
                .setModelAssetPath(MODEL_ASSET_PATH)
                .build()
            val cpuOpts = ImageClassifier.ImageClassifierOptions.builder()
                .setBaseOptions(cpuBase)
                .setScoreThreshold(SCORE_THRESHOLD)
                .setMaxResults(MAX_RESULTS)
                .build()
            primaryClassifier = ImageClassifier.createFromOptions(appContext, cpuOpts)
            isUsingGpuDelegate = false
        } catch (t: Throwable) {
            Log.e(TAG, "Failed switching to CPU classifier: ${t.message}", t)
            primaryClassifier = null
        }
    }

    private fun decodeAndPrepareBitmapFromUri(uri: Uri, reqMaxDim: Int): Bitmap? {
        return try {
            val resolver = appContext.contentResolver
            val boundsOptions = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            resolver.openInputStream(uri)?.use { stream ->
                BitmapFactory.decodeStream(stream, null, boundsOptions)
            }
            if (boundsOptions.outWidth <= 0 || boundsOptions.outHeight <= 0) return null

            val sampleSize = calculateInSampleSize(boundsOptions.outWidth, boundsOptions.outHeight, reqMaxDim)
            val decodeOptions = BitmapFactory.Options().apply {
                inSampleSize = sampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
                inMutable = false
            }

            val sampledBitmap = resolver.openInputStream(uri)?.use { stream ->
                BitmapFactory.decodeStream(stream, null, decodeOptions)
            } ?: return null

            val exifOrientation = resolver.openInputStream(uri)?.use { exifStream ->
                readExifOrientation(exifStream)
            } ?: ExifInterface.ORIENTATION_NORMAL

            val oriented = applyExifOrientation(sampledBitmap, exifOrientation)
            ensureMaxDimensionAndArgb8888(oriented, reqMaxDim, recycleInputIfDifferent = true)
        } catch (t: Throwable) {
            Log.w(TAG, "Failed decoding Uri $uri for AI classification: ${t.message}")
            null
        }
    }

    private fun decodeAndPrepareBitmapFromFile(file: File, reqMaxDim: Int): Bitmap? {
        return try {
            val boundsOptions = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(file.absolutePath, boundsOptions)
            if (boundsOptions.outWidth <= 0 || boundsOptions.outHeight <= 0) return null

            val sampleSize = calculateInSampleSize(boundsOptions.outWidth, boundsOptions.outHeight, reqMaxDim)
            val decodeOptions = BitmapFactory.Options().apply {
                inSampleSize = sampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
                inMutable = false
            }

            val sampledBitmap = BitmapFactory.decodeFile(file.absolutePath, decodeOptions) ?: return null
            val exifOrientation = try {
                ExifInterface(file.absolutePath).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
                )
            } catch (_: Throwable) {
                ExifInterface.ORIENTATION_NORMAL
            }

            val oriented = applyExifOrientation(sampledBitmap, exifOrientation)
            ensureMaxDimensionAndArgb8888(oriented, reqMaxDim, recycleInputIfDifferent = true)
        } catch (t: Throwable) {
            Log.w(TAG, "Failed decoding File ${file.name} for AI classification: ${t.message}")
            null
        }
    }

    private fun readExifOrientation(inputStream: InputStream): Int {
        return try {
            val exif = ExifInterface(inputStream)
            exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Throwable) {
            ExifInterface.ORIENTATION_NORMAL
        }
    }

    private fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.preScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(270f)
                matrix.preScale(-1f, 1f)
            }
            else -> return bitmap
        }
        return try {
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            if (rotated !== bitmap && !bitmap.isRecycled) {
                try {
                    bitmap.recycle()
                } catch (_: Throwable) {
                }
            }
            rotated
        } catch (_: Throwable) {
            bitmap
        }
    }

    private fun ensureMaxDimensionAndArgb8888(
        source: Bitmap,
        maxDim: Int,
        recycleInputIfDifferent: Boolean
    ): Bitmap? {
        return try {
            var current = source
            val largestSide = maxOf(current.width, current.height)
            if (largestSide > maxDim && largestSide > 0) {
                val scale = maxDim.toFloat() / largestSide.toFloat()
                val targetW = (current.width * scale).toInt().coerceAtLeast(1)
                val targetH = (current.height * scale).toInt().coerceAtLeast(1)
                val scaled = Bitmap.createScaledBitmap(current, targetW, targetH, true)
                if (scaled !== current) {
                    if (recycleInputIfDifferent && !current.isRecycled) {
                        try {
                            current.recycle()
                        } catch (_: Throwable) {
                        }
                    }
                    current = scaled
                }
            }

            if (current.config != Bitmap.Config.ARGB_8888) {
                val argb = current.copy(Bitmap.Config.ARGB_8888, false)
                if (argb != null && argb !== current) {
                    if ((recycleInputIfDifferent || current !== source) && !current.isRecycled) {
                        try {
                            current.recycle()
                        } catch (_: Throwable) {
                        }
                    }
                    current = argb
                }
            }
            current
        } catch (_: Throwable) {
            null
        }
    }

    override fun close() {
        isClosed = true
        try {
            primaryClassifier?.close()
        } catch (_: Throwable) {
        } finally {
            primaryClassifier = null
        }
        try {
            fallbackLowThresholdClassifier?.close()
        } catch (_: Throwable) {
        } finally {
            fallbackLowThresholdClassifier = null
        }
    }

    companion object {
        private const val TAG = "LocalPhotoCategorizer"
        const val MODEL_ASSET_PATH = "efficientnet_lite4.tflite"
        const val SCORE_THRESHOLD = 0.55f
        const val MAX_RESULTS = 4
        const val MAX_INFERENCE_DIMENSION = 380

        fun calculateInSampleSize(outWidth: Int, outHeight: Int, reqMaxEdge: Int): Int {
            var inSampleSize = 1
            if (outHeight > reqMaxEdge || outWidth > reqMaxEdge) {
                val halfHeight = outHeight / 2
                val halfWidth = outWidth / 2
                while ((halfHeight / inSampleSize) >= reqMaxEdge && (halfWidth / inSampleSize) >= reqMaxEdge) {
                    inSampleSize *= 2
                }
            }
            return inSampleSize.coerceAtLeast(1)
        }

        /**
         * Cleans raw ImageNet labels (removes leading synset/numeric IDs, takes primary synonym,
         * replaces underscores, and capitalizes words cleanly).
         */
        fun formatReadableLabel(rawLabel: String): String {
            val withoutSynset = rawLabel
                .replace(Regex("^n?\\d{4,9}[_\\s:-]*"), "")
                .substringBefore(",")
                .replace('_', ' ')
                .trim()
            if (withoutSynset.isBlank()) return ""
            return withoutSynset
                .split(Regex("\\s+"))
                .filter { it.isNotBlank() }
                .joinToString(" ") { word ->
                    word.lowercase(Locale.getDefault()).replaceFirstChar { ch ->
                        if (ch.isLowerCase()) ch.titlecase(Locale.getDefault()) else ch.toString()
                    }
                }
        }

        /**
         * Maps fine-grained ImageNet 1000 synset names into intuitive gallery categories
         * so filter chips group related photos naturally alongside specific labels.
         */
        fun mapToSemanticMacroCategory(rawLabel: String): String? {
            val lower = rawLabel.lowercase(Locale.ROOT)
            return when {
                ANIMAL_KEYWORDS.any { lower.contains(it) } -> "Animali"
                LANDSCAPE_KEYWORDS.any { lower.contains(it) } -> "Paesaggi"
                FOOD_KEYWORDS.any { lower.contains(it) } -> "Cibo"
                VEHICLE_KEYWORDS.any { lower.contains(it) } -> "Veicoli"
                ARCHITECTURE_KEYWORDS.any { lower.contains(it) } -> "Architettura"
                DOCUMENT_KEYWORDS.any { lower.contains(it) } -> "Documenti"
                TECH_KEYWORDS.any { lower.contains(it) } -> "Tecnologia"
                PEOPLE_KEYWORDS.any { lower.contains(it) } -> "Persone"
                else -> null
            }
        }

        private val ANIMAL_KEYWORDS = listOf(
            "dog", "cat", "terrier", "retriever", "spaniel", "hound", "poodle", "pug", "husky",
            "shepherd", "bulldog", "collie", "chihuahua", "beagle", "rottweiler", "dalmatian",
            "tabby", "persian", "siamese", "bird", "eagle", "owl", "parrot", "macaw", "flamingo",
            "swan", "duck", "goose", "hen", "cock", "peacock", "horse", "zebra", "elephant",
            "lion", "tiger", "leopard", "cheetah", "bear", "panda", "koala", "monkey", "chimpanzee",
            "gorilla", "fox", "wolf", "deer", "rabbit", "hamster", "squirrel", "whale", "dolphin",
            "shark", "fish", "goldfish", "turtle", "frog", "lizard", "butterfly", "bee", "sheep", "cow"
        )

        private val LANDSCAPE_KEYWORDS = listOf(
            "alp", "mountain", "valley", "volcano", "cliff", "promontory", "seashore", "coast",
            "sandbar", "lakeside", "lakeshore", "coral reef", "geyser", "waterfall", "forest",
            "woods", "meadow", "hay", "rapeseed", "daisy", "sunflower", "rose", "tulip", "orchid",
            "mushroom", "tree", "palm", "beach", "ocean", "sea", "sky", "sunset", "island"
        )

        private val FOOD_KEYWORDS = listOf(
            "pizza", "espresso", "coffee", "cup", "ice cream", "gelato", "cheeseburger", "hotdog",
            "sandwich", "bagel", "pretzel", "croissant", "bakery", "cake", "chocolate", "strawberry",
            "orange", "lemon", "banana", "apple", "pineapple", "pomegranate", "fig", "broccoli",
            "cauliflower", "mushroom", "pepper", "cucumber", "artichoke", "pasta", "carbonara",
            "lasagna", "sushi", "soup", "guacamole", "burrito", "wine", "beer", "cocktail", "plate"
        )

        private val VEHICLE_KEYWORDS = listOf(
            "sports car", "convertible", "cab", "minivan", "limousine", "jeep", "pickup", "truck",
            "trailer", "ambulance", "fire engine", "police van", "racer", "car wheel", "bicycle",
            "mountain bike", "moped", "scooter", "motor scooter", "motorcycle", "train", "locomotive",
            "airliner", "airplane", "warplane", "helicopter", "speedboat", "catamaran", "sailboat",
            "yacht", "liner", "ship", "canoe", "gondola", "tram", "bus", "trolleybus"
        )

        private val ARCHITECTURE_KEYWORDS = listOf(
            "castle", "palace", "monastery", "church", "cathedral", "mosque", "stupas", "pagoda",
            "dome", "bell cote", "triumphal arch", "bridge", "suspension bridge", "viaduct",
            "fountain", "obelisk", "totem pole", "lighthouse", "barn", "boathouse", "greenhouse",
            "patio", " veranda", "balcony", "library", "bookshop", "restaurant", "cinema", "theater",
            "home", "living room", "dining", "bedroom", "skyscraper", "tower"
        )

        private val DOCUMENT_KEYWORDS = listOf(
            "book jacket", "comic book", "crossword", "menu", "envelope", "binder", "notebook",
            "web site", "newspaper", "magazine", "letter", "document", "receipt", "screen"
        )

        private val TECH_KEYWORDS = listOf(
            "laptop", "notebook computer", "desktop computer", "monitor", "screen", "television",
            "cellular telephone", "smartphone", "iPod", "keyboard", "mouse", "joystick", "camera",
            "reflex camera", "polaroid", "lens", "microphone", "headphone", "speaker", "watch"
        )

        private val PEOPLE_KEYWORDS = listOf(
            "groom", "bride", "scuba diver", "ballplayer", "swimmer", "suit", "Windsor tie",
            "sunglasses", "sombrero", "cowboy hat", "bonnet", "academic gown", "kimono",
            "miniskirt", "jeans", "trench coat", "cardigan", "sweatshirt", "jersey", "bikini", "wig"
        )
    }
}
