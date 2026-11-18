package com.valerio.photocloud.zk

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Arrays
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.math.ceil
import kotlin.math.min

enum class ZkErrorCode {
    WRONG_KEY_OR_PASSPHRASE,
    AUTH_TAG_MISMATCH,
    TRUNCATED_BLOB,
    UNSUPPORTED_VERSION,
    MALFORMED_HEADER,
    INVALID_PARAMETER
}

class ZkCryptoException(
    val code: ZkErrorCode,
    override val message: String,
    cause: Throwable? = null
) : Exception(message, cause)

fun ByteArray?.zeroize() {
    if (this != null) {
        Arrays.fill(this, 0.toByte())
    }
}

fun zeroizeAll(vararg buffers: ByteArray?) {
    for (buf in buffers) {
        buf.zeroize()
    }
}

interface ZkCryptoProvider {
    fun randomBytes(length: Int): ByteArray
    fun sha256(data: ByteArray): ByteArray
    fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray
    fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int = 32): ByteArray
    fun aes256GcmEncrypt(key: ByteArray, nonce: ByteArray, plaintext: ByteArray, aad: ByteArray): ByteArray
    fun aes256GcmDecrypt(
        key: ByteArray,
        nonce: ByteArray,
        ciphertextWithTag: ByteArray,
        aad: ByteArray,
        errorCodeOnFail: ZkErrorCode = ZkErrorCode.AUTH_TAG_MISMATCH
    ): ByteArray
}

object JvmCryptoProvider : ZkCryptoProvider {
    private val secureRandom = SecureRandom()

    override fun randomBytes(length: Int): ByteArray {
        if (length < 0) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid randomBytes length.")
        }
        val out = ByteArray(length)
        secureRandom.nextBytes(out)
        return out
    }

    override fun sha256(data: ByteArray): ByteArray {
        return MessageDigest.getInstance("SHA-256").digest(data)
    }

    override fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        val actualKey = if (key.isEmpty()) ByteArray(32) else key
        mac.init(SecretKeySpec(actualKey, "HmacSHA256"))
        return mac.doFinal(data)
    }

    override fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        if (length <= 0 || length > 255 * 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid HKDF output length.")
        }
        val actualSalt = if (salt.isNotEmpty()) salt else ByteArray(32)
        val prk = hmacSha256(actualSalt, ikm)
        val okm = ByteArray(length)
        var t = ByteArray(0)
        var offset = 0
        var counter = 1
        try {
            while (offset < length) {
                val input = ByteArray(t.size + info.size + 1)
                System.arraycopy(t, 0, input, 0, t.size)
                System.arraycopy(info, 0, input, t.size, info.size)
                input[input.size - 1] = counter.toByte()
                t.zeroize()
                t = hmacSha256(prk, input)
                input.zeroize()
                val take = min(t.size, length - offset)
                System.arraycopy(t, 0, okm, offset, take)
                offset += take
                counter++
            }
            return okm
        } finally {
            prk.zeroize()
            t.zeroize()
        }
    }

    override fun aes256GcmEncrypt(
        key: ByteArray,
        nonce: ByteArray,
        plaintext: ByteArray,
        aad: ByteArray
    ): ByteArray {
        if (key.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "AES-256-GCM requires a 32-byte key.")
        }
        if (nonce.size != 12) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "AES-256-GCM requires a 12-byte nonce.")
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(128, nonce)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), spec)
        if (aad.isNotEmpty()) {
            cipher.updateAAD(aad)
        }
        return cipher.doFinal(plaintext)
    }

    override fun aes256GcmDecrypt(
        key: ByteArray,
        nonce: ByteArray,
        ciphertextWithTag: ByteArray,
        aad: ByteArray,
        errorCodeOnFail: ZkErrorCode
    ): ByteArray {
        if (key.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "AES-256-GCM requires a 32-byte key.")
        }
        if (nonce.size != 12) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "AES-256-GCM requires a 12-byte nonce.")
        }
        if (ciphertextWithTag.size < 16) {
            throw ZkCryptoException(errorCodeOnFail, "Ciphertext shorter than 16-byte GCM authentication tag.")
        }
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val spec = GCMParameterSpec(128, nonce)
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), spec)
            if (aad.isNotEmpty()) {
                cipher.updateAAD(aad)
            }
            cipher.doFinal(ciphertextWithTag)
        } catch (e: AEADBadTagException) {
            throw ZkCryptoException(errorCodeOnFail, "AES-256-GCM authentication tag verification failed.", e)
        } catch (e: Exception) {
            throw ZkCryptoException(errorCodeOnFail, "AES-256-GCM decryption failed.", e)
        }
    }
}

object ZkCoreCrypto {
    const val PCZK_VERSION_V1: Int = 0x01
    const val PCZK_HEADER_LENGTH: Int = 86
    const val PCZK_GCM_TAG_LENGTH: Int = 16
    const val PCZK_MIN_BLOB_LENGTH: Int = PCZK_HEADER_LENGTH + PCZK_GCM_TAG_LENGTH // 102
    const val DEFAULT_CHUNK_SIZE_LOG2: Int = 20 // 1 MiB
    const val DEDUP_STREAM_BLOCK_BYTES: Int = 65536 // 64 KiB

    private val PCZK_MAGIC = byteArrayOf(0x50, 0x43, 0x5A, 0x4B) // "PCZK"
    private val UUID_REGEX = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    data class KekAndAuthSecret(
        val kek: ByteArray,
        val authSecret: ByteArray
    ) {
        fun zeroizeAll() = zeroizeAll(kek, authSecret)
    }

    data class VaultSubkeys(
        val metaKey: ByteArray,
        val thumbKey: ByteArray,
        val dedupKey: ByteArray,
        val fkWrapKey: ByteArray
    ) {
        fun zeroizeAll() = zeroizeAll(metaKey, thumbKey, dedupKey, fkWrapKey)
    }

