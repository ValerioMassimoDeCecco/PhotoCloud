package com.valerio.photocloud

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteBuffer
import kotlin.coroutines.coroutineContext

data class AndroidVideoEditParams(
    val brightness: Float = 0f,
    val contrast: Float = 0f,
    val saturation: Float = 0f,
    val warmth: Float = 0f,
    val rotationDegrees: Int = 0,
    val flipH: Boolean = false,
    val flipV: Boolean = false,
    val cropRect: NormalizedAndroidCropRect = NormalizedAndroidCropRect(),
    val trimStartMs: Long = 0L,
    val trimEndMs: Long = 0L,
    val muteAudio: Boolean = false
)

data class AndroidVideoMetadata(
    val width: Int,
    val height: Int,
    val rotation: Int,
    val durationMs: Long
)

fun formatVideoDurationMs(ms: Long, withTenths: Boolean = false): String {
    val safeMs = ms.coerceAtLeast(0L)
    val totalSecs = safeMs / 1000L
    val hrs = totalSecs / 3600L
    val mins = (totalSecs % 3600L) / 60L
    val secs = totalSecs % 60L
    val tenths = ((safeMs % 1000L) / 100L).coerceIn(0L, 9L)
    val base = "${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}"
    val full = if (hrs > 0L) "$hrs:$base" else base
    return if (withTenths) "$full.$tenths" else full
}

fun readAndroidVideoMetadata(file: File): AndroidVideoMetadata {
    val retriever = MediaMetadataRetriever()
    return try {
        retriever.setDataSource(file.absolutePath)
        val rawW = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 1280
        val rawH = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 720
        val rot = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        val dur = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        val normRot = ((rot % 360) + 360) % 360
        val displayW = if (normRot == 90 || normRot == 270) rawH else rawW
        val displayH = if (normRot == 90 || normRot == 270) rawW else rawH
        AndroidVideoMetadata(
            width = displayW.coerceAtLeast(16),
            height = displayH.coerceAtLeast(16),
            rotation = normRot,
            durationMs = dur.coerceAtLeast(0L)
        )
    } catch (_: Exception) {
        AndroidVideoMetadata(1280, 720, 0, 0L)
    } finally {
        try {
            retriever.release()
        } catch (_: Exception) {
        }
    }
}

private fun buildColorFilterForVideo(
    brightness: Float,
    contrast: Float,
    saturation: Float,
    warmth: Float
): ColorMatrixColorFilter? {
    if (brightness == 0f && contrast == 0f && saturation == 0f && warmth == 0f) {
        return null
    }
    val satFactor = ((100f + saturation) / 100f).coerceAtLeast(0f)
    val satMatrix = ColorMatrix().apply { setSaturation(satFactor) }

    val cFactor = ((100f + contrast) / 100f).coerceAtLeast(0f)
    val cScale = cFactor * cFactor
    val bOffset = brightness * 1.6f + 128f * (1f - cScale)
    val rWarm = warmth * 0.45f
    val gWarm = warmth * 0.10f
    val bWarm = -warmth * 0.45f

    val adjustMatrix = ColorMatrix(
        floatArrayOf(
            cScale, 0f, 0f, 0f, bOffset + rWarm,
            0f, cScale, 0f, 0f, bOffset + gWarm,
            0f, 0f, cScale, 0f, bOffset + bWarm,
            0f, 0f, 0f, 1f, 0f
        )
    )
    satMatrix.postConcat(adjustMatrix)
    return ColorMatrixColorFilter(satMatrix)
}

