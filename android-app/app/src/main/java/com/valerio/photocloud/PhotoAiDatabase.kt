package com.valerio.photocloud

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Room Entity storing the On-Device AI photo classification result.
 *
 * Supports both local device MediaStore photos (`mediaStoreId > 0`, `uriString = content://...`)
 * and PhotoCloud encrypted vault photos (`uriString = cloud://<filename>`).
 */
@Entity(tableName = "photo_ai_categories")
data class PhotoAiEntity(
    @PrimaryKey
    val uriString: String,
    val mediaStoreId: Long = 0L,
    val filename: String = "",
    val categories: String = "",
    val topConfidence: Float = 0f,
    val isAnalyzed: Boolean = false,
    val timestamp: Long = System.currentTimeMillis()
) {
    fun parsedCategoriesList(): List<String> {
        if (categories.isBlank()) return emptyList()
        return categories
            .split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
    }
}

data class PhotoAiProgressTuple(
    val totalCount: Int,
    val analyzedCount: Int
)

data class AiCategoryChipModel(
    val category: String,
    val count: Int
)

@Dao
interface PhotoAiDao {

    @Query("SELECT * FROM photo_ai_categories WHERE isAnalyzed = 1 AND uriString LIKE 'cloud://%' ORDER BY timestamp DESC")
    fun observeAllAnalyzed(): Flow<List<PhotoAiEntity>>

    @Query(
        """
        SELECT * FROM photo_ai_categories
        WHERE isAnalyzed = 1
          AND uriString LIKE 'cloud://%'
          AND (',' || categories || ',' LIKE '%,' || :category || ',%'
               OR categories LIKE '%' || :category || '%')
        ORDER BY topConfidence DESC, timestamp DESC
        """
    )
    fun observePhotosByCategory(category: String): Flow<List<PhotoAiEntity>>

    @Query(
        """
        SELECT
            COUNT(*) AS totalCount,
            COALESCE(SUM(CASE WHEN isAnalyzed = 1 THEN 1 ELSE 0 END), 0) AS analyzedCount
        FROM photo_ai_categories
        WHERE uriString LIKE 'cloud://%'
        """
    )
    fun observeIndexingProgress(): Flow<PhotoAiProgressTuple>

    @Query("SELECT uriString FROM photo_ai_categories WHERE isAnalyzed = 1 AND uriString LIKE 'cloud://%'")
    suspend fun getAnalyzedUriStrings(): List<String>

    @Query("SELECT uriString FROM photo_ai_categories WHERE uriString LIKE 'cloud://%'")
    suspend fun getAllCloudUriStrings(): List<String>

    @Query("DELETE FROM photo_ai_categories WHERE uriString NOT LIKE 'cloud://%'")
    suspend fun deleteNonCloudEntries()

    @Query("DELETE FROM photo_ai_categories WHERE uriString IN (:uriStrings)")
    suspend fun deleteByUriStrings(uriStrings: List<String>)

    @Query("DELETE FROM photo_ai_categories")
    suspend fun clearAllEntries()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<PhotoAiEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: PhotoAiEntity)

    @Query("UPDATE photo_ai_categories SET isAnalyzed = 0 WHERE uriString LIKE 'cloud://%'")
    suspend fun resetAllForReindex()
}

// ---------------------------------------------------------------------------
// v1.5.0 — Persistent Auto-Backup State Machine (Room Migration 1 -> 2)
// ---------------------------------------------------------------------------

object BackupItemStatus {
    const val PENDING = "PENDING"
    const val UPLOADING = "UPLOADING"
    const val UPLOADED = "UPLOADED"
    const val SKIPPED = "SKIPPED"
    const val FAILED = "FAILED"
}