    data class ParsedPczkHeader(
        val version: Int,
        val chunkSizeLog2: Int,
        val chunkPlaintextSize: Int,
        val chunkCiphertextSize: Int,
        val blobId: String,
        val blobIdBytes: ByteArray,
        val noncePrefix: ByteArray,
        val wrappedFk: ByteArray,
        val rawHeader: ByteArray
    )

    data class EncryptBlobStreamResult(
        val blobId: String,
        val chunkSizeLog2: Int,
        val totalPlaintextBytes: Long,
        val totalCiphertextBytes: Long,
        val chunkCount: Int,
        val headerBytes: ByteArray,
        val headerSha256Hex: String,
        val ciphertextSha256Hex: String,
        val dedupTagHex: String?,
        val dedupTagB64u: String?
    )

    data class DecryptBlobStreamResult(
        val header: ParsedPczkHeader,
        val totalPlaintextBytes: Long,
        val chunkCount: Int
    )

    data class ChunkRangeDescriptor(
        val chunkIndex: Int,
        val isLast: Boolean,
        val ciphertextStartInBlob: Long,
        val ciphertextEndInclusiveInBlob: Long,
        val ciphertextOffsetInSlice: Int,
        val ciphertextLength: Int,
        val plaintextStartInBlob: Long,
        val plaintextEndInclusiveInBlob: Long
    )

    data class BlobRangePlan(
        val totalCiphertextBytes: Long,
        val totalPlaintextBytes: Long,
        val chunkSizeLog2: Int,
        val chunkPlaintextSize: Int,
        val chunkCiphertextSize: Int,
        val totalChunks: Int,
        val startPlaintextByte: Long,
        val endPlaintextByteInclusive: Long,
        val startChunkIndex: Int,
        val endChunkIndex: Int,
        val ciphertextStartByte: Long,
        val ciphertextEndByteInclusive: Long,
        val chunks: List<ChunkRangeDescriptor>
    )

    fun constantTimeEqual(a: ByteArray, b: ByteArray): Boolean {
        return MessageDigest.isEqual(a, b)
    }