suspend fun exportEditedVideoToFile(
    sourceFile: File,
    outputFile: File,
    params: AndroidVideoEditParams,
    onProgress: (Float) -> Unit
): Boolean = withContext(Dispatchers.Default) {
    val meta = readAndroidVideoMetadata(sourceFile)
    val totalDurMs = meta.durationMs.coerceAtLeast(500L)
    val startMs = params.trimStartMs.coerceIn(0L, (totalDurMs - 200L).coerceAtLeast(0L))
    val endMs = if (params.trimEndMs in (startMs + 150L)..totalDurMs) params.trimEndMs else totalDurMs
    val startUs = startMs * 1000L
    val endUs = endMs * 1000L

    val hasColorChanges = params.brightness != 0f ||
        params.contrast != 0f ||
        params.saturation != 0f ||
        params.warmth != 0f
    val hasCropChanges = params.cropRect.left > 0.01f ||
        params.cropRect.top > 0.01f ||
        params.cropRect.right < 0.99f ||
        params.cropRect.bottom < 0.99f
    val canFastRemux = !hasColorChanges && !hasCropChanges && !params.flipH && !params.flipV

    if (canFastRemux) {
        val remuxOk = runFastRemuxVideo(
            sourceFile = sourceFile,
            outputFile = outputFile,
            startUs = startUs,
            endUs = endUs,
            extraRotationDeg = params.rotationDegrees,
            sourceRotationDeg = meta.rotation,
            muteAudio = params.muteAudio,
            onProgress = onProgress
        )
        if (remuxOk) return@withContext true
    }

    transcodeVideoWithFiltersAndCrop(
        sourceFile = sourceFile,
        outputFile = outputFile,
        meta = meta,
        params = params,
        startUs = startUs,
        endUs = endUs,
        onProgress = onProgress
    )
}

private suspend fun runFastRemuxVideo(
    sourceFile: File,
    outputFile: File,
    startUs: Long,
    endUs: Long,
    extraRotationDeg: Int,
    sourceRotationDeg: Int,
    muteAudio: Boolean,
    onProgress: (Float) -> Unit
): Boolean {
    val extractor = MediaExtractor()
    var muxer: MediaMuxer? = null
    return try {
        extractor.setDataSource(sourceFile.absolutePath)
        val trackCount = extractor.trackCount
        muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        val trackIndexMap = mutableMapOf<Int, Int>()
        var videoTrackSrcIndex = -1
        var maxBufferSize = 256 * 1024

        for (i in 0 until trackCount) {
            val format = extractor.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            val isVideo = mime.startsWith("video/")
            val isAudio = mime.startsWith("audio/")
            if (isVideo || (isAudio && !muteAudio)) {
                val dstIdx = muxer.addTrack(format)
                trackIndexMap[i] = dstIdx
                extractor.selectTrack(i)
                if (isVideo) videoTrackSrcIndex = i
                if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    maxBufferSize = maxOf(maxBufferSize, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
                }
            }
        }

        if (trackIndexMap.isEmpty()) return false

        val finalRotation = ((sourceRotationDeg + extraRotationDeg) % 360 + 360) % 360
        muxer.setOrientationHint(finalRotation)
        muxer.start()

        val buffer = ByteBuffer.allocate(maxBufferSize.coerceIn(64 * 1024, 4 * 1024 * 1024))
        val bufferInfo = MediaCodec.BufferInfo()
        extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

        var firstSampleUs = -1L
        val spanUs = (endUs - startUs).coerceAtLeast(100_000L)

        while (true) {
            coroutineContext.ensureActive()
            val sampleTrack = extractor.sampleTrackIndex
            if (sampleTrack < 0) break

            val sampleTime = extractor.sampleTime
            if (sampleTime > endUs) {
                if (sampleTrack == videoTrackSrcIndex || videoTrackSrcIndex == -1) {
                    break
                } else {
                    extractor.advance()
                    continue
                }
            }

            val dstTrack = trackIndexMap[sampleTrack]
            if (dstTrack == null) {
                extractor.advance()
                continue
            }

            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) break

            if (firstSampleUs < 0L) {
                firstSampleUs = sampleTime
            }

            bufferInfo.offset = 0
            bufferInfo.size = size
            bufferInfo.presentationTimeUs = (sampleTime - firstSampleUs).coerceAtLeast(0L)
            @Suppress("WrongConstant")
            bufferInfo.flags = extractor.sampleFlags

            muxer.writeSampleData(dstTrack, buffer, bufferInfo)
            val progress = ((sampleTime - startUs).toFloat() / spanUs.toFloat()).coerceIn(0f, 0.98f)
            onProgress(progress)

            if (!extractor.advance()) break
        }

        onProgress(1f)
        outputFile.exists() && outputFile.length() > 1024L
    } catch (_: Exception) {
        false
    } finally {
        try {
            muxer?.stop()
        } catch (_: Exception) {
        }
        try {
            muxer?.release()
        } catch (_: Exception) {
        }
        try {
            extractor.release()
        } catch (_: Exception) {
        }
    }
}

