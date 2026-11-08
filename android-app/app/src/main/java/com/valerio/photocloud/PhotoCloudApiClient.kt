package com.valerio.photocloud

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Native HTTP + AES-256-CFB Client for PhotoCloud Local Server
 */
class PhotoCloudApiClient(private val baseUrl: String) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    fun loginWithAuthFile(authJsonBytes: ByteArray): Boolean {
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "auth_file",
                "photocloud_auth.json",
                authJsonBytes.toRequestBody("application/json".toMediaTypeOrNull())
            )
            .build()

        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/login")
            .post(requestBody)
            .build()

        client.newCall(request).execute().use { response ->
            return response.isSuccessful || response.code == 302
        }
    }

    fun uploadMediaBatch(files: List<File>, sessionCookie: String): Boolean {
        val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
        for (file in files) {
            builder.addFormDataPart(
                "file[]",
                file.name,
                file.readBytes().toRequestBody("application/octet-stream".toMediaTypeOrNull())
            )
            builder.addFormDataPart("timestamp[]", file.lastModified().toString())
        }

        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/upload")
            .header("Cookie", sessionCookie)
            .post(builder.build())
            .build()

        client.newCall(request).execute().use { response ->
            return response.isSuccessful
        }
    }

    companion object {
        /**
         * Decrypts PhotoCloud encrypted file payload ([16B salt][16B iv][AES-256-CFB ciphertext])
         * using PBKDF2-HMAC-SHA256 (100,000 iterations).
         */
        fun decryptFile(encryptedData: ByteArray, apiKey: String): ByteArray {
            require(encryptedData.size >= 32) { "Encrypted payload too short" }
            val salt = encryptedData.copyOfRange(0, 16)
            val iv = encryptedData.copyOfRange(16, 32)
            val ciphertext = encryptedData.copyOfRange(32, encryptedData.size)

            val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val spec = PBEKeySpec(apiKey.toCharArray(), salt, 100000, 256)
            val secretKey = SecretKeySpec(factory.generateSecret(spec).encoded, "AES")

            val cipher = Cipher.getInstance("AES/CFB/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey, IvParameterSpec(iv))
            return cipher.doFinal(ciphertext)
        }
    }
}
