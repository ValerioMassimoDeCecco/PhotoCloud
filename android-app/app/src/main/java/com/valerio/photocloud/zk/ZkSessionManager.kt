package com.valerio.photocloud.zk

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.Locale

const val UNIFORM_AUTH_ERROR_MESSAGE = "Credenziali o keyfile non validi."
const val MIN_PASSPHRASE_LENGTH = 12

class ZkUniformAuthException(
    override val message: String = UNIFORM_AUTH_ERROR_MESSAGE,
    cause: Throwable? = null
) : Exception(message, cause)

data class ZkKeyFileV2(
    val formatVersion: Int,
    val username: String,
    val userId: String?,
    val accountKeyB64u: String,
    val saltB64u: String?,
    val kdfParams: V2KdfParamsDto?,
    val hasPassphrase: Boolean,
    val createdAt: String?
)

data class PinnedKdfRecord(
    val username: String,
    val saltB64u: String,
    val memoryKiB: Int,
    val iterations: Int,
    val parallelism: Int,
    val pinnedAtMs: Long
)

data class KdfChangeWarning(
    val username: String,
    val previousSaltB64u: String,
    val newSaltB64u: String,
    val previousParams: V2KdfParamsDto,
    val newParams: V2KdfParamsDto,
    val source: String
)

data class PassphraseStrengthResult(
    val valid: Boolean,
    val normalizedLength: Int,
    val feedback: String
)

interface KdfPinningStore {
    fun get(username: String): PinnedKdfRecord?
    fun set(record: PinnedKdfRecord)
    fun remove(username: String)
    fun clearAll()
}

class InMemoryKdfPinningStore : KdfPinningStore {
    private val map = LinkedHashMap<String, PinnedKdfRecord>()

    @Synchronized
    override fun get(username: String): PinnedKdfRecord? {
        return map[username.trim().lowercase(Locale.ROOT)]
    }

    @Synchronized
    override fun set(record: PinnedKdfRecord) {
        map[record.username.trim().lowercase(Locale.ROOT)] = record
    }

    @Synchronized
    override fun remove(username: String) {
        map.remove(username.trim().lowercase(Locale.ROOT))
    }

    @Synchronized
    override fun clearAll() {
        map.clear()
    }
}

/**
 * Persists strictly non-secret KDF parameters (`username`, `salt`, `m`, `t`, `p`) for anti-downgrade pinning.
 */
class PrefsKdfPinningStore(context: Context) : KdfPinningStore {
    companion object {
        private const val PREFS_NAME = "photocloud_v2_kdf_pins"
    }

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun get(username: String): PinnedKdfRecord? {
        val raw = prefs.getString(username.trim().lowercase(Locale.ROOT), null) ?: return null
        return try {
            val obj = JSONObject(raw)
            PinnedKdfRecord(
                username = obj.getString("username"),
                saltB64u = obj.getString("saltB64u"),
                memoryKiB = obj.getInt("memoryKiB"),
                iterations = obj.getInt("iterations"),
                parallelism = obj.getInt("parallelism"),
                pinnedAtMs = obj.optLong("pinnedAtMs", 0L)
            )
        } catch (_: Throwable) {
            null
        }
    }

    override fun set(record: PinnedKdfRecord) {
        val normalized = record.username.trim().lowercase(Locale.ROOT)
        val obj = JSONObject()
            .put("username", normalized)
            .put("saltB64u", record.saltB64u)
            .put("memoryKiB", record.memoryKiB)
            .put("iterations", record.iterations)
            .put("parallelism", record.parallelism)
            .put("pinnedAtMs", record.pinnedAtMs)
        prefs.edit().putString(normalized, obj.toString()).apply()
    }

    override fun remove(username: String) {
        prefs.edit().remove(username.trim().lowercase(Locale.ROOT)).apply()
    }

    override fun clearAll() {
        prefs.edit().clear().apply()
    }
}

interface ZkAccountMetadataStore {
    fun getLastUserId(): String?
    fun getLastUsername(): String?
    fun saveLastAccount(userId: String, username: String)
    fun getEncryptedBioSession(): String? = null
    fun saveEncryptedBioSession(encryptedB64u: String) {}
    fun clearEncryptedBioSession() {}
    fun clear()
}

class InMemoryZkAccountMetadataStore : ZkAccountMetadataStore {
    private var userId: String? = null
    private var username: String? = null
    private var encryptedBioSession: String? = null

    override fun getLastUserId(): String? = userId
    override fun getLastUsername(): String? = username
    override fun saveLastAccount(userId: String, username: String) {
        this.userId = userId
        this.username = username
    }

    override fun getEncryptedBioSession(): String? = encryptedBioSession
    override fun saveEncryptedBioSession(encryptedB64u: String) {
        this.encryptedBioSession = encryptedB64u
    }

    override fun clearEncryptedBioSession() {
        this.encryptedBioSession = null
    }

    override fun clear() {
        userId = null
        username = null
        encryptedBioSession = null
    }
}

class PrefsZkAccountMetadataStore(context: Context) : ZkAccountMetadataStore {
    companion object {
        private const val PREFS_NAME = "photocloud_v2_account_meta"
        private const val KEY_BIO_SESSION = "enc_bio_session_v1"
    }

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun getLastUserId(): String? = prefs.getString("user_id", null)
    override fun getLastUsername(): String? = prefs.getString("username", null)
    override fun saveLastAccount(userId: String, username: String) {
        prefs.edit()
            .putString("user_id", userId)
            .putString("username", username)
            .apply()
    }

    override fun getEncryptedBioSession(): String? = prefs.getString(KEY_BIO_SESSION, null)

    override fun saveEncryptedBioSession(encryptedB64u: String) {
        prefs.edit().putString(KEY_BIO_SESSION, encryptedB64u).apply()
    }