private suspend fun transcodeVideoWithFiltersAndCrop(
    sourceFile: File,
    outputFile: File,
    meta: AndroidVideoMetadata,
    params: AndroidVideoEditParams,
    startUs: Long,
    endUs: Long,
    onProgress: (Float) -> Unit
): Boolean {
    val retriever = MediaMetadataRetriever()
    val audioExtractor = MediaExtractor()
    var encoder: MediaCodec? = null
    var muxer: MediaMuxer? = null

    return try {
        retriever.setDataSource(sourceFile.absolutePath)

        val normRot = ((params.rotationDegrees % 360) + 360) % 360
        val rotW = if (normRot == 90 || normRot == 270) meta.height else meta.width
        val rotH = if (normRot == 90 || normRot == 270) meta.width else meta.height

        val safeBox = clampAndroidCropRect(params.cropRect, 0.04f)
        val rawCropW = ((safeBox.right - safeBox.left) * rotW).coerceAtLeast(16f)
        val rawCropH = ((safeBox.bottom - safeBox.top) * rotH).coerceAtLeast(16f)
        val maxSide = maxOf(rawCropW, rawCropH)
        val scale = if (maxSide > 1280f) 1280f / maxSide else 1f

        val encW = (((rawCropW * scale).toInt() / 16) * 16).coerceIn(160, 1280)
        val encH = (((rawCropH * scale).toInt() / 16) * 16).coerceIn(160, 1280)

        val fps = 24
        val frameStepUs = 1_000_000L / fps
        val bitRate = (encW * encH * 4).coerceIn(1_500_000, 6_000_000)

        val videoFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, encW, encH).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        encoder.configure(videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val inputSurface = encoder.createInputSurface()
        encoder.start()

        muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        var audioTrackIndexSrc = -1
        var audioTrackFormat: MediaFormat? = null
        if (!params.muteAudio) {
            try {
                audioExtractor.setDataSource(sourceFile.absolutePath)
                for (i in 0 until audioExtractor.trackCount) {
                    val fmt = audioExtractor.getTrackFormat(i)
                    val mime = fmt.getString(MediaFormat.KEY_MIME) ?: ""
                    if (mime.startsWith("audio/")) {
                        audioTrackIndexSrc = i
                        audioTrackFormat = fmt
                        break
                    }
                }
            } catch (_: Exception) {
                audioTrackIndexSrc = -1
            }
        }

        var muxerStarted = false
        var muxerVideoTrack = -1
        var muxerAudioTrack = -1
        var writtenVideoFrames = 0L
        val encoderBufferInfo = MediaCodec.BufferInfo()

        val colorFilter = buildColorFilterForVideo(
            brightness = params.brightness,
            contrast = params.contrast,
            saturation = params.saturation,
            warmth = params.warmth
        )
        val framePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            this.colorFilter = colorFilter
        }

        fun drainVideoEncoder(endOfStream: Boolean) {
            val codec = encoder ?: return
            if (endOfStream) {
                codec.signalEndOfInputStream()
            }
            while (true) {
                val status = codec.dequeueOutputBuffer(encoderBufferInfo, 10_000L)
                if (status == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (!endOfStream) break
                } else if (status == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (!muxerStarted) {
                        val outFormat = codec.outputFormat
                        muxerVideoTrack = muxer!!.addTrack(outFormat)
                        if (audioTrackFormat != null) {
                            muxerAudioTrack = muxer!!.addTrack(audioTrackFormat!!)
                        }
                        muxer!!.start()
                        muxerStarted = true
                    }
                } else if (status >= 0) {
                    val encodedData = codec.getOutputBuffer(status)
                    if ((encoderBufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                        encoderBufferInfo.size = 0
                    }
                    if (encoderBufferInfo.size > 0 && muxerStarted && encodedData != null) {
                        encodedData.position(encoderBufferInfo.offset)
                        encodedData.limit(encoderBufferInfo.offset + encoderBufferInfo.size)
                        val syncedInfo = MediaCodec.BufferInfo().apply {
                            set(
                                encoderBufferInfo.offset,
                                encoderBufferInfo.size,
                                writtenVideoFrames * frameStepUs,
                                encoderBufferInfo.flags
                            )
                        }
                        muxer!!.writeSampleData(muxerVideoTrack, encodedData, syncedInfo)
                        writtenVideoFrames++
                    }
                    codec.releaseOutputBuffer(status, false)
                    if ((encoderBufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        break
                    }
                }
            }
        }

        val totalSpanUs = (endUs - startUs).coerceAtLeast(frameStepUs)
        var currentUs = startUs
        var outPtsUs = 0L

        while (currentUs <= endUs) {
            coroutineContext.ensureActive()
            val rawFrame: Bitmap? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                retriever.getScaledFrameAtTime(
                    currentUs,
                    MediaMetadataRetriever.OPTION_CLOSEST,
                    maxOf(meta.width, meta.height).coerceAtMost(1280),
                    maxOf(meta.width, meta.height).coerceAtMost(1280)
                )
            } else {
                retriever.getFrameAtTime(currentUs, MediaMetadataRetriever.OPTION_CLOSEST)
            }

            if (rawFrame != null) {
                val transformed = applyGeometryToVideoFrame(rawFrame, normRot, params.flipH, params.flipV)
                val canvas: Canvas = inputSurface.lockCanvas(null)
                try {
                    canvas.drawColor(Color.BLACK)
                    val tW = transformed.width.coerceAtLeast(1)
                    val tH = transformed.height.coerceAtLeast(1)
                    val cx = (safeBox.left * tW).toInt().coerceIn(0, tW - 1)
                    val cy = (safeBox.top * tH).toInt().coerceIn(0, tH - 1)
                    val cw = ((safeBox.right - safeBox.left) * tW).toInt().coerceIn(1, tW - cx)
                    val ch = ((safeBox.bottom - safeBox.top) * tH).toInt().coerceIn(1, tH - cy)
                    canvas.drawBitmap(transformed, Rect(cx, cy, cx + cw, cy + ch), Rect(0, 0, encW, encH), framePaint)
                } finally {
                    inputSurface.unlockCanvasAndPost(canvas)
                }
                if (transformed !== rawFrame) transformed.recycle()
                rawFrame.recycle()
            }

            drainVideoEncoder(endOfStream = false)

            val videoWeight = if (audioTrackIndexSrc >= 0) 0.9f else 0.98f
            val frac = ((currentUs - startUs).toFloat() / totalSpanUs.toFloat()).coerceIn(0f, 1f)
            onProgress(frac * videoWeight)

            currentUs += frameStepUs
            outPtsUs += frameStepUs
        }

        drainVideoEncoder(endOfStream = true)
        inputSurface.release()

        // Mux trimmed audio track when audio exists & muteAudio == false
        if (muxerStarted && audioTrackIndexSrc >= 0 && muxerAudioTrack >= 0) {
            audioExtractor.selectTrack(audioTrackIndexSrc)
            audioExtractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            val audioBuf = ByteBuffer.allocate(256 * 1024)
            val audioInfo = MediaCodec.BufferInfo()
            while (true) {
                coroutineContext.ensureActive()
                val t = audioExtractor.sampleTime
                if (t < 0 || t > endUs) break
                val sz = audioExtractor.readSampleData(audioBuf, 0)
                if (sz < 0) break
                if (t >= startUs) {
                    audioInfo.offset = 0
                    audioInfo.size = sz
                    audioInfo.presentationTimeUs = (t - startUs).coerceAtLeast(0L)
                    @Suppress("WrongConstant")
                    audioInfo.flags = audioExtractor.sampleFlags
                    muxer!!.writeSampleData(muxerAudioTrack, audioBuf, audioInfo)
                }
                if (!audioExtractor.advance()) break
            }
        }

        onProgress(1f)
        outputFile.exists() && outputFile.length() > 1024L
    } catch (_: Exception) {
        false
    } finally {
        try {
            encoder?.stop()
        } catch (_: Exception) {
        }
        try {
            encoder?.release()
        } catch (_: Exception) {
        }
        try {
            muxer?.stop()
        } catch (_: Exception) {
        }
        try {
            muxer?.release()
        } catch (_: Exception) {
        }
        try {
            audioExtractor.release()
        } catch (_: Exception) {
        }
        try {
            retriever.release()
        } catch (_: Exception) {
        }
    }
}

private fun applyGeometryToVideoFrame(
    src: Bitmap,
    rotationDegrees: Int,
    flipH: Boolean,
    flipV: Boolean
): Bitmap {
    if (rotationDegrees == 0 && !flipH && !flipV) return src
    val matrix = Matrix()
    if (rotationDegrees != 0) matrix.postRotate(rotationDegrees.toFloat())
    if (flipH || flipV) matrix.postScale(if (flipH) -1f else 1f, if (flipV) -1f else 1f)
    return Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
}
