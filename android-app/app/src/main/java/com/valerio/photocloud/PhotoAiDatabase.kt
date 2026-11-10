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

    @Query("SELECT * FROM photo_ai_categories WHERE isAnalyzed = 1 ORDER BY timestamp DESC")
    fun observeAllAnalyzed(): Flow<List<PhotoAiEntity>>

    @Query(
        """
        SELECT * FROM photo_ai_categories
        WHERE isAnalyzed = 1
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
        """
    )
    fun observeIndexingProgress(): Flow<PhotoAiProgressTuple>

    @Query("SELECT uriString FROM photo_ai_categories WHERE isAnalyzed = 1")
    suspend fun getAnalyzedUriStrings(): List<String>

    @Query("SELECT mediaStoreId FROM photo_ai_categories WHERE isAnalyzed = 1 AND mediaStoreId > 0")
    suspend fun getAnalyzedMediaStoreIds(): List<Long>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<PhotoAiEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: PhotoAiEntity)

    @Query("UPDATE photo_ai_categories SET isAnalyzed = 0")
    suspend fun resetAllForReindex()
}

@Database(
    entities = [PhotoAiEntity::class],
    version = 1,
    exportSchema = false
)
abstract class PhotoAiDatabase : RoomDatabase() {

    abstract fun photoAiDao(): PhotoAiDao

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
        @Volatile
        private var INSTANCE: PhotoAiDatabase? = null

        fun getInstance(context: Context): PhotoAiDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    PhotoAiDatabase::class.java,
                    "photocloud_ai_categories.db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