    override fun clearEncryptedBioSession() {
        prefs.edit().remove(KEY_BIO_SESSION).apply()
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }
}

object ZkAccountCredentialsCodec {
    private val RECOVERY_HEX_REGEX = Regex("^[0-9a-f]{64}$")

    fun formatRecoveryCode(accountKeyBytes: ByteArray): String {
        if (accountKeyBytes.size != 32) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "accountKey must be 32 bytes.")
        }
        val hex = ZkCoreCrypto.toHex(accountKeyBytes).uppercase(Locale.ROOT)
        return hex.chunked(8).joinToString("-")
    }

    fun parseRecoveryCodeToAccountKey(recoveryCode: String): ByteArray {
        val cleaned = recoveryCode.replace(Regex("[\\s-]"), "").lowercase(Locale.ROOT)
        if (!RECOVERY_HEX_REGEX.matches(cleaned)) {
            throw ZkCryptoException(
                ZkErrorCode.INVALID_PARAMETER,
                "Codice di recupero non valido (attesi 64 caratteri hex)."
            )
        }
        return ZkCoreCrypto.fromHex(cleaned)
    }

    fun evaluatePassphraseStrength(passphrase: String): PassphraseStrengthResult {
        val normalized = java.text.Normalizer.normalize(passphrase, java.text.Normalizer.Form.NFC)
        val cpCount = normalized.codePointCount(0, normalized.length)
        if (cpCount < MIN_PASSPHRASE_LENGTH) {
            return PassphraseStrengthResult(
                valid = false,
                normalizedLength = cpCount,
                feedback = "La passphrase deve contenere almeno $MIN_PASSPHRASE_LENGTH caratteri (attuali: $cpCount)."
            )
        }
        val unique = HashSet<Int>()
        var i = 0
        while (i < normalized.length) {
            val cp = normalized.codePointAt(i)
            unique.add(cp)
            i += Character.charCount(cp)
        }
        if (unique.size < 4) {
            return PassphraseStrengthResult(
                valid = false,
                normalizedLength = cpCount,
                feedback = "La passphrase contiene troppi caratteri ripetuti."
            )
        }
        return PassphraseStrengthResult(
            valid = true,
            normalizedLength = cpCount,
            feedback = "Passphrase valida."
        )
    }

    fun parseKeyFileJson(rawJson: String): ZkKeyFileV2 {
        val obj = JSONObject(rawJson)
        val formatVersion = if (obj.has("formatVersion")) {
            obj.getInt("formatVersion")
        } else {
            obj.optInt("version", -1)
        }
        if (formatVersion != 2) {
            throw ZkCryptoException(
                ZkErrorCode.UNSUPPORTED_VERSION,
                "Versione keyfile non supportata: $formatVersion"
            )
        }
        val username = obj.optString("username", "").trim()
        if (username.isEmpty()) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Username mancante nel keyfile.")
        }
        val rawAccountKey = obj.optString("accountKey", "").trim()
        val accountKeyBytes = decodeAccountKeyField(rawAccountKey)
        val normalizedAccountKeyB64u = try {
            ZkCoreCrypto.toBase64Url(accountKeyBytes)
        } finally {
            accountKeyBytes.zeroize()
        }

        val salt = when {
            obj.has("salt") && !obj.isNull("salt") -> obj.getString("salt")
            obj.has("userSalt") && !obj.isNull("userSalt") -> obj.getString("userSalt")
            else -> null
        }

        val kdfObj = when {
            obj.has("kdfParams") && !obj.isNull("kdfParams") -> obj.getJSONObject("kdfParams")
            obj.has("kdf") && !obj.isNull("kdf") -> obj.getJSONObject("kdf")
            else -> null
        }
        val kdfDto = kdfObj?.let { V2KdfParamsDto.fromJson(it) }
        val userId = if (obj.has("userId") && !obj.isNull("userId")) obj.getString("userId") else null
        val createdAt = if (obj.has("createdAt") && !obj.isNull("createdAt")) obj.getString("createdAt") else null
        val hasPassphrase = obj.optBoolean("hasPassphrase", true)

        return ZkKeyFileV2(
            formatVersion = 2,
            username = username,
            userId = userId,
            accountKeyB64u = normalizedAccountKeyB64u,
            saltB64u = salt,
            kdfParams = kdfDto,
            hasPassphrase = hasPassphrase,
            createdAt = createdAt
        )
    }

    fun serializeKeyFileJson(keyFile: ZkKeyFileV2): String {
        val obj = JSONObject()
            .put("formatVersion", 2)
            .put("username", keyFile.username)
            .put("accountKey", keyFile.accountKeyB64u)
            .put("hasPassphrase", keyFile.hasPassphrase)
        if (!keyFile.userId.isNullOrBlank()) obj.put("userId", keyFile.userId)
        if (!keyFile.saltB64u.isNullOrBlank()) obj.put("salt", keyFile.saltB64u)
        if (keyFile.kdfParams != null) obj.put("kdfParams", keyFile.kdfParams.toJson())
        if (!keyFile.createdAt.isNullOrBlank()) obj.put("createdAt", keyFile.createdAt)
        return obj.toString(2)
    }

    private fun decodeAccountKeyField(raw: String): ByteArray {
        if (raw.length == 64 && raw.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
            return ZkCoreCrypto.fromHex(raw)
        }
        val bytes = ZkCoreCrypto.fromBase64Url(raw)
        if (bytes.size != 32) {
            bytes.zeroize()
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "accountKey must decode to 32 bytes.")
        }
        return bytes
    }
}