    fun toHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            sb.append(String.format("%02x", b.toInt() and 0xff))
        }
        return sb.toString()
    }

    fun fromHex(hexStr: String): ByteArray {
        if (hexStr.length % 2 != 0) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid hex string length.")
        }
        val out = ByteArray(hexStr.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(hexStr[i * 2], 16)
            val lo = Character.digit(hexStr[i * 2 + 1], 16)
            if (hi == -1 || lo == -1) {
                throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid hex character.")
            }
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }

    fun toBase64Url(bytes: ByteArray): String {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    fun fromBase64Url(b64u: String): ByteArray {
        return try {
            Base64.getUrlDecoder().decode(b64u)
        } catch (e: IllegalArgumentException) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid base64url string.", e)
        }
    }

    fun uuidToBytes(uuid: String): ByteArray {
        if (!UUID_REGEX.matches(uuid)) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid canonical UUID string.")
        }
        return fromHex(uuid.replace("-", "").lowercase())
    }

    fun bytesToUuid(bytes: ByteArray): String {
        if (bytes.size != 16) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "UUID binary must be 16 bytes.")
        }
        val h = toHex(bytes)
        return "${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20, 32)}"
    }

    fun deriveRoot(
        accountKey: ByteArray,
        userSalt: ByteArray,
        passphrase: String? = null,
        argon2Params: ZkArgon2id.Params = ZkArgon2id.Params(),
        onProgress: ((ZkArgon2id.Progress) -> Unit)? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider,
        argon2Provider: ZkArgon2id.Argon2idProvider = ZkArgon2id.DefaultProvider
    ): ByteArray {
        if (accountKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "accountKey must be 32 bytes.")
        }
        if (userSalt.size != 16) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "userSalt must be 16 bytes.")
        }
        var passphraseBytes: ByteArray? = null
        var passphrasePart: ByteArray? = null
        var ikm: ByteArray? = null
        try {
            if (!passphrase.isNullOrEmpty()) {
                val nfc = Normalizer.normalize(passphrase, Normalizer.Form.NFC)
                passphraseBytes = nfc.toByteArray(StandardCharsets.UTF_8)
                passphrasePart = argon2Provider.derive(
                    passphraseBytes,
                    userSalt,
                    argon2Params,
                    ByteArray(0),
                    ByteArray(0),
                    onProgress
                )
            } else {
                passphrasePart = ByteArray(32)
            }
            if (passphrasePart.size != 32) {
                throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Argon2id output must be 32 bytes.")
            }
            ikm = ByteArray(64)
            System.arraycopy(passphrasePart, 0, ikm, 0, 32)
            System.arraycopy(accountKey, 0, ikm, 32, 32)
            return cryptoProvider.hkdfSha256(
                ikm,
                userSalt,
                "photocloud/v2/root".toByteArray(StandardCharsets.UTF_8),
                32
            )
        } finally {
            zeroizeAll(passphraseBytes, passphrasePart, ikm)
        }
    }

    fun deriveKekAndAuthSecret(
        root: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): KekAndAuthSecret {
        if (root.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "root key must be 32 bytes.")
        }
        val empty = ByteArray(0)
        val kek = cryptoProvider.hkdfSha256(root, empty, "photocloud/v2/kek".toByteArray(StandardCharsets.UTF_8), 32)
        val authSecret = cryptoProvider.hkdfSha256(root, empty, "photocloud/v2/auth".toByteArray(StandardCharsets.UTF_8), 32)
        return KekAndAuthSecret(kek, authSecret)
    }

    fun wrapVaultKey(
        kek: ByteArray,
        vaultKey: ByteArray,
        userId: String,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (kek.size != 32 || vaultKey.size != 32 || userId.isBlank()) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid wrapVaultKey parameters.")
        }
        val iv = nonce ?: cryptoProvider.randomBytes(12)
        if (iv.size != 12) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "VK wrap nonce must be 12 bytes.")
        }
        val aad = "vk|$userId".toByteArray(StandardCharsets.UTF_8)
        val ctWithTag = cryptoProvider.aes256GcmEncrypt(kek, iv, vaultKey, aad)
        return iv + ctWithTag
    }

    fun unwrapVaultKey(
        kek: ByteArray,
        wrappedVk: ByteArray,
        userId: String,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (kek.size != 32 || userId.isBlank()) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid unwrapVaultKey parameters.")
        }
        if (wrappedVk.size != 60) {
            throw ZkCryptoException(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, "wrappedVk must be 60 bytes.")
        }
        val iv = wrappedVk.copyOfRange(0, 12)
        val ctWithTag = wrappedVk.copyOfRange(12, 60)
        val aad = "vk|$userId".toByteArray(StandardCharsets.UTF_8)
        return cryptoProvider.aes256GcmDecrypt(kek, iv, ctWithTag, aad, ZkErrorCode.WRONG_KEY_OR_PASSPHRASE)
    }

    fun deriveSubkeys(
        vaultKey: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): VaultSubkeys {
        if (vaultKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "vaultKey must be 32 bytes.")
        }
        val empty = ByteArray(0)
        return VaultSubkeys(
            metaKey = cryptoProvider.hkdfSha256(vaultKey, empty, "photocloud/v2/metaKey".toByteArray(StandardCharsets.UTF_8), 32),
            thumbKey = cryptoProvider.hkdfSha256(vaultKey, empty, "photocloud/v2/thumbKey".toByteArray(StandardCharsets.UTF_8), 32),
            dedupKey = cryptoProvider.hkdfSha256(vaultKey, empty, "photocloud/v2/dedupKey".toByteArray(StandardCharsets.UTF_8), 32),
            fkWrapKey = cryptoProvider.hkdfSha256(vaultKey, empty, "photocloud/v2/fkWrapKey".toByteArray(StandardCharsets.UTF_8), 32)
        )
    }

    fun wrapFileKey(
        fkWrapKey: ByteArray,
        fileKey: ByteArray,
        blobId: String,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        return wrapFileKeyBytes(fkWrapKey, fileKey, uuidToBytes(blobId), nonce, cryptoProvider)
    }

    fun wrapFileKeyBytes(
        fkWrapKey: ByteArray,
        fileKey: ByteArray,
        blobIdBytes: ByteArray,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (fkWrapKey.size != 32 || fileKey.size != 32 || blobIdBytes.size != 16) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid wrapFileKey lengths.")
        }
        val iv = nonce ?: cryptoProvider.randomBytes(12)
        if (iv.size != 12) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "FK wrap nonce must be 12 bytes.")
        }
        val ctWithTag = cryptoProvider.aes256GcmEncrypt(fkWrapKey, iv, fileKey, blobIdBytes)
        return iv + ctWithTag
    }

    fun unwrapFileKey(
        fkWrapKey: ByteArray,
        wrappedFk: ByteArray,
        blobId: String,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        return unwrapFileKeyBytes(fkWrapKey, wrappedFk, uuidToBytes(blobId), cryptoProvider)
    }

    fun unwrapFileKeyBytes(
        fkWrapKey: ByteArray,
        wrappedFk: ByteArray,
        blobIdBytes: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (fkWrapKey.size != 32 || blobIdBytes.size != 16) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid unwrapFileKey lengths.")
        }
        if (wrappedFk.size != 60) {
            throw ZkCryptoException(ZkErrorCode.MALFORMED_HEADER, "wrappedFK must be 60 bytes.")
        }
        val iv = wrappedFk.copyOfRange(0, 12)
        val ctWithTag = wrappedFk.copyOfRange(12, 60)
        return cryptoProvider.aes256GcmDecrypt(fkWrapKey, iv, ctWithTag, blobIdBytes, ZkErrorCode.WRONG_KEY_OR_PASSPHRASE)
    }

    fun wrapFileKeyForShare(
        shareKey: ByteArray,
        fileKey: ByteArray,
        shareId: String,
        blobId: String,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (shareKey.size != 32 || fileKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "shareKey and fileKey must be 32 bytes.")
        }
        uuidToBytes(shareId)
        uuidToBytes(blobId)
        val shareWrapKey = cryptoProvider.hkdfSha256(
            shareKey,
            ByteArray(0),
            "photocloud/v2/share/wrap".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = nonce ?: cryptoProvider.randomBytes(12)
            val aad = "share-fk|${shareId.lowercase()}|${blobId.lowercase()}".toByteArray(StandardCharsets.UTF_8)
            val ctWithTag = cryptoProvider.aes256GcmEncrypt(shareWrapKey, iv, fileKey, aad)
            return iv + ctWithTag
        } finally {
            shareWrapKey.zeroize()
        }
    }

    fun unwrapFileKeyForShare(
        shareKey: ByteArray,
        shareWrappedFk: ByteArray,
        shareId: String,
        blobId: String,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (shareKey.size != 32 || shareWrappedFk.size != 60) {
            throw ZkCryptoException(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, "Invalid shareWrappedFk or shareKey.")
        }
        uuidToBytes(shareId)
        uuidToBytes(blobId)
        val shareWrapKey = cryptoProvider.hkdfSha256(
            shareKey,
            ByteArray(0),
            "photocloud/v2/share/wrap".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = shareWrappedFk.copyOfRange(0, 12)
            val ctWithTag = shareWrappedFk.copyOfRange(12, 60)
            val aad = "share-fk|${shareId.lowercase()}|${blobId.lowercase()}".toByteArray(StandardCharsets.UTF_8)
            return cryptoProvider.aes256GcmDecrypt(shareWrapKey, iv, ctWithTag, aad, ZkErrorCode.WRONG_KEY_OR_PASSPHRASE)
        } finally {
            shareWrapKey.zeroize()
        }
    }

    fun serializePczkHeader(
        chunkSizeLog2: Int,
        blobIdBytes: ByteArray,
        noncePrefix: ByteArray,
        wrappedFk: ByteArray
    ): ByteArray {
        if (chunkSizeLog2 !in 16..24 || blobIdBytes.size != 16 || noncePrefix.size != 4 || wrappedFk.size != 60) {
            throw ZkCryptoException(ZkErrorCode.MALFORMED_HEADER, "Invalid PCZK header fields.")
        }
        val header = ByteArray(PCZK_HEADER_LENGTH)
        System.arraycopy(PCZK_MAGIC, 0, header, 0, 4)
        header[4] = PCZK_VERSION_V1.toByte()
        header[5] = chunkSizeLog2.toByte()
        System.arraycopy(blobIdBytes, 0, header, 6, 16)
        System.arraycopy(noncePrefix, 0, header, 22, 4)
        System.arraycopy(wrappedFk, 0, header, 26, 60)
        return header
    }

    fun parsePczkHeader(headerBytes: ByteArray): ParsedPczkHeader {
        if (headerBytes.size < PCZK_HEADER_LENGTH) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "PCZK header truncated.")
        }
        val raw = headerBytes.copyOfRange(0, PCZK_HEADER_LENGTH)
        for (i in 0..3) {
            if (raw[i] != PCZK_MAGIC[i]) {
                throw ZkCryptoException(ZkErrorCode.MALFORMED_HEADER, "Invalid PCZK magic.")
            }
        }
        val version = raw[4].toInt() and 0xff
        if (version != PCZK_VERSION_V1) {
            throw ZkCryptoException(ZkErrorCode.UNSUPPORTED_VERSION, "Unsupported PCZK version: $version.")
        }
        val chunkSizeLog2 = raw[5].toInt() and 0xff
        if (chunkSizeLog2 !in 16..24) {
            throw ZkCryptoException(ZkErrorCode.MALFORMED_HEADER, "Invalid chunkSizeLog2: $chunkSizeLog2.")
        }
        val chunkPtSize = 1 shl chunkSizeLog2
        val chunkCtSize = chunkPtSize + PCZK_GCM_TAG_LENGTH
        val blobIdBytes = raw.copyOfRange(6, 22)
        val noncePrefix = raw.copyOfRange(22, 26)
        val wrappedFk = raw.copyOfRange(26, 86)
        return ParsedPczkHeader(
            version = version,
            chunkSizeLog2 = chunkSizeLog2,
            chunkPlaintextSize = chunkPtSize,
            chunkCiphertextSize = chunkCtSize,
            blobId = bytesToUuid(blobIdBytes),
            blobIdBytes = blobIdBytes,
            noncePrefix = noncePrefix,
            wrappedFk = wrappedFk,
            rawHeader = raw
        )
    }

    private fun buildChunkNonce(noncePrefix: ByteArray, chunkIndex: Long): ByteArray {
        val out = ByteArray(12)
        System.arraycopy(noncePrefix, 0, out, 0, 4)
        ByteBuffer.wrap(out, 4, 8).order(ByteOrder.BIG_ENDIAN).putLong(chunkIndex)
        return out
    }

    private fun buildChunkAad(headerSha256: ByteArray, isLast: Boolean): ByteArray {
        val out = ByteArray(33)
        System.arraycopy(headerSha256, 0, out, 0, 32)
        out[32] = if (isLast) 0x01 else 0x00
        return out
    }

    private fun readFullyUpTo(input: InputStream, buffer: ByteArray): Int {
        var total = 0
        while (total < buffer.size) {
            val r = input.read(buffer, total, buffer.size - total)
            if (r <= 0) break
            total += r
        }
        return total
    }

    /**
     * Constant-memory streaming blob encryption (`PCZK` v1).
     */
    fun encryptBlobStream(
        input: InputStream,
        output: OutputStream,
        fkWrapKey: ByteArray,
        blobId: String,
        fileKey: ByteArray? = null,
        fkWrapNonce: ByteArray? = null,
        noncePrefix: ByteArray? = null,
        chunkSizeLog2: Int = DEFAULT_CHUNK_SIZE_LOG2,
        dedupKey: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): EncryptBlobStreamResult {
        if (chunkSizeLog2 !in 16..24) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "chunkSizeLog2 must be 16..24.")
        }
        val blobIdBytes = uuidToBytes(blobId)
        val fk = fileKey?.clone() ?: cryptoProvider.randomBytes(32)
        val prefix = noncePrefix?.clone() ?: cryptoProvider.randomBytes(4)
        val chunkSize = 1 shl chunkSizeLog2
        var currentBuf = ByteArray(chunkSize)
        var nextBuf = ByteArray(chunkSize)

        val ctDigest = MessageDigest.getInstance("SHA-256")
        val dedupMac = if (dedupKey != null) {
            Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(dedupKey, "HmacSHA256")) }
        } else null

        try {
            val wrappedFk = wrapFileKeyBytes(fkWrapKey, fk, blobIdBytes, fkWrapNonce, cryptoProvider)
            val header = serializePczkHeader(chunkSizeLog2, blobIdBytes, prefix, wrappedFk)
            val headerSha256 = cryptoProvider.sha256(header)

            output.write(header)
            ctDigest.update(header)

            var totalPlaintextBytes = 0L
            var totalCiphertextBytes = header.size.toLong()
            var chunkIndex = 0

            var currentLen = readFullyUpTo(input, currentBuf)
            if (currentLen == 0) {
                // Empty 0-byte file: emit 1 chunk with isLast = true
                val nonce = buildChunkNonce(prefix, 0L)
                val aad = buildChunkAad(headerSha256, true)
                val encChunk = cryptoProvider.aes256GcmEncrypt(fk, nonce, ByteArray(0), aad)
                zeroizeAll(nonce, aad)
                output.write(encChunk)
                ctDigest.update(encChunk)
                totalCiphertextBytes += encChunk.size
                chunkIndex = 1
            } else {
                while (currentLen > 0) {
                    if (dedupMac != null) {
                        var off = 0
                        while (off < currentLen) {
                            val step = min(DEDUP_STREAM_BLOCK_BYTES, currentLen - off)
                            dedupMac.update(currentBuf, off, step)
                            off += step
                        }
                    }
                    totalPlaintextBytes += currentLen

                    val nextLen = if (currentLen == chunkSize) readFullyUpTo(input, nextBuf) else 0
                    val isLast = nextLen == 0
                    val ptSlice = if (currentLen == chunkSize) currentBuf else currentBuf.copyOfRange(0, currentLen)
                    val nonce = buildChunkNonce(prefix, chunkIndex.toLong())
                    val aad = buildChunkAad(headerSha256, isLast)
                    val encChunk = cryptoProvider.aes256GcmEncrypt(fk, nonce, ptSlice, aad)
                    if (ptSlice !== currentBuf) ptSlice.zeroize()
                    zeroizeAll(nonce, aad)

                    output.write(encChunk)
                    ctDigest.update(encChunk)
                    totalCiphertextBytes += encChunk.size
                    chunkIndex++

                    val swap = currentBuf
                    currentBuf = nextBuf
                    nextBuf = swap
                    currentLen = nextLen
                }
            }

            val ctShaHex = toHex(ctDigest.digest())
            val dedupBytes = dedupMac?.doFinal()
            return EncryptBlobStreamResult(
                blobId = bytesToUuid(blobIdBytes),
                chunkSizeLog2 = chunkSizeLog2,
                totalPlaintextBytes = totalPlaintextBytes,
                totalCiphertextBytes = totalCiphertextBytes,
                chunkCount = chunkIndex,
                headerBytes = header,
                headerSha256Hex = toHex(headerSha256),
                ciphertextSha256Hex = ctShaHex,
                dedupTagHex = dedupBytes?.let { toHex(it) },
                dedupTagB64u = dedupBytes?.let { toBase64Url(it) }
            )
        } finally {
            zeroizeAll(fk, currentBuf, nextBuf)
        }
    }

    /**
     * Constant-memory streaming blob decryption (`PCZK` v1).
     * Never writes unauthenticated plaintext bytes to `output`.
     */
    fun decryptBlobStream(
        input: InputStream,
        output: OutputStream,
        fkWrapKey: ByteArray? = null,
        unwrappedFileKey: ByteArray? = null,
        expectedBlobId: String? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): DecryptBlobStreamResult {
        if (fkWrapKey == null && unwrappedFileKey == null) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Missing fkWrapKey or unwrappedFileKey.")
        }
        val headerBuf = ByteArray(PCZK_HEADER_LENGTH)
        val headerRead = readFullyUpTo(input, headerBuf)
        if (headerRead < PCZK_HEADER_LENGTH) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Truncated PCZK header.")
        }
        val header = parsePczkHeader(headerBuf)
        if (expectedBlobId != null) {
            val expectedBytes = uuidToBytes(expectedBlobId)
            if (!constantTimeEqual(header.blobIdBytes, expectedBytes)) {
                throw ZkCryptoException(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, "Header blobId mismatch.")
            }
        }

        val fk = unwrappedFileKey?.clone()
            ?: unwrapFileKeyBytes(fkWrapKey!!, header.wrappedFk, header.blobIdBytes, cryptoProvider)

        val maxChunkCt = header.chunkCiphertextSize
        var currentCtBuf = ByteArray(maxChunkCt)
        var lookaheadByte = -1

        fun readNextChunk(target: ByteArray): Int {
            var offset = 0
            if (lookaheadByte != -1) {
                target[0] = lookaheadByte.toByte()
                offset = 1
                lookaheadByte = -1
            }
            while (offset < target.size) {
                val r = input.read(target, offset, target.size - offset)
                if (r <= 0) break
                offset += r
            }
            if (offset == target.size) {
                lookaheadByte = input.read()
            }
            return offset
        }

        var pendingPlaintext: ByteArray? = null
        try {
            val headerSha256 = cryptoProvider.sha256(header.rawHeader)
            var chunkIndex = 0
            var totalPlaintextBytes = 0L

            // One-chunk write delay: a newly authenticated chunk is held until the next chunk
            // has also authenticated. This guarantees that a corruption detected while reading
            // chunk N (duplication/reordering/truncation boundary) never leaks chunk N-1 to
            // `output`, while keeping memory constant (at most two plaintext chunks alive).
            fun flushPendingPlaintext() {
                val pending = pendingPlaintext ?: return
                if (pending.isNotEmpty()) {
                    output.write(pending)
                }
                totalPlaintextBytes += pending.size
                pending.zeroize()
                pendingPlaintext = null
            }

            while (true) {
                val ctLen = readNextChunk(currentCtBuf)
                if (ctLen == 0) {
                    if (chunkIndex == 0) {
                        throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "PCZK blob has zero chunks.")
                    }
                    break
                }
                if (ctLen < PCZK_GCM_TAG_LENGTH) {
                    throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Chunk $chunkIndex shorter than 16-byte tag.")
                }
                val isLast = lookaheadByte == -1
                if (!isLast && ctLen != maxChunkCt) {
                    throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Incomplete non-final chunk $chunkIndex.")
                }
                if (ctLen == PCZK_GCM_TAG_LENGTH && (chunkIndex > 0 || !isLast)) {
                    throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid empty trailing chunk at index $chunkIndex.")
                }

                val chunkSlice = if (ctLen == maxChunkCt) currentCtBuf else currentCtBuf.copyOfRange(0, ctLen)
                val nonce = buildChunkNonce(header.noncePrefix, chunkIndex.toLong())
                val aad = buildChunkAad(headerSha256, isLast)
                val ptChunk = try {
                    cryptoProvider.aes256GcmDecrypt(fk, nonce, chunkSlice, aad, ZkErrorCode.AUTH_TAG_MISMATCH)
                } finally {
                    zeroizeAll(nonce, aad)
                }

                flushPendingPlaintext()
                pendingPlaintext = ptChunk
                chunkIndex++

                if (isLast) break
            }

            flushPendingPlaintext()
            return DecryptBlobStreamResult(header, totalPlaintextBytes, chunkIndex)
        } finally {
            pendingPlaintext?.zeroize()
            zeroizeAll(fk, currentCtBuf)
        }
    }

    fun computeBlobRangePlan(
        totalCiphertextBytes: Long,
        chunkSizeLog2: Int,
        startPlaintextByte: Long,
        endPlaintextByteInclusive: Long
    ): BlobRangePlan {
        if (chunkSizeLog2 !in 16..24) {
            throw ZkCryptoException(ZkErrorCode.MALFORMED_HEADER, "chunkSizeLog2 must be 16..24.")
        }
        if (totalCiphertextBytes < PCZK_MIN_BLOB_LENGTH) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "totalCiphertextBytes < 102.")
        }
        val chunkPlaintextSize = 1 shl chunkSizeLog2
        val chunkCiphertextSize = chunkPlaintextSize + PCZK_GCM_TAG_LENGTH
        val chunksPayload = totalCiphertextBytes - PCZK_HEADER_LENGTH

        val totalChunks: Int
        val totalPlaintextBytes: Long
        if (chunksPayload == PCZK_GCM_TAG_LENGTH.toLong()) {
            totalChunks = 1
            totalPlaintextBytes = 0L
        } else {
            totalChunks = ceil(chunksPayload.toDouble() / chunkCiphertextSize.toDouble()).toInt()
            val lastCtLen = chunksPayload - (totalChunks - 1).toLong() * chunkCiphertextSize
            if (lastCtLen <= PCZK_GCM_TAG_LENGTH) {
                throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid final chunk ciphertext size.")
            }
            totalPlaintextBytes = (totalChunks - 1).toLong() * chunkPlaintextSize + (lastCtLen - PCZK_GCM_TAG_LENGTH)
        }

        if (totalPlaintextBytes == 0L ||
            startPlaintextByte < 0L ||
            endPlaintextByteInclusive < startPlaintextByte ||
            endPlaintextByteInclusive >= totalPlaintextBytes
        ) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid plaintext range.")
        }

        val startChunkIndex = (startPlaintextByte / chunkPlaintextSize).toInt()
        val endChunkIndex = (endPlaintextByteInclusive / chunkPlaintextSize).toInt()
        val ctStart = PCZK_HEADER_LENGTH + startChunkIndex.toLong() * chunkCiphertextSize
        val ctEnd = min(
            totalCiphertextBytes - 1,
            PCZK_HEADER_LENGTH + (endChunkIndex + 1).toLong() * chunkCiphertextSize - 1
        )

        val descriptors = mutableListOf<ChunkRangeDescriptor>()
        for (idx in startChunkIndex..endChunkIndex) {
            val isLast = idx == totalChunks - 1
            val cStart = PCZK_HEADER_LENGTH + idx.toLong() * chunkCiphertextSize
            val cEnd = if (isLast) totalCiphertextBytes - 1 else cStart + chunkCiphertextSize - 1
            val cLen = (cEnd - cStart + 1).toInt()
            val pLen = cLen - PCZK_GCM_TAG_LENGTH
            val pStart = idx.toLong() * chunkPlaintextSize
            val pEnd = pStart + pLen - 1
            descriptors.add(
                ChunkRangeDescriptor(
                    chunkIndex = idx,
                    isLast = isLast,
                    ciphertextStartInBlob = cStart,
                    ciphertextEndInclusiveInBlob = cEnd,
                    ciphertextOffsetInSlice = (cStart - ctStart).toInt(),
                    ciphertextLength = cLen,
                    plaintextStartInBlob = pStart,
                    plaintextEndInclusiveInBlob = pEnd
                )
            )
        }

        return BlobRangePlan(
            totalCiphertextBytes = totalCiphertextBytes,
            totalPlaintextBytes = totalPlaintextBytes,
            chunkSizeLog2 = chunkSizeLog2,
            chunkPlaintextSize = chunkPlaintextSize,
            chunkCiphertextSize = chunkCiphertextSize,
            totalChunks = totalChunks,
            startPlaintextByte = startPlaintextByte,
            endPlaintextByteInclusive = endPlaintextByteInclusive,
            startChunkIndex = startChunkIndex,
            endChunkIndex = endChunkIndex,
            ciphertextStartByte = ctStart,
            ciphertextEndByteInclusive = ctEnd,
            chunks = descriptors
        )
    }

    fun decryptBlobRange(
        headerBytes: ByteArray,
        totalCiphertextBytes: Long,
        startPlaintextByte: Long,
        endPlaintextByteInclusive: Long,
        ciphertextSlice: ByteArray,
        fkWrapKey: ByteArray? = null,
        unwrappedFileKey: ByteArray? = null,
        expectedBlobId: String? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        val header = parsePczkHeader(headerBytes)
        if (expectedBlobId != null && !constantTimeEqual(header.blobIdBytes, uuidToBytes(expectedBlobId))) {
            throw ZkCryptoException(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, "Header blobId mismatch.")
        }
        val plan = computeBlobRangePlan(
            totalCiphertextBytes,
            header.chunkSizeLog2,
            startPlaintextByte,
            endPlaintextByteInclusive
        )
        val expectedSliceLen = (plan.ciphertextEndByteInclusive - plan.ciphertextStartByte + 1).toInt()
        if (ciphertextSlice.size < expectedSliceLen) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Range ciphertextSlice truncated.")
        }
        val fk = unwrappedFileKey?.clone()
            ?: unwrapFileKeyBytes(fkWrapKey!!, header.wrappedFk, header.blobIdBytes, cryptoProvider)
        try {
            val headerSha256 = cryptoProvider.sha256(header.rawHeader)
            val outLen = (endPlaintextByteInclusive - startPlaintextByte + 1).toInt()
            val out = ByteArray(outLen)
            var outOff = 0
            for (desc in plan.chunks) {
                val chunkCt = ciphertextSlice.copyOfRange(
                    desc.ciphertextOffsetInSlice,
                    desc.ciphertextOffsetInSlice + desc.ciphertextLength
                )
                val nonce = buildChunkNonce(header.noncePrefix, desc.chunkIndex.toLong())
                val aad = buildChunkAad(headerSha256, desc.isLast)
                val chunkPt = try {
                    cryptoProvider.aes256GcmDecrypt(fk, nonce, chunkCt, aad, ZkErrorCode.AUTH_TAG_MISMATCH)
                } finally {
                    zeroizeAll(nonce, aad)
                }
                val sliceStart = maxOf(0L, startPlaintextByte - desc.plaintextStartInBlob).toInt()
                val sliceEndExcl = minOf(
                    chunkPt.size.toLong(),
                    endPlaintextByteInclusive - desc.plaintextStartInBlob + 1
                ).toInt()
                val copyLen = sliceEndExcl - sliceStart
                System.arraycopy(chunkPt, sliceStart, out, outOff, copyLen)
                outOff += copyLen
                chunkPt.zeroize()
            }
            return out
        } finally {
            fk.zeroize()
        }
    }

    fun computeDedupTag(
        dedupKey: ByteArray,
        input: InputStream
    ): ByteArray {
        if (dedupKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "dedupKey must be 32 bytes.")
        }
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(dedupKey, "HmacSHA256"))
        val buf = ByteArray(DEDUP_STREAM_BLOCK_BYTES)
        try {
            while (true) {
                val r = input.read(buf)
                if (r <= 0) break
                mac.update(buf, 0, r)
            }
            return mac.doFinal()
        } finally {
            buf.zeroize()
        }
    }

    fun encryptMeta(
        metaKey: ByteArray,
        blobId: String,
        plaintextJson: String,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (metaKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "metaKey must be 32 bytes.")
        }
        val canonicalId = blobId.lowercase()
        val blobIdBytes = uuidToBytes(canonicalId)
        val blobMetaKey = cryptoProvider.hkdfSha256(
            metaKey,
            blobIdBytes,
            "photocloud/v2/blob-meta".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = nonce ?: cryptoProvider.randomBytes(12)
            val aad = "meta|$canonicalId".toByteArray(StandardCharsets.UTF_8)
            val pt = plaintextJson.toByteArray(StandardCharsets.UTF_8)
            val ctWithTag = cryptoProvider.aes256GcmEncrypt(blobMetaKey, iv, pt, aad)
            pt.zeroize()
            return iv + ctWithTag
        } finally {
            blobMetaKey.zeroize()
        }
    }

    fun decryptMeta(
        metaKey: ByteArray,
        blobId: String,
        encryptedMeta: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): String {
        if (metaKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "metaKey must be 32 bytes.")
        }
        if (encryptedMeta.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "encryptedMeta shorter than 28 bytes.")
        }
        val canonicalId = blobId.lowercase()
        val blobIdBytes = uuidToBytes(canonicalId)
        val blobMetaKey = cryptoProvider.hkdfSha256(
            metaKey,
            blobIdBytes,
            "photocloud/v2/blob-meta".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = encryptedMeta.copyOfRange(0, 12)
            val ctWithTag = encryptedMeta.copyOfRange(12, encryptedMeta.size)
            val aad = "meta|$canonicalId".toByteArray(StandardCharsets.UTF_8)
            val ptBytes = cryptoProvider.aes256GcmDecrypt(blobMetaKey, iv, ctWithTag, aad, ZkErrorCode.AUTH_TAG_MISMATCH)
            try {
                val decoder = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                return decoder.decode(ByteBuffer.wrap(ptBytes)).toString()
            } finally {
                ptBytes.zeroize()
            }
        } finally {
            blobMetaKey.zeroize()
        }
    }

    fun encryptThumbnail(
        thumbKey: ByteArray,
        blobId: String,
        variant: String,
        thumbPlaintext: ByteArray,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (thumbKey.size != 32 || (variant != "320" && variant != "1280")) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid thumbnail encryption params.")
        }
        val canonicalId = blobId.lowercase()
        val blobIdBytes = uuidToBytes(canonicalId)
        val blobThumbKey = cryptoProvider.hkdfSha256(
            thumbKey,
            blobIdBytes,
            "photocloud/v2/thumb/$variant".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = nonce ?: cryptoProvider.randomBytes(12)
            val aad = "thumb|$canonicalId|$variant".toByteArray(StandardCharsets.UTF_8)
            val ct = cryptoProvider.aes256GcmEncrypt(blobThumbKey, iv, thumbPlaintext, aad)
            return iv + ct
        } finally {
            blobThumbKey.zeroize()
        }
    }

    fun decryptThumbnail(
        thumbKey: ByteArray,
        blobId: String,
        variant: String,
        encryptedThumb: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (thumbKey.size != 32 || (variant != "320" && variant != "1280")) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid thumbnail decryption params.")
        }
        if (encryptedThumb.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "encryptedThumb shorter than 28 bytes.")
        }
        val canonicalId = blobId.lowercase()
        val blobIdBytes = uuidToBytes(canonicalId)
        val blobThumbKey = cryptoProvider.hkdfSha256(
            thumbKey,
            blobIdBytes,
            "photocloud/v2/thumb/$variant".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = encryptedThumb.copyOfRange(0, 12)
            val ct = encryptedThumb.copyOfRange(12, encryptedThumb.size)
            val aad = "thumb|$canonicalId|$variant".toByteArray(StandardCharsets.UTF_8)
            return cryptoProvider.aes256GcmDecrypt(blobThumbKey, iv, ct, aad, ZkErrorCode.AUTH_TAG_MISMATCH)
        } finally {
            blobThumbKey.zeroize()
        }
    }

    fun encryptAlbums(
        metaKey: ByteArray,
        userId: String,
        plaintextJson: String,
        revision: Int,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (metaKey.size != 32 || revision < 1) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid encryptAlbums parameters.")
        }
        val canonicalUser = userId.lowercase()
        uuidToBytes(canonicalUser)
        val albumKey = cryptoProvider.hkdfSha256(
            metaKey,
            canonicalUser.toByteArray(StandardCharsets.UTF_8),
            "photocloud/v2/albums".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = nonce ?: cryptoProvider.randomBytes(12)
            val aad = "albums|$canonicalUser|$revision".toByteArray(StandardCharsets.UTF_8)
            val pt = plaintextJson.toByteArray(StandardCharsets.UTF_8)
            val ct = cryptoProvider.aes256GcmEncrypt(albumKey, iv, pt, aad)
            pt.zeroize()
            return ByteBuffer.allocate(4 + iv.size + ct.size).order(ByteOrder.BIG_ENDIAN)
                .putInt(revision)
                .put(iv)
                .put(ct)
                .array()
        } finally {
            albumKey.zeroize()
        }
    }

    fun decryptAlbums(
        metaKey: ByteArray,
        userId: String,
        encryptedPayload: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): Pair<Int, String> {
        if (metaKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "metaKey must be 32 bytes.")
        }
        if (encryptedPayload.size < 32) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Encrypted albums payload shorter than 32 bytes.")
        }
        val canonicalUser = userId.lowercase()
        uuidToBytes(canonicalUser)
        val revision = ByteBuffer.wrap(encryptedPayload, 0, 4).order(ByteOrder.BIG_ENDIAN).int
        if (revision < 1) {
            throw ZkCryptoException(ZkErrorCode.MALFORMED_HEADER, "Invalid album revision.")
        }
        val albumKey = cryptoProvider.hkdfSha256(
            metaKey,
            canonicalUser.toByteArray(StandardCharsets.UTF_8),
            "photocloud/v2/albums".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = encryptedPayload.copyOfRange(4, 16)
            val ct = encryptedPayload.copyOfRange(16, encryptedPayload.size)
            val aad = "albums|$canonicalUser|$revision".toByteArray(StandardCharsets.UTF_8)
            val pt = cryptoProvider.aes256GcmDecrypt(albumKey, iv, ct, aad, ZkErrorCode.AUTH_TAG_MISMATCH)
            return try {
                revision to String(pt, StandardCharsets.UTF_8)
            } finally {
                pt.zeroize()
            }
        } finally {
            albumKey.zeroize()
        }
    }

    fun encryptShareManifest(
        shareKey: ByteArray,
        shareId: String,
        plaintextJson: String,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (shareKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "shareKey must be 32 bytes.")
        }
        val canonicalShareId = shareId.lowercase()
        uuidToBytes(canonicalShareId)
        val shareMetaKey = cryptoProvider.hkdfSha256(
            shareKey,
            ByteArray(0),
            "photocloud/v2/share/meta".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = nonce ?: cryptoProvider.randomBytes(12)
            val aad = "share-manifest|$canonicalShareId".toByteArray(StandardCharsets.UTF_8)
            val pt = plaintextJson.toByteArray(StandardCharsets.UTF_8)
            val ct = cryptoProvider.aes256GcmEncrypt(shareMetaKey, iv, pt, aad)
            pt.zeroize()
            return iv + ct
        } finally {
            shareMetaKey.zeroize()
        }
    }

    fun decryptShareManifest(
        shareKey: ByteArray,
        shareId: String,
        encryptedManifest: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): String {
        if (shareKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "shareKey must be 32 bytes.")
        }
        if (encryptedManifest.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "encryptedManifest shorter than 28 bytes.")
        }
        val canonicalShareId = shareId.lowercase()
        uuidToBytes(canonicalShareId)
        val shareMetaKey = cryptoProvider.hkdfSha256(
            shareKey,
            ByteArray(0),
            "photocloud/v2/share/meta".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = encryptedManifest.copyOfRange(0, 12)
            val ct = encryptedManifest.copyOfRange(12, encryptedManifest.size)
            val aad = "share-manifest|$canonicalShareId".toByteArray(StandardCharsets.UTF_8)
            val pt = cryptoProvider.aes256GcmDecrypt(shareMetaKey, iv, ct, aad, ZkErrorCode.AUTH_TAG_MISMATCH)
            return try {
                String(pt, StandardCharsets.UTF_8)
            } finally {
                pt.zeroize()
            }
        } finally {
            shareMetaKey.zeroize()
        }
    }

    fun encryptShareItemMeta(
        shareKey: ByteArray,
        shareId: String,
        blobId: String,
        plaintextJson: String,
        nonce: ByteArray? = null,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): ByteArray {
        if (shareKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "shareKey must be 32 bytes.")
        }
        val canonicalShareId = shareId.lowercase()
        val canonicalBlobId = blobId.lowercase()
        uuidToBytes(canonicalShareId)
        uuidToBytes(canonicalBlobId)
        val shareMetaKey = cryptoProvider.hkdfSha256(
            shareKey,
            ByteArray(0),
            "photocloud/v2/share/meta".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = nonce ?: cryptoProvider.randomBytes(12)
            val aad = "share-meta|$canonicalShareId|$canonicalBlobId".toByteArray(StandardCharsets.UTF_8)
            val pt = plaintextJson.toByteArray(StandardCharsets.UTF_8)
            val ct = cryptoProvider.aes256GcmEncrypt(shareMetaKey, iv, pt, aad)
            pt.zeroize()
            return iv + ct
        } finally {
            shareMetaKey.zeroize()
        }
    }

    fun decryptShareItemMeta(
        shareKey: ByteArray,
        shareId: String,
        blobId: String,
        encryptedItemMeta: ByteArray,
        cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
    ): String {
        if (shareKey.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "shareKey must be 32 bytes.")
        }
        if (encryptedItemMeta.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "encryptedItemMeta shorter than 28 bytes.")
        }
        val canonicalShareId = shareId.lowercase()
        val canonicalBlobId = blobId.lowercase()
        uuidToBytes(canonicalShareId)
        uuidToBytes(canonicalBlobId)
        val shareMetaKey = cryptoProvider.hkdfSha256(
            shareKey,
            ByteArray(0),
            "photocloud/v2/share/meta".toByteArray(StandardCharsets.UTF_8),
            32
        )
        try {
            val iv = encryptedItemMeta.copyOfRange(0, 12)
            val ct = encryptedItemMeta.copyOfRange(12, encryptedItemMeta.size)
            val aad = "share-meta|$canonicalShareId|$canonicalBlobId".toByteArray(StandardCharsets.UTF_8)
            val pt = cryptoProvider.aes256GcmDecrypt(shareMetaKey, iv, ct, aad, ZkErrorCode.AUTH_TAG_MISMATCH)
            return try {
                String(pt, StandardCharsets.UTF_8)
            } finally {
                pt.zeroize()
            }
        } finally {
            shareMetaKey.zeroize()
        }
    }
}