@Entity(tableName = "backup_state")
data class BackupStateEntity(
    @PrimaryKey
    val mediaStoreId: Long,
    val uriString: String,
    val displayName: String,
    val bucketName: String,
    val mimeType: String,
    val isVideo: Boolean,
    val sizeBytes: Long,
    val dateTakenMs: Long,
    val sha256: String,
    val status: String,
    val attemptCount: Int = 0,
    val lastError: String = "",
    val serverFilename: String = "",
    val updatedAtMs: Long = System.currentTimeMillis()
)

data class BackupStatusSummaryTuple(
    val pendingCount: Int,
    val uploadingCount: Int,
    val uploadedCount: Int,
    val skippedCount: Int,
    val failedCount: Int
)

@Dao
interface BackupStateDao {

    @Query(
        """
        SELECT
            COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pendingCount,
            COALESCE(SUM(CASE WHEN status = 'UPLOADING' THEN 1 ELSE 0 END), 0) AS uploadingCount,
            COALESCE(SUM(CASE WHEN status = 'UPLOADED' THEN 1 ELSE 0 END), 0) AS uploadedCount,
            COALESCE(SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END), 0) AS skippedCount,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failedCount
        FROM backup_state
        """
    )
    fun observeSummary(): Flow<BackupStatusSummaryTuple>

    @Query("SELECT * FROM backup_state")
    suspend fun getAll(): List<BackupStateEntity>

    @Query("SELECT * FROM backup_state WHERE mediaStoreId = :id LIMIT 1")
    suspend fun getById(id: Long): BackupStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: BackupStateEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<BackupStateEntity>)

    @Query("UPDATE backup_state SET status = 'PENDING', lastError = '' WHERE status IN ('FAILED', 'UPLOADING')")
    suspend fun resetRetryableStates()

    @Query("DELETE FROM backup_state WHERE status IN ('FAILED', 'PENDING', 'UPLOADING')")
    suspend fun clearIncompleteStates()
}

@Database(
    entities = [PhotoAiEntity::class, BackupStateEntity::class],
    version = 2,
    exportSchema = false
)
abstract class PhotoAiDatabase : RoomDatabase() {

    abstract fun photoAiDao(): PhotoAiDao
    abstract fun backupStateDao(): BackupStateDao

    /**
     * Reactive Flow of all distinct categories found by On-Device AI, sorted descending by photo count.
     */
    fun observeDistinctCategoriesWithCount(): Flow<List<AiCategoryChipModel>> {
        return photoAiDao().observeAllAnalyzed().map { entities ->
            val counts = LinkedHashMap<String, Int>()
            for (entity in entities) {
                for (cat in entity.parsedCategoriesList()) {
                    counts[cat] = (counts[cat] ?: 0) + 1
                }
            }
            counts.entries
                .map { AiCategoryChipModel(category = it.key, count = it.value) }
                .sortedWith(compareByDescending<AiCategoryChipModel> { it.count }.thenBy { it.category })
        }
    }

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `backup_state` (
                        `mediaStoreId` INTEGER NOT NULL,
                        `uriString` TEXT NOT NULL,
                        `displayName` TEXT NOT NULL,
                        `bucketName` TEXT NOT NULL,
                        `mimeType` TEXT NOT NULL,
                        `isVideo` INTEGER NOT NULL,
                        `sizeBytes` INTEGER NOT NULL,
                        `dateTakenMs` INTEGER NOT NULL,
                        `sha256` TEXT NOT NULL,
                        `status` TEXT NOT NULL,
                        `attemptCount` INTEGER NOT NULL,
                        `lastError` TEXT NOT NULL,
                        `serverFilename` TEXT NOT NULL,
                        `updatedAtMs` INTEGER NOT NULL,
                        PRIMARY KEY(`mediaStoreId`)
                    )
                    """.trimIndent()
                )
            }
        }

        @Volatile
        private var INSTANCE: PhotoAiDatabase? = null

        fun getInstance(context: Context): PhotoAiDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    PhotoAiDatabase::class.java,
                    "photocloud_ai_categories.db"
                )
                    .addMigrations(MIGRATION_1_2)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}