data class ZkSessionSnapshot(
    val isUnlocked: Boolean = false,
    val isLockedWithSavedKeystore: Boolean = false,
    val userId: String? = null,
    val username: String? = null,
    val hasPassphrase: Boolean = true,
    val canRewrapInMemory: Boolean = false,
    val keyProtectionStatus: VaultKeyStore.KeyProtectionStatus? = null,
    val lastKdfChangeWarning: KdfChangeWarning? = null,
    val autoLockTimeoutMs: Long = 15 * 60 * 1000L,
    val lockOnBackground: Boolean = true,
    val lockReason: String? = null
)

fun interface KdfFloorPolicy {
    fun enforce(kdfParams: V2KdfParamsDto, saltBytes: ByteArray)
}

object StrictArgon2idKdfPolicy : KdfFloorPolicy {
    override fun enforce(kdfParams: V2KdfParamsDto, saltBytes: ByteArray) {
        if (!kdfParams.algorithm.equals("Argon2id", ignoreCase = true)) {
            throw ZkCryptoException(
                ZkErrorCode.INVALID_PARAMETER,
                "KDF_FLOOR_VIOLATION: algoritmo non supportato (${kdfParams.algorithm})."
            )
        }
        ZkArgon2id.validateKdfParamsFloor(kdfParams.toArgon2Params(), saltBytes)
    }
}

/**
 * Manages Zero-Knowledge v2 authentication session lifecycle (FASE 4B):
 * - Login via imported KeyFile JSON or printable Recovery Code + Passphrase
 * - `/api/v2/login/params` KDF floor enforcement + per-username KDF pinning
 * - Uniform auth error messages (no username/passphrase/keyfile oracle)
 * - In-memory `VK` + derived subkeys + best-effort `.zeroize()` (`fill(0)`) on lock/logout
 * - Passphrase change via `/api/v2/account/rewrap` (without re-encrypting blobs)
 * - Dual-key `VaultKeyStore` enrollment/unlock + configurable auto-lock & background lock
 */
