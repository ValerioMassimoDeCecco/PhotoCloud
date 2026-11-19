# PhotoCloud Zero-Knowledge v2 — Fasi 4C & 4D (Android Upload, Auto-Backup, Galleria, Viewer, Album, Share)

## 1. Obiettivo e Isolamento
Completamento end-to-end del client Android Zero-Knowledge v2 (`com.valerio.photocloud.zk`) mantenendo il flusso v1 legacy intatto dietro il feature flag `zk_v2_enabled` (default `false`). Nessuna classe del package `zk` viene istanziata o invocata quando `zk_v2_enabled == false`.

## 2. Fase 4C — Upload Streaming, Metadati, Miniature, Dedup e Auto-Backup v2

- **`PhotoCloudZkApiClientV2.kt`**: esteso con tutti gli endpoint `/api/v2/*`:
  - `initBlobUpload`, `uploadBlobChunk` (con `V2ChunkOutOfOrderException` su `409 CHUNK_OUT_OF_ORDER`), `completeBlobUpload`
  - `uploadEncryptedThumbnail` / `downloadEncryptedThumbnail` (`320` e `1280`)
  - `downloadBlobRange` (RFC 9110 `Range` / `206` con parsing `Content-Range`) e `downloadBlobToStream`
  - `checkBackupDedupTags` (`POST /api/v2/backup/check`)
  - `updateItemMeta`, `replaceItemBlob`, `moveToTrash`, `restoreFromTrash`, `deleteItemPermanently`, `emptyTrash`, `fetchStats`
  - `fetchEncryptedAlbums` / `putEncryptedAlbums` (`ETag` / `If-Match` `412`)
  - `createShare` / `revokeShare`
- **`VaultKeyStore.kt`**: aggiunti `wrapSecretWithBackgroundKey` e `unwrapSecretWithBackgroundKey` sulla chiave dedicata `photocloud_vk_bg_v2` (`setUnlockedDeviceRequired(true)`) per proteggere le `FK` nei checkpoint di upload resumable senza mai salvare `FK` in chiaro.
- **`ZkMetaAndThumbGenerator.kt`**:
  - `ZkBlobPlaintextMeta` / `DefaultZkMetaBuilder` allineati byte-per-byte a `docs/zk-spec.md` §5 e `src/lib/zk/metaAndDedup.ts`; coordinate GPS (`lat`, `lon`, `altitude`) escluse di default (`includeGps = false`).
  - `AndroidZkThumbnailGenerator`: decodifica campionata anti-OOM (`inJustDecodeBounds` + `inSampleSize` potenza di 2), orientamento EXIF, poster video via `MediaMetadataRetriever`, compressione JPEG in RAM (`320` e `1280`), `recycle()` + `.zeroize()` in `finally`.
- **`ZkBlobUploadPipeline.kt`**:
  - Dedup opaco in streaming a blocchi da 64 KiB (`HMAC-SHA256(dedupKey, plaintext)`) con `POST /api/v2/backup/check` prima di cifrare/caricare.
  - Cifratura `PCZK v1` in streaming a memoria costante verso spool privato solo-ciphertext (`cacheDir/zk_upload_spool/zk_spool_<blobId>.pczk.tmp`). Il plaintext non tocca mai il disco.
  - `FileSliceRequestBody` trasmette i chunk in streaming da 64 KiB (testato con upload 305 MiB sotto `-Xmx128m`).
  - Upload resumable persistito con `uploadId`, `nextChunkIndex`, `blobId`, `noncePrefix`, `wrappedFkKeystoreB64u` (mai `FK` in chiaro); gestione `409 CHUNK_OUT_OF_ORDER`, `404 UPLOAD_EXPIRED`, cancellazione spool a fine operazione e pulizia orfani all'avvio (`cleanupOrphanSpoolFiles`).
- **`ZkTransferManager.kt`**: coda interattiva con parallelismo configurabile `1..16` (default `2`), `pause`/`resume`/`cancel` per singolo trasferimento e avviso esplicito per server non-HTTPS.
- **`ZkAutoBackupWorker.kt`**:
  - Motore puro `ZkAutoBackupEngine` (riusando `AutoBackupLogic.shouldIncludeCandidate`), unwrap `VK` da `photocloud_vk_bg_v2`, azzeramento `VK` + subkeys in `finally`, gestione `DeviceLockedException` (notifica dedicata + `Result.retry()`), distinzione `413` quota / `401` sessione / `422` integrità / errori rete retryable.
  - `ZkAutoBackupWorker` (`CoroutineWorker` foreground `dataSync`), azioni notifica Pausa/Annulla (`ZkAutoBackupActionReceiver`), `ContentUriTrigger` su `MediaStore` e backoff esponenziale.

## 3. Fase 4D — Galleria E2EE, Viewer, Video Streaming, Album, Cestino e Share Link

- **`ZkVaultRepository.kt`**:
  - `EncryptedThumbDiskCache`: disco solo-ciphertext con eviction LRU (`AutoBackupLogic.planLruEvictions`); miniature decifrate solo in RAM con `.zeroize()` su eviction, lock, `onStop` e logout.
  - `ZkChunkedRangeReader` + `ZkAndroidMediaDataSource`: lettura random-access `Range 206` con LRU da 4 chunk in RAM (azzerati alla chiusura) e zero file temporanei in chiaro su disco per la riproduzione video.
  - `ZkExternalOpenHelper`: cartella isolata `cacheDir/zk_external_share/` con sovrascrittura deterministica a zeri + `fd.sync()` + rimozione su startup, lock, `onStop` e logout.
  - Album cifrati (`GET/PUT /api/v2/albums` con `ETag`/`If-Match`), cestino/ripristino/eliminazione, statistiche e condivisione Zero-Knowledge (`/v2/s/<shareId>#<base64url(shareKey)>`, con `shareKey` mai trasmessa al server).
- **`ZkV2VaultScreen.kt` & `ZkV2AuthScreen.kt`**:
  - Interfaccia Material 3 a 4 tab (**Galleria**, **Album**, **Cestino**, **Sicurezza**) collegata a `ZkV2AuthCoordinator` quando il vault è sbloccato, preservando tutti i dialoghi TOFU, KDF pinning, biometria Strong, rewrap e lock/logout della Fase 4B.

## 4. Test, Mutazioni Negative e CI
- **`ZkUploadAndBackupV2Test.kt`**: copre streaming 305 MiB sotto `-Xmx128m`, resume + `409` + zero `FK` in chiaro + pulizia orfani, `encMeta` GPS policy, miniature cifrate + `EncryptedThumbDiskCache`, dedup + `ZkNetworkSpyInterceptor`, `ZkAutoBackupEngine`, `ZkTransferManager`, `ZkChunkedRangeReader`, `ZkExternalOpenHelper`, album cifrati e share link.
- **4 nuove mutazioni documentate** (esclusivamente in `src/test/`, zero switch in `src/main/`) eseguite in CI (`android-integration`):
  1. `skip_dedup_check`
  2. `leak_filename_in_header`
  3. `persist_plaintext_fk`
  4. `include_gps_by_default`
- **`AndroidLiveIntegrationTest.kt`**: esteso con upload live via `ZkBlobUploadPipeline`, miniatura 320 cifrata, dedup hit live, Range 206 decrypt, album cifrati live e share link live (creazione + revoca) sotto `ZkNetworkSpyInterceptor`.