class ZkSessionManager(
    val apiClient: PhotoCloudZkApiClientV2,
    val vaultKeyStore: VaultKeyStore,
    private val kdfPinningStore: KdfPinningStore = InMemoryKdfPinningStore(),
    private val metadataStore: ZkAccountMetadataStore = InMemoryZkAccountMetadataStore(),
    private val cryptoProvider: ZkCryptoProvider = JvmCryptoProvider,
    private val argon2Provider: ZkArgon2id.Argon2idProvider = ZkArgon2id.DefaultProvider,
    private val clockMs: () -> Long = { System.currentTimeMillis() },
    private val autoLockScope: CoroutineScope? = null,
    private val onKdfParamsChangedWarning: ((KdfChangeWarning) -> Unit)? = null,
    private val kdfFloorPolicy: KdfFloorPolicy = StrictArgon2idKdfPolicy
) {
    private val _sessionState = MutableStateFlow(
        ZkSessionSnapshot(
            isUnlocked = false,
            isLockedWithSavedKeystore = vaultKeyStore.hasBiometricWrappedVk(),
            userId = metadataStore.getLastUserId(),
            username = metadataStore.getLastUsername(),
            keyProtectionStatus = vaultKeyStore.getStatus()
        )
    )
    val sessionState: StateFlow<ZkSessionSnapshot> = _sessionState.asStateFlow()

    @Volatile
    private var vaultKey: ByteArray? = null

    @Volatile
    private var subkeys: ZkCoreCrypto.VaultSubkeys? = null

    @Volatile
    private var accountKey: ByteArray? = null

    @Volatile
    private var userSalt: ByteArray? = null

    @Volatile
    private var lastAuthSecretBytes: ByteArray? = null

    @Volatile
    private var currentHasPassphrase: Boolean = true

    @Volatile
    private var currentKdfParams: V2KdfParamsDto? = null

    @Volatile
    private var wrappedVaultKeyB64u: String? = null

    @Volatile
    private var currentUserId: String? = metadataStore.getLastUserId()

    @Volatile
    private var currentUsername: String? = metadataStore.getLastUsername()

    @Volatile
    private var lastKdfChangeWarning: KdfChangeWarning? = null

    @Volatile
    private var autoLockTimeoutMs: Long = 15 * 60 * 1000L

    @Volatile
    private var lockOnBackground: Boolean = true

    @Volatile
    private var lastActivityMs: Long = clockMs()

    @Volatile
    private var autoLockJob: Job? = null

    fun isUnlocked(): Boolean = vaultKey != null && subkeys != null && currentUserId != null

    fun getUserId(): String? = currentUserId

    fun getUsername(): String? = currentUsername

    fun isPassphraseProtected(): Boolean = currentHasPassphrase

    fun getSubkeysOrNull(): ZkCoreCrypto.VaultSubkeys? {
        if (!isUnlocked()) return null
        touchActivity()
        return subkeys
    }

    /**
     * Returns a defensive copy of the unlocked 32-byte `VK` ONLY for authorized local
     * operations (e.g., `VaultKeyStore` wrapping). Caller MUST zeroize the returned array.
     */
    fun copyVaultKeyForAuthorizedWrap(): ByteArray {
        val vk = vaultKey ?: throw IllegalStateException("Vault is locked.")
        touchActivity()
        return vk.copyOf()
    }

    fun getCurrentRecoveryCodeOrNull(): String? {
        val ak = accountKey ?: return null
        return ZkAccountCredentialsCodec.formatRecoveryCode(ak)
    }

    fun getCurrentUpdatedKeyFileOrNull(): ZkKeyFileV2? {
        val ak = accountKey ?: return null
        val user = currentUsername ?: return null
        return ZkKeyFileV2(
            formatVersion = 2,
            username = user,
            userId = currentUserId,
            accountKeyB64u = ZkCoreCrypto.toBase64Url(ak),
            saltB64u = userSalt?.let { ZkCoreCrypto.toBase64Url(it) },
            kdfParams = currentKdfParams,
            hasPassphrase = currentHasPassphrase,
            createdAt = null
        )
    }

    fun setAutoLockConfig(timeoutMs: Long, lockOnBackground: Boolean) {
        this.autoLockTimeoutMs = timeoutMs.coerceAtLeast(0L)
        this.lockOnBackground = lockOnBackground
        touchActivity()
        publishState()
    }

    fun touchActivity() {
        lastActivityMs = clockMs()
        scheduleAutoLockTimer()
    }

    private fun scheduleAutoLockTimer() {
        autoLockJob?.cancel()
        val scope = autoLockScope ?: return
        val timeout = autoLockTimeoutMs
        if (!isUnlocked() || timeout <= 0L) return
        autoLockJob = scope.launch {
            delay(timeout)
            checkInactivityTimeout()
        }
    }

    fun checkInactivityTimeout(): Boolean {
        if (!isUnlocked() || autoLockTimeoutMs <= 0L) return false
        if (clockMs() - lastActivityMs >= autoLockTimeoutMs) {
            lock("Timeout di inattività scaduto.")
            return true
        }
        return false
    }

    fun onAppBackgrounded() {
        if (!isUnlocked()) return
        if (lockOnBackground) {
            lock("App passata in background.")
        } else {
            checkInactivityTimeout()
        }
    }

    fun dismissKdfWarning() {
        lastKdfChangeWarning = null
        publishState()
    }

    private fun publishState(lockReason: String? = null) {
        _sessionState.value = ZkSessionSnapshot(
            isUnlocked = isUnlocked(),
            isLockedWithSavedKeystore = !isUnlocked() && vaultKeyStore.hasBiometricWrappedVk(),
            userId = currentUserId,
            username = currentUsername,
            hasPassphrase = currentHasPassphrase,
            canRewrapInMemory = isUnlocked() && accountKey != null && userSalt != null,
            keyProtectionStatus = vaultKeyStore.getStatus(),
            lastKdfChangeWarning = lastKdfChangeWarning,
            autoLockTimeoutMs = autoLockTimeoutMs,
            lockOnBackground = lockOnBackground,
            lockReason = lockReason
        )
    }

    /**
     * Enforces KDF parameter floor and checks per-username pinned KDF history BEFORE running Argon2id.
     */
    private fun validateAndCheckKdfPinning(
        username: String,
        saltB64u: String,
        kdfParams: V2KdfParamsDto,
        keyFileHint: ZkKeyFileV2? = null
    ): Pair<ByteArray, KdfChangeWarning?> {
        val saltBytes = try {
            ZkCoreCrypto.fromBase64Url(saltB64u.trim())
        } catch (e: ZkCryptoException) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "KDF salt invalid.", e)
        }

        kdfFloorPolicy.enforce(kdfParams, saltBytes)

        var warning: KdfChangeWarning? = null
        val previous = kdfPinningStore.get(username)
        if (previous != null) {
            val changed = previous.saltB64u != saltB64u ||
                previous.memoryKiB != kdfParams.memoryKiB ||
                previous.iterations != kdfParams.iterations ||
                previous.parallelism != kdfParams.parallelism
            if (changed) {
                warning = KdfChangeWarning(
                    username = username.trim().lowercase(Locale.ROOT),
                    previousSaltB64u = previous.saltB64u,
                    newSaltB64u = saltB64u,
                    previousParams = V2KdfParamsDto(
                        algorithm = "Argon2id",
                        memoryKiB = previous.memoryKiB,
                        iterations = previous.iterations,
                        parallelism = previous.parallelism
                    ),
                    newParams = kdfParams,
                    source = "pinned_store"
                )
            }
        } else if (keyFileHint?.saltB64u != null && keyFileHint.saltB64u != saltB64u) {
            warning = KdfChangeWarning(
                username = username.trim().lowercase(Locale.ROOT),
                previousSaltB64u = keyFileHint.saltB64u,
                newSaltB64u = saltB64u,
                previousParams = keyFileHint.kdfParams ?: kdfParams,
                newParams = kdfParams,
                source = "keyfile_hint"
            )
        }

        if (warning != null) {
            lastKdfChangeWarning = warning
            onKdfParamsChangedWarning?.invoke(warning)
        }

        return saltBytes to warning
    }

    /**
     * Direct in-app Zero-Knowledge v2 registration (V1-simple UX):
     * - When [passphrase] is null or empty, generates a 256-bit random `accountKey` (`hasPassphrase = false`)
     *   for instant 1-click keyfile login (0ms Argon2id overhead) while preserving full E2EE.
     * - When [passphrase] is provided, enforces >=12 characters and Argon2id 64 MiB (t=3, p=1) 2FA.
     */
    suspend fun registerAccount(
        username: String,
        passphrase: String? = null,
        setupOrInviteToken: String? = null
    ): ZkKeyFileV2 {
        apiClient.validateBaseUrl()
        val cleanUsername = username.trim()
        val usernameRegex = Regex("^[a-zA-Z0-9._-]{3,64}$")
        if (!usernameRegex.matches(cleanUsername)) {
            throw ZkCryptoException(
                ZkErrorCode.INVALID_PARAMETER,
                "Username non valido (usa 3-64 caratteri: lettere, numeri, ., _, -)."
            )
        }
        val cleanPassphrase = passphrase?.takeIf { it.isNotEmpty() }
        if (cleanPassphrase != null) {
            val strength = ZkAccountCredentialsCodec.evaluatePassphraseStrength(cleanPassphrase)
            if (!strength.valid) {
                throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, strength.feedback)
            }
        }

        val kdfParams = V2KdfParamsDto(
            algorithm = "Argon2id",
            memoryKiB = ZkArgon2id.MIN_ARGON2_MEMORY_KIB,
            iterations = ZkArgon2id.MIN_ARGON2_ITERATIONS,
            parallelism = ZkArgon2id.MIN_ARGON2_PARALLELISM
        )
        val userId = java.util.UUID.randomUUID().toString().lowercase(Locale.ROOT)
        val newAccountKey = cryptoProvider.randomBytes(32)
        val newSalt = cryptoProvider.randomBytes(16)
        val newVk = cryptoProvider.randomBytes(32)
        var root: ByteArray? = null
        var kekAndAuth: ZkCoreCrypto.KekAndAuthSecret? = null
        var wrappedVkBytes: ByteArray? = null

        try {
            root = ZkCoreCrypto.deriveRoot(
                accountKey = newAccountKey,
                userSalt = newSalt,
                passphrase = cleanPassphrase,
                argon2Params = kdfParams.toArgon2Params(),
                cryptoProvider = cryptoProvider,
                argon2Provider = argon2Provider
            )
            kekAndAuth = ZkCoreCrypto.deriveKekAndAuthSecret(root, cryptoProvider)
            wrappedVkBytes = ZkCoreCrypto.wrapVaultKey(
                kek = kekAndAuth.kek,
                vaultKey = newVk,
                userId = userId,
                cryptoProvider = cryptoProvider
            )
            val saltB64u = ZkCoreCrypto.toBase64Url(newSalt)
            val authSecretB64u = ZkCoreCrypto.toBase64Url(kekAndAuth.authSecret)
            val wrappedVkB64u = ZkCoreCrypto.toBase64Url(wrappedVkBytes)
            val tokenTrimmed = setupOrInviteToken?.trim()?.ifEmpty { null }

            val regResp = apiClient.register(
                username = cleanUsername,
                userId = userId,
                saltB64u = saltB64u,
                kdfParams = kdfParams,
                authSecretB64u = authSecretB64u,
                wrappedVaultKeyB64u = wrappedVkB64u,
                setupTokenOrNull = tokenTrimmed,
                inviteTokenOrNull = tokenTrimmed
            )

            zeroizeInMemorySecrets()
            val derivedSubkeys = ZkCoreCrypto.deriveSubkeys(newVk, cryptoProvider)
            this.vaultKey = newVk.copyOf()
            this.subkeys = derivedSubkeys
            this.accountKey = newAccountKey.copyOf()
            this.userSalt = newSalt.copyOf()
            this.lastAuthSecretBytes = kekAndAuth.authSecret.copyOf()
            this.currentHasPassphrase = cleanPassphrase != null
            this.currentKdfParams = regResp.kdfParams
            this.wrappedVaultKeyB64u = regResp.wrappedVaultKeyB64u
            this.currentUserId = regResp.userId
            this.currentUsername = regResp.username
            this.lastKdfChangeWarning = null

            kdfPinningStore.set(
                PinnedKdfRecord(
                    username = regResp.username,
                    saltB64u = regResp.saltB64u,
                    memoryKiB = regResp.kdfParams.memoryKiB,
                    iterations = regResp.kdfParams.iterations,
                    parallelism = regResp.kdfParams.parallelism,
                    pinnedAtMs = clockMs()
                )
            )
            metadataStore.saveLastAccount(regResp.userId, regResp.username)

            touchActivity()
            publishState(lockReason = null)

            return ZkKeyFileV2(
                formatVersion = 2,
                username = regResp.username,
                userId = regResp.userId,
                accountKeyB64u = ZkCoreCrypto.toBase64Url(newAccountKey),
                saltB64u = regResp.saltB64u,
                kdfParams = regResp.kdfParams,
                hasPassphrase = cleanPassphrase != null,
                createdAt = java.time.Instant.ofEpochMilli(clockMs()).toString()
            )
        } finally {
            newAccountKey.zeroize()
            newSalt.zeroize()
            newVk.zeroize()
            root?.zeroize()
            kekAndAuth?.zeroizeAll()
            wrappedVkBytes?.zeroize()
        }
    }

    suspend fun loginWithKeyFileJson(
        keyFileJson: String,
        passphrase: String = ""
    ): KdfChangeWarning? {
        val parsed = try {
            ZkAccountCredentialsCodec.parseKeyFileJson(keyFileJson)
        } catch (_: Throwable) {
            throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE)
        }
        val akBytes = try {
            ZkCoreCrypto.fromBase64Url(parsed.accountKeyB64u)
        } catch (_: Throwable) {
            throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE)
        }
        val effectivePassphrase = if (!parsed.hasPassphrase && passphrase.isEmpty()) "" else passphrase
        return try {
            performLoginInternal(
                username = parsed.username,
                accountKeyBytes = akBytes,
                passphrase = effectivePassphrase,
                keyFileHint = parsed
            )
        } finally {
            akBytes.zeroize()
        }
    }

    suspend fun loginWithRecoveryCode(
        username: String,
        recoveryCode: String,
        passphrase: String
    ): KdfChangeWarning? {
        val cleanUser = username.trim()
        if (cleanUser.isEmpty()) {
            throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE)
        }
        val akBytes = try {
            ZkAccountCredentialsCodec.parseRecoveryCodeToAccountKey(recoveryCode)
        } catch (_: Throwable) {
            throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE)
        }
        return try {
            performLoginInternal(
                username = cleanUser,
                accountKeyBytes = akBytes,
                passphrase = passphrase,
                keyFileHint = null
            )
        } finally {
            akBytes.zeroize()
        }
    }

    private suspend fun performLoginInternal(
        username: String,
        accountKeyBytes: ByteArray,
        passphrase: String,
        keyFileHint: ZkKeyFileV2?
    ): KdfChangeWarning? {
        apiClient.validateBaseUrl()

        val paramsResp = try {
            apiClient.fetchLoginParams(username)
        } catch (httpErr: V2ApiHttpException) {
            if (httpErr.statusCode == 400 || httpErr.statusCode == 401) {
                throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE, httpErr)
            }
            throw httpErr
        }

        val (saltBytes, warning) = validateAndCheckKdfPinning(
            username = username,
            saltB64u = paramsResp.saltB64u,
            kdfParams = paramsResp.kdfParams,
            keyFileHint = keyFileHint
        )

        var root: ByteArray? = null
        var kekAndAuth: ZkCoreCrypto.KekAndAuthSecret? = null
        var authSecretB64u = ""
        try {
            root = ZkCoreCrypto.deriveRoot(
                accountKey = accountKeyBytes,
                userSalt = saltBytes,
                passphrase = passphrase.ifEmpty { null },
                argon2Params = paramsResp.kdfParams.toArgon2Params(),
                cryptoProvider = cryptoProvider,
                argon2Provider = argon2Provider
            )
            kekAndAuth = ZkCoreCrypto.deriveKekAndAuthSecret(root, cryptoProvider)
            authSecretB64u = ZkCoreCrypto.toBase64Url(kekAndAuth.authSecret)

            val loginResp = try {
                apiClient.login(username, authSecretB64u)
            } catch (httpErr: V2ApiHttpException) {
                if (httpErr.statusCode in listOf(400, 401, 403)) {
                    throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE, httpErr)
                }
                throw httpErr
            }

            if (keyFileHint?.userId != null && !keyFileHint.userId.equals(loginResp.userId, ignoreCase = true)) {
                throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE)
            }

            val wrappedVkBytes = try {
                ZkCoreCrypto.fromBase64Url(loginResp.wrappedVaultKeyB64u)
            } catch (e: ZkCryptoException) {
                throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE, e)
            }

            val vk = try {
                ZkCoreCrypto.unwrapVaultKey(
                    kek = kekAndAuth.kek,
                    wrappedVk = wrappedVkBytes,
                    userId = loginResp.userId,
                    cryptoProvider = cryptoProvider
                )
            } catch (e: ZkCryptoException) {
                throw ZkUniformAuthException(UNIFORM_AUTH_ERROR_MESSAGE, e)
            } finally {
                wrappedVkBytes.zeroize()
            }

            // Replace any prior session keys cleanly (best-effort wipe old first)
            zeroizeInMemorySecrets()

            val derivedSubkeys = ZkCoreCrypto.deriveSubkeys(vk, cryptoProvider)
            this.vaultKey = vk
            this.subkeys = derivedSubkeys
            this.accountKey = accountKeyBytes.copyOf()
            this.userSalt = saltBytes.copyOf()
            this.lastAuthSecretBytes = kekAndAuth.authSecret.copyOf()
            this.currentHasPassphrase = passphrase.isNotEmpty()
            this.currentKdfParams = loginResp.kdfParams
            this.wrappedVaultKeyB64u = loginResp.wrappedVaultKeyB64u
            this.currentUserId = loginResp.userId
            this.currentUsername = loginResp.username

            kdfPinningStore.set(
                PinnedKdfRecord(
                    username = loginResp.username,
                    saltB64u = loginResp.saltB64u,
                    memoryKiB = loginResp.kdfParams.memoryKiB,
                    iterations = loginResp.kdfParams.iterations,
                    parallelism = loginResp.kdfParams.parallelism,
                    pinnedAtMs = clockMs()
                )
            )
            metadataStore.saveLastAccount(loginResp.userId, loginResp.username)

            touchActivity()
            publishState(lockReason = null)
            return warning
        } finally {
            root?.zeroize()
            kekAndAuth?.zeroizeAll()
            saltBytes.zeroize()
        }
    }

    private fun persistEncryptedBioSessionEnvelope(vk: ByteArray) {
        val uid = currentUserId ?: return
        val uname = currentUsername ?: return
        val authBytes = lastAuthSecretBytes ?: return
        val payloadJson = JSONObject()
            .put("v", 1)
            .put("userId", uid)
            .put("username", uname)
            .put("authSecretB64u", ZkCoreCrypto.toBase64Url(authBytes))
            .put("hasPassphrase", currentHasPassphrase)
            .toString()
        val encBytes = ZkCoreCrypto.encryptBiometricSessionEnvelope(
            vaultKey = vk,
            userId = uid,
            plaintextJson = payloadJson,
            cryptoProvider = cryptoProvider
        )
        metadataStore.saveEncryptedBioSession(ZkCoreCrypto.toBase64Url(encBytes))
    }

    fun prepareBiometricEnrollmentSession(): VaultKeyStore.BiometricCryptoSession {
        if (!isUnlocked()) throw IllegalStateException("Vault must be unlocked before enrolling biometrics.")
        touchActivity()
        return vaultKeyStore.prepareBiometricEncryptSession()
    }

    fun completeBiometricEnrollment(
        unlockedSession: VaultKeyStore.BiometricCryptoSession
    ): VaultKeyStore.KeyProtectionStatus {
        val vkCopy = copyVaultKeyForAuthorizedWrap()
        return try {
            val status = vaultKeyStore.finishBiometricWrap(vkCopy, unlockedSession)
            persistEncryptedBioSessionEnvelope(vkCopy)
            publishState()
            status
        } finally {
            vkCopy.zeroize()
        }
    }

    fun prepareBiometricUnlockSession(): VaultKeyStore.BiometricCryptoSession {
        return try {
            vaultKeyStore.prepareBiometricDecryptSession()
        } catch (e: VaultKeyStore.KeyInvalidatedException) {
            handleBiometricKeyInvalidated()
            throw e
        }
    }

    fun completeBiometricUnlock(unlockedSession: VaultKeyStore.BiometricCryptoSession) {
        val storedUserId = currentUserId ?: metadataStore.getLastUserId()
            ?: throw IllegalStateException("Identificativo utente non disponibile per lo sblocco biometrico.")
        val storedUsername = currentUsername ?: metadataStore.getLastUsername()

        val vk = try {
            vaultKeyStore.finishBiometricUnwrap(unlockedSession)
        } catch (e: VaultKeyStore.KeyInvalidatedException) {
            handleBiometricKeyInvalidated()
            throw e
        }
        val derivedSubkeys = ZkCoreCrypto.deriveSubkeys(vk, cryptoProvider)

        zeroizeInMemorySecrets()
        this.vaultKey = vk
        this.subkeys = derivedSubkeys
        this.currentUserId = storedUserId
        this.currentUsername = storedUsername

        touchActivity()
        publishState(lockReason = null)
    }

    /**
     * Renews the HTTP session cookie transparently after a cold biometric unlock.
     * Decrypts the VK-protected `authSecret` envelope in RAM, calls `POST /api/v2/login`,
     * and keeps the decrypted secret strictly in RAM until lock/logout.
     * Returns `true` if a valid HTTP session is now active, `false` if full keyfile login is required.
     */
    suspend fun ensureHttpSessionAfterBiometricUnlock(): Boolean {
        if (!isUnlocked()) return false
        if (apiClient.hasActiveSessionCookie()) return true
        val vk = vaultKey ?: return false
        val uid = currentUserId ?: return false
        val encEnvelopeB64u = metadataStore.getEncryptedBioSession() ?: return false

        val encBytes = try {
            ZkCoreCrypto.fromBase64Url(encEnvelopeB64u)
        } catch (_: Throwable) {
            return false
        }
        val decryptedJson = try {
            ZkCoreCrypto.decryptBiometricSessionEnvelope(
                vaultKey = vk,
                userId = uid,
                encryptedEnvelope = encBytes,
                cryptoProvider = cryptoProvider
            )
        } catch (_: Throwable) {
            return false
        }
        return try {
            val obj = JSONObject(decryptedJson)
            val username = obj.optString("username", "").trim()
            val authSecretB64u = obj.optString("authSecretB64u", "").trim()
            val hasPass = obj.optBoolean("hasPassphrase", true)
            if (username.isEmpty() || authSecretB64u.isEmpty()) return false
            val loginResp = apiClient.login(username, authSecretB64u)
            this.currentUserId = loginResp.userId
            this.currentUsername = loginResp.username
            this.currentKdfParams = loginResp.kdfParams
            this.wrappedVaultKeyB64u = loginResp.wrappedVaultKeyB64u
            this.currentHasPassphrase = hasPass
            this.lastAuthSecretBytes?.zeroize()
            this.lastAuthSecretBytes = ZkCoreCrypto.fromBase64Url(authSecretB64u)
            publishState(lockReason = null)
            true
        } catch (_: Throwable) {
            false
        }
    }

    private fun handleBiometricKeyInvalidated() {
        autoLockJob?.cancel()
        autoLockJob = null
        zeroizeInMemorySecrets()
        vaultKeyStore.clearBiometricWrappedVk()
        metadataStore.clearEncryptedBioSession()
        publishState(
            lockReason = "Chiave biometrica invalidata (biometria modificata). Accedi con File Chiave."
        )
    }

    fun enableBackgroundBackupKey(): VaultKeyStore.KeyProtectionStatus {
        val vkCopy = copyVaultKeyForAuthorizedWrap()
        return try {
            val status = vaultKeyStore.wrapForBackground(vkCopy)
            publishState()
            status
        } finally {
            vkCopy.zeroize()
        }
    }

    fun disableBackgroundBackupKey() {
        vaultKeyStore.clearBackgroundWrappedVk()
        publishState()
    }

    /**
     * Rotates user passphrase without re-encrypting any vault blob or metadata (`/api/v2/account/rewrap`).
     * Optionally recovers `accountKey` from [recoveryCodeOrKeyFileAccountKey] if unlocked via biometrics.
     */
    suspend fun changePassphrase(
        oldPassphrase: String,
        newPassphrase: String,
        recoveryCodeOrNull: String? = null,
        allowRemovePassphrase: Boolean = false
    ): V2RewrapResponse {
        val vk = vaultKey ?: throw IllegalStateException("Vault bloccato.")
        val userId = currentUserId ?: throw IllegalStateException("userId mancante.")
        val username = currentUsername ?: throw IllegalStateException("username mancante.")

        val akToUse: ByteArray = when {
            accountKey != null -> accountKey!!.copyOf()
            !recoveryCodeOrNull.isNullOrBlank() -> ZkAccountCredentialsCodec.parseRecoveryCodeToAccountKey(recoveryCodeOrNull)
            else -> throw IllegalStateException("Inserisci il Recovery Code o effettua il login completo per cambiare passphrase.")
        }

        val effectiveNewPassphrase = if (allowRemovePassphrase && newPassphrase.isEmpty()) null else newPassphrase
        if (effectiveNewPassphrase != null) {
            val strength = ZkAccountCredentialsCodec.evaluatePassphraseStrength(effectiveNewPassphrase)
            if (!strength.valid) {
                akToUse.zeroize()
                throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, strength.feedback)
            }
        }

        val oldSalt = userSalt?.copyOf() ?: run {
            val paramsResp = apiClient.fetchLoginParams(username)
            ZkCoreCrypto.fromBase64Url(paramsResp.saltB64u)
        }
        val kdfForOld = currentKdfParams ?: V2KdfParamsDto(
            algorithm = "Argon2id",
            memoryKiB = ZkArgon2id.MIN_ARGON2_MEMORY_KIB,
            iterations = ZkArgon2id.MIN_ARGON2_ITERATIONS,
            parallelism = ZkArgon2id.MIN_ARGON2_PARALLELISM
        )
        val newKdfParams = V2KdfParamsDto(
            algorithm = "Argon2id",
            memoryKiB = maxOf(kdfForOld.memoryKiB, ZkArgon2id.MIN_ARGON2_MEMORY_KIB),
            iterations = maxOf(kdfForOld.iterations, ZkArgon2id.MIN_ARGON2_ITERATIONS),
            parallelism = maxOf(kdfForOld.parallelism, ZkArgon2id.MIN_ARGON2_PARALLELISM)
        )

        var oldRoot: ByteArray? = null
        var oldKeys: ZkCoreCrypto.KekAndAuthSecret? = null
        var newSalt: ByteArray? = null
        var newRoot: ByteArray? = null
        var newKeys: ZkCoreCrypto.KekAndAuthSecret? = null
        var newWrappedVkBytes: ByteArray? = null

        try {
            oldRoot = ZkCoreCrypto.deriveRoot(
                accountKey = akToUse,
                userSalt = oldSalt,
                passphrase = oldPassphrase.ifEmpty { null },
                argon2Params = kdfForOld.toArgon2Params(),
                cryptoProvider = cryptoProvider,
                argon2Provider = argon2Provider
            )
            oldKeys = ZkCoreCrypto.deriveKekAndAuthSecret(oldRoot, cryptoProvider)

            val currentWrapped = wrappedVaultKeyB64u
            if (currentWrapped != null) {
                val unwrappedCheck = try {
                    ZkCoreCrypto.unwrapVaultKey(
                        kek = oldKeys.kek,
                        wrappedVk = ZkCoreCrypto.fromBase64Url(currentWrapped),
                        userId = userId,
                        cryptoProvider = cryptoProvider
                    )
                } catch (e: ZkCryptoException) {
                    throw ZkUniformAuthException("Passphrase attuale non valida.", e)
                }
                val sameVk = ZkCoreCrypto.constantTimeEqual(unwrappedCheck, vk)
                unwrappedCheck.zeroize()
                if (!sameVk) {
                    throw ZkUniformAuthException("Passphrase attuale non valida.")
                }
            }
            val oldAuthSecretB64u = ZkCoreCrypto.toBase64Url(oldKeys.authSecret)

            newSalt = cryptoProvider.randomBytes(16)
            val newSaltB64u = ZkCoreCrypto.toBase64Url(newSalt)
            newRoot = ZkCoreCrypto.deriveRoot(
                accountKey = akToUse,
                userSalt = newSalt,
                passphrase = effectiveNewPassphrase,
                argon2Params = newKdfParams.toArgon2Params(),
                cryptoProvider = cryptoProvider,
                argon2Provider = argon2Provider
            )
            newKeys = ZkCoreCrypto.deriveKekAndAuthSecret(newRoot, cryptoProvider)
            newWrappedVkBytes = ZkCoreCrypto.wrapVaultKey(
                kek = newKeys.kek,
                vaultKey = vk,
                userId = userId,
                cryptoProvider = cryptoProvider
            )
            val newAuthSecretB64u = ZkCoreCrypto.toBase64Url(newKeys.authSecret)
            val newWrappedVkB64u = ZkCoreCrypto.toBase64Url(newWrappedVkBytes)

            val resp = apiClient.rewrapAccount(
                oldAuthSecretB64u = oldAuthSecretB64u,
                newSaltB64u = newSaltB64u,
                newKdfParams = newKdfParams,
                newAuthSecretB64u = newAuthSecretB64u,
                newWrappedVaultKeyB64u = newWrappedVkB64u
            )

            this.accountKey?.zeroize()
            this.accountKey = akToUse.copyOf()
            this.userSalt?.zeroize()
            this.userSalt = ZkCoreCrypto.fromBase64Url(resp.saltB64u)
            this.lastAuthSecretBytes?.zeroize()
            this.lastAuthSecretBytes = newKeys.authSecret.copyOf()
            this.currentHasPassphrase = effectiveNewPassphrase != null
            this.currentKdfParams = resp.kdfParams
            this.wrappedVaultKeyB64u = resp.wrappedVaultKeyB64u
            this.lastKdfChangeWarning = null

            if (vaultKeyStore.hasBiometricWrappedVk()) {
                persistEncryptedBioSessionEnvelope(vk)
            }

            kdfPinningStore.set(
                PinnedKdfRecord(
                    username = username,
                    saltB64u = resp.saltB64u,
                    memoryKiB = resp.kdfParams.memoryKiB,
                    iterations = resp.kdfParams.iterations,
                    parallelism = resp.kdfParams.parallelism,
                    pinnedAtMs = clockMs()
                )
            )
            touchActivity()
            publishState()
            return resp
        } finally {
            akToUse.zeroize()
            oldSalt.zeroize()
            oldRoot?.zeroize()
            oldKeys?.zeroizeAll()
            newSalt?.zeroize()
            newRoot?.zeroize()
            newKeys?.zeroizeAll()
            newWrappedVkBytes?.zeroize()
        }
    }

    fun lock(reason: String? = "Vault bloccato.") {
        autoLockJob?.cancel()
        autoLockJob = null
        zeroizeInMemorySecrets()
        publishState(lockReason = reason)
    }

    suspend fun logout() {
        autoLockJob?.cancel()
        autoLockJob = null
        try {
            apiClient.logout()
        } catch (_: Throwable) {
            apiClient.cookieJar.clear()
        } finally {
            zeroizeInMemorySecrets()
            vaultKeyStore.deleteAllKeys()
            metadataStore.clear()
            currentUserId = null
            currentUsername = null
            wrappedVaultKeyB64u = null
            currentKdfParams = null
            lastKdfChangeWarning = null
            publishState(lockReason = null)
        }
    }

    private fun zeroizeInMemorySecrets() {
        subkeys?.zeroizeAll()
        subkeys = null
        vaultKey?.zeroize()
        vaultKey = null
        accountKey?.zeroize()
        accountKey = null
        userSalt?.zeroize()
        userSalt = null
        lastAuthSecretBytes?.zeroize()
        lastAuthSecretBytes = null
    }
}
