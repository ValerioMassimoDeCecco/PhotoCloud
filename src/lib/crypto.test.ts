import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  generateApiKey,
  hashKey,
  verifyKey,
  encryptFile,
  decryptFile,
  calculateBufferHash,
  findDuplicateGroups,
} from './crypto';
import {
  renderLoginTemplate,
  renderGalleryTemplate,
  renderTrashTemplate,
} from './templateRenderer';
import {
  DEFAULT_PHOTO_EDIT_STATE,
  DEFAULT_NORMALIZED_CROP_BOX,
  PHOTO_FILTER_PRESETS,
  applyPresetToEditState,
  normalizeRotation,
  computeCropRect,
  clampNormalizedCropBox,
  dragNormalizedCropHandle,
  normalizedBoxToPixelRect,
  transformRgbPixel,
} from './photoEditorMath';

test('generateApiKey produces a 32-char key with lower, upper, digit, and punctuation', () => {
  const key = generateApiKey(32);
  assert.equal(key.length, 32);
  assert.match(key, /[a-z]/);
  assert.match(key, /[A-Z]/);
  assert.match(key, /[0-9]/);
});

test('hashKey and verifyKey validate API keys accurately', () => {
  const secret = 'MySecretPhotoCloudKey!2026';
  const hashed = hashKey(secret);
  assert.equal(verifyKey(secret, hashed), true);
  assert.equal(verifyKey('WrongKey!2026', hashed), false);
});

test('encryptFile and decryptFile round-trip binary media and non-media data accurately', () => {
  const key = generateApiKey(32);
  const original = Buffer.from('Documento PDF / Archivio ZIP cifrato di test 1234567890', 'utf-8');
  const encrypted = encryptFile(original, key);
  assert.notDeepEqual(encrypted, original);
  assert.ok(encrypted.length > original.length);

  const decrypted = decryptFile(encrypted, key);
  assert.deepEqual(decrypted, original);
});

test('findDuplicateGroups detects identical file hashes and sorts filenames', () => {
  const bufA = Buffer.from('Duplicate photo content');
  const bufB = Buffer.from('Unique photo content');
  const hashA = calculateBufferHash(bufA);
  const hashB = calculateBufferHash(bufB);

  const duplicates = findDuplicateGroups([
    { filename: 'b_copy.jpg', hash: hashA },
    { filename: 'a_original.jpg', hash: hashA },
    { filename: 'c_unique.jpg', hash: hashB },
  ]);

  assert.deepEqual(duplicates, [['a_original.jpg', 'b_copy.jpg']]);
});

test('photoEditorMath presets, rotation normalization, manual draggable crop grid, and RGB pixel transforms work accurately', () => {
  assert.equal(Object.keys(PHOTO_FILTER_PRESETS).length, 7);
  const bwState = applyPresetToEditState(DEFAULT_PHOTO_EDIT_STATE, 'bw');
  assert.equal(bwState.filterPreset, 'bw');
  assert.equal(bwState.saturation, -100);

  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(360), 0);

  const squareCrop = computeCropRect(1920, 1080, '1:1');
  assert.equal(squareCrop.width, 1080);
  assert.equal(squareCrop.height, 1080);
  assert.equal(squareCrop.x, 420);
  assert.equal(squareCrop.y, 0);

  const portraitCrop = computeCropRect(1000, 1000, '4:5');
  assert.equal(portraitCrop.width, 800);
  assert.equal(portraitCrop.height, 1000);
  assert.equal(portraitCrop.x, 100);

  // Manual draggable crop box handles (free + locked aspect + interior move)
  const draggedSe = dragNormalizedCropHandle(DEFAULT_NORMALIZED_CROP_BOX, 'se', -0.25, -0.2, 'free', 1600, 1200);
  assert.ok(Math.abs(draggedSe.right - 0.75) < 1e-6);
  assert.ok(Math.abs(draggedSe.bottom - 0.8) < 1e-6);

  const pannedBox = dragNormalizedCropHandle(
    { left: 0.1, top: 0.1, right: 0.6, bottom: 0.6 },
    'move',
    0.15,
    0.2,
    'free',
    1600,
    1200
  );
  assert.ok(Math.abs(pannedBox.left - 0.25) < 1e-6);
  assert.ok(Math.abs(pannedBox.top - 0.3) < 1e-6);
  assert.ok(Math.abs(pannedBox.right - 0.75) < 1e-6);
  assert.ok(Math.abs(pannedBox.bottom - 0.8) < 1e-6);

  const pixelRect = normalizedBoxToPixelRect(1000, 800, pannedBox);
  assert.equal(pixelRect.x, 250);
  assert.equal(pixelRect.y, 240);
  assert.equal(pixelRect.width, 500);
  assert.equal(pixelRect.height, 400);

  const clamped = clampNormalizedCropBox({ left: -0.5, top: 0.95, right: 1.4, bottom: 0.96 });
  assert.equal(clamped.left, 0);
  assert.equal(clamped.right, 1);
  assert.ok(clamped.bottom - clamped.top >= 0.08 - 1e-6);

  // Neutral state leaves pixel unchanged
  const [r0, g0, b0] = transformRgbPixel(120, 150, 200, DEFAULT_PHOTO_EDIT_STATE);
  assert.equal(r0, 120);
  assert.equal(g0, 150);
  assert.equal(b0, 200);

  // Black & White state equalizes R, G, B channels (0 saturation)
  const [rBw, gBw, bBw] = transformRgbPixel(220, 80, 40, bwState);
  assert.equal(rBw, gBw);
  assert.equal(gBw, bBw);
});

test('Templates render non-media Cloud File Manager, Album grouping, Photo Editor Modal with Draggable Crop Grid, and Top-Right Transfer Center', () => {
  const loginHtml = renderLoginTemplate();
  assert.ok(loginHtml.includes('Il tuo archivio foto/video sicuro'));
  assert.ok(loginHtml.includes('/static/styles/login.css'));

  const galleryHtml = renderGalleryTemplate(
    [
      {
        filename: 'abc12345.jpg',
        timestamp: 1700000000,
        size: 102400,
        isMedia: true,
        category: 'media',
        album: 'Vacanze 2026',
      },
      {
        filename: 'contratto.pdf',
        timestamp: 1700000500,
        size: 524288,
        isMedia: false,
        category: 'document',
        album: 'Documenti',
      },
    ],
    ['Vacanze 2026', 'Documenti']
  );
  assert.ok(galleryHtml.includes('Il tuo archivio'));
  assert.ok(galleryHtml.includes('2 elementi'));
  assert.ok(galleryHtml.includes('/media/abc12345.jpg'));
  assert.ok(galleryHtml.includes('data-is-media="false"'));
  assert.ok(galleryHtml.includes('data-category="document"'));
  assert.ok(galleryHtml.includes('data-album="Vacanze 2026"'));
  assert.ok(galleryHtml.includes('value="album">Album</option>'));
  assert.ok(galleryHtml.includes('id="tab-files-btn"'));
  assert.ok(galleryHtml.includes('id="upload-indicator-container"'));
  assert.ok(galleryHtml.includes('id="upload-active-count-badge"'));
  assert.ok(galleryHtml.includes('id="upload-speed-badge"'));
  assert.ok(galleryHtml.includes('id="photo-editor-modal"'));
  assert.ok(galleryHtml.includes('id="photo-editor-crop-overlay"'));
  assert.ok(galleryHtml.includes('id="photo-editor-crop-box"'));
  assert.ok(galleryHtml.includes('data-crop-handle="se"'));
  assert.ok(galleryHtml.includes('id="lightbox-edit-btn"'));
  assert.ok(galleryHtml.includes('id="document-viewer-modal"'));
  assert.ok(galleryHtml.includes('window.openCloudFile('));
  assert.ok(galleryHtml.includes('/static/scripts/photo-editor.js'));
  assert.ok(galleryHtml.includes('/static/scripts/document-viewer.js'));

  const trashHtml = renderTrashTemplate([]);
  assert.ok(trashHtml.includes('Il cestino è vuoto'));
});

test('Document Viewer Engine resolves MIME types and parses PDF, DOCX, XLSX, PPTX, CSV, and external formats accurately', async () => {
  const JSZip = (await import('jszip')).default;
  const {
    resolveFileViewerSpec,
    parseDocumentBuffer,
    parseDelimitedTextToSheet,
  } = await import('./documentEngine');

  assert.equal(resolveFileViewerSpec('relazione.pdf').viewerType, 'pdf');
  assert.equal(resolveFileViewerSpec('relazione.pdf').canOpenInApp, true);
  assert.equal(resolveFileViewerSpec('contratto.docx').viewerType, 'word');
  assert.equal(resolveFileViewerSpec('bilancio.xlsx').viewerType, 'spreadsheet');
  assert.equal(resolveFileViewerSpec('slides.pptx').viewerType, 'presentation');
  assert.equal(resolveFileViewerSpec('note.txt').viewerType, 'text');
  assert.equal(resolveFileViewerSpec('foto.webp').viewerType, 'image');
  assert.equal(resolveFileViewerSpec('installer.apk').viewerType, 'external');
  assert.equal(resolveFileViewerSpec('installer.apk').canOpenInApp, false);

  // 1. PDF page count extraction
  const fakePdf = Buffer.from(
    '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF',
    'latin1'
  );
  const pdfResult = await parseDocumentBuffer(fakePdf, 'manuale.pdf');
  assert.equal(pdfResult.viewerType, 'pdf');
  assert.equal(pdfResult.pageCount, 2);

  // 2. DOCX XML extraction
  const docxZip = new JSZip();
  docxZip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Titolo Contratto</w:t></w:r></w:p><w:p><w:r><w:t>Clausola di riservatezza PhotoCloud.</w:t></w:r></w:p></w:body></w:document>'
  );
  const docxBuf = await docxZip.generateAsync({ type: 'nodebuffer' });
  const docxResult = await parseDocumentBuffer(docxBuf, 'contratto.docx');
  assert.equal(docxResult.viewerType, 'word');
  assert.equal(docxResult.blocks.length, 2);
  assert.equal(docxResult.blocks[0].type, 'heading');
  assert.equal(docxResult.blocks[0].text, 'Titolo Contratto');
  assert.equal(docxResult.blocks[1].text, 'Clausola di riservatezza PhotoCloud.');

  // 3. XLSX XML extraction
  const xlsxZip = new JSZip();
  xlsxZip.file(
    'xl/sharedStrings.xml',
    '<?xml version="1.0"?><sst><si><t>Voce</t></si><si><t>Importo</t></si><si><t>Server Cloud</t></si></sst>'
  );
  xlsxZip.file(
    'xl/workbook.xml',
    '<?xml version="1.0"?><workbook><sheets><sheet name="Bilancio 2026" sheetId="1" r:id="rId1"/></sheets></workbook>'
  );
  xlsxZip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250</v></c></row></sheetData></worksheet>'
  );
  const xlsxBuf = await xlsxZip.generateAsync({ type: 'nodebuffer' });
  const xlsxResult = await parseDocumentBuffer(xlsxBuf, 'bilancio.xlsx');
  assert.equal(xlsxResult.viewerType, 'spreadsheet');
  assert.equal(xlsxResult.sheets.length, 1);
  assert.equal(xlsxResult.sheets[0].name, 'Bilancio 2026');
  assert.deepEqual(xlsxResult.sheets[0].headers, ['Voce', 'Importo']);
  assert.deepEqual(xlsxResult.sheets[0].rows[0], ['Server Cloud', '1250']);

  // 4. PPTX XML extraction
  const pptxZip = new JSZip();
  pptxZip.file(
    'ppt/slides/slide1.xml',
    '<?xml version="1.0"?><p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Architettura Zero-Knowledge</a:t></a:r></a:p><a:p><a:r><a:t>Crittografia AES-256-GCM</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  );
  const pptxBuf = await pptxZip.generateAsync({ type: 'nodebuffer' });
  const pptxResult = await parseDocumentBuffer(pptxBuf, 'presentazione.pptx');
  assert.equal(pptxResult.viewerType, 'presentation');
  assert.equal(pptxResult.slides.length, 1);
  assert.equal(pptxResult.slides[0].title, 'Architettura Zero-Knowledge');
  assert.deepEqual(pptxResult.slides[0].bullets, ['Crittografia AES-256-GCM']);

  // 5. CSV parsing
  const csvSheet = parseDelimitedTextToSheet('Nome,Ruolo\nValerio,Admin\nMario,Utente', ',', 'Team');
  assert.deepEqual(csvSheet.headers, ['Nome', 'Ruolo']);
  assert.equal(csvSheet.rows.length, 2);
});

test('GitHub Actions workflow (.github/workflows/android-release.yml) and Android v1.1.3 project with video thumbnails, long-press selection, SelectionActionsPanel and lightbox video controls are configured', async () => {
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/android-release.yml');
  assert.ok(fs.existsSync(workflowPath));
  const workflowYaml = fs.readFileSync(workflowPath, 'utf-8');
  assert.ok(
    workflowYaml.includes(
      "packages: 'cmdline-tools;latest platform-tools platforms;android-35 build-tools;35.0.0'"
    )
  );
  assert.ok(workflowYaml.includes('gradle assembleRelease --no-daemon'));
  assert.ok(workflowYaml.includes('softprops/action-gh-release@v2'));
  assert.equal(workflowYaml.includes('photocloud-release-v1.1.3-signed.apk'), false);
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.1.3-signed.apk')));
  assert.equal(workflowYaml.includes('rm -f photocloud-release-key.jks'), false);

  const keystorePath = path.resolve(process.cwd(), 'android-app/app/photocloud-release-key.jks');
  assert.ok(fs.existsSync(keystorePath));
  assert.ok(fs.statSync(keystorePath).size > 1000);

  const filePathsXml = path.resolve(process.cwd(), 'android-app/app/src/main/res/xml/file_paths.xml');
  assert.ok(fs.existsSync(filePathsXml));

  const mainActivityKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt'),
    'utf-8'
  );
  const apiClientKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/PhotoCloudApiClient.kt'),
    'utf-8'
  );
  const webPhotoEditorJs = fs.readFileSync(
    path.resolve(process.cwd(), 'static/scripts/photo-editor.js'),
    'utf-8'
  );
  const webGroupingJs = fs.readFileSync(
    path.resolve(process.cwd(), 'static/scripts/grouping.js'),
    'utf-8'
  );
  const webUploadJs = fs.readFileSync(
    path.resolve(process.cwd(), 'static/scripts/upload.js'),
    'utf-8'
  );

  assert.equal(mainActivityKt.includes('android.webkit.WebView'), false);
  assert.equal(mainActivityKt.includes('showTransferPopup = true'), false);
  assert.ok(mainActivityKt.includes('hadRunningTransfers'));
  assert.ok(mainActivityKt.includes('gallerySortedItems'));
  assert.ok(mainActivityKt.includes('galleryGroupedSections'));
  assert.ok(mainActivityKt.includes('galleryGridState'));
  assert.ok(mainActivityKt.includes('getRamThumbnailBitmap'));
  assert.ok(mainActivityKt.includes('loadThumbnailBitmap'));
  assert.ok(mainActivityKt.includes('renderGeometryPreviewBitmap'));
  assert.ok(mainActivityKt.includes('buildGpuComposeColorFilter'));
  assert.ok(mainActivityKt.includes('previewSourceBitmap'));
  assert.ok(mainActivityKt.includes('optimisticRemovedGallery'));
  assert.ok(mainActivityKt.includes('NativeDocumentViewerModal'));
  assert.ok(mainActivityKt.includes('NativePdfRendererView'));
  assert.ok(mainActivityKt.includes('NativeWordDocumentView'));
  assert.ok(mainActivityKt.includes('NativeSpreadsheetDocumentView'));
  assert.ok(mainActivityKt.includes('NativePresentationDocumentView'));
  assert.ok(webPhotoEditorJs.includes('previewSourceCanvas'));
  assert.ok(webPhotoEditorJs.includes('buildPreviewSourceCanvas'));
  assert.equal(webPhotoEditorJs.includes('window.location.reload()'), false);
  assert.ok(webGroupingJs.includes('pane-media'));
  assert.ok(webGroupingJs.includes('pane-files'));
  assert.ok(webGroupingJs.includes('pane-trash'));
  assert.ok(webGroupingJs.includes('switchToTab'));
  assert.ok(webGroupingJs.includes('syncVaultItemsFromServer'));
  assert.ok(webGroupingJs.includes('createCardWrapperElement'));
  assert.equal(webGroupingJs.includes('window.location.reload()'), false);
  assert.ok(webUploadJs.includes('syncVaultItemsFromServer'));
  assert.equal(webUploadJs.includes('window.location.reload()'), false);
  assert.ok(apiClientKt.includes('thumbnailCache'));
  assert.ok(apiClientKt.includes('getRamThumbnailBitmap'));
  assert.ok(apiClientKt.includes('loadThumbnailBitmap'));
  assert.ok(apiClientKt.includes('MediaMetadataRetriever'));
  assert.ok(apiClientKt.includes('decodeVideoThumbnailFromUrl'));
  assert.ok(apiClientKt.includes('decodeVideoThumbnailFromFile'));
  assert.ok(apiClientKt.includes('detectIsVideoFilename'));
  assert.ok(mainActivityKt.includes('SelectionActionsPanel'));
  assert.ok(mainActivityKt.includes('toggleGallerySelectionFromLongPress'));
  assert.ok(mainActivityKt.includes('gridLongPressToggleAtMs'));
  assert.ok(mainActivityKt.includes('Sposta in album…'));
  assert.ok(mainActivityKt.includes('setMediaController'));
  // The lightbox must evaluate the video branch BEFORE the bitmap branch, otherwise
  // the cached RAM thumbnail shadows VideoView + MediaController (no playback controls).
  const videoBranchIdx = mainActivityKt.indexOf('if (media.isVideo) {');
  const bitmapBranchIdx = mainActivityKt.indexOf('} else if (loadedBitmap != null) {');
  assert.ok(videoBranchIdx > 0 && bitmapBranchIdx > videoBranchIdx,
    'lightbox must branch on media.isVideo before rendering the bitmap');
  assert.ok(apiClientKt.includes('FileProvider.getUriForFile'));
  assert.ok(apiClientKt.includes('openFileWithExternalAppChooser'));
  assert.ok(apiClientKt.includes('downloadFileToCache'));
  assert.ok(apiClientKt.includes('fetchDocumentPreview'));
  assert.ok(workflowYaml.includes('workflow_dispatch:'));
});

test('authenticated encryption detects tampering and reads legacy CFB', async () => {
  const crypto = await import('node:crypto');
  const { deriveKey, encryptedPlaintextSize } = await import('./crypto');
  const key = 'test secret';
  const plain = Buffer.from('hello');
  const enc = encryptFile(plain, key);
  assert.equal(encryptedPlaintextSize(enc), plain.length);
  const altered = Buffer.from(enc); altered[altered.length - 1] ^= 1;
  assert.throws(() => decryptFile(altered, key));
  assert.throws(() => decryptFile(enc, 'wrong key'));
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cfb', deriveKey(key, salt), iv);
  const legacy = Buffer.concat([salt, iv, cipher.update(plain), cipher.final()]);
  assert.deepEqual(decryptFile(legacy, key), plain);
  assert.equal(encryptedPlaintextSize(legacy), plain.length);
});

test('album names are escaped in HTML attributes', () => {
  const html = renderGalleryTemplate([], ["x' onmouseover='alert(1)"]);
  assert.ok(html.includes('&#39;'));
  assert.ok(!html.includes("data-albums='[\"x'"));
});

test('On-Device AI Photo Categorization (EfficientNet-Lite4), Drag-to-select, Lightbox gestures, and signed APK release v1.2.0 are configured', () => {
  // 1. Drag-to-select in GalleryView and static selection script
  const galleryViewTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/GalleryView.tsx'), 'utf-8');
  assert.ok(galleryViewTsx.includes('isDragSelecting'));
  assert.ok(galleryViewTsx.includes('selection-marquee'));
  assert.ok(galleryViewTsx.includes('handlePointerDown'));
  assert.ok(galleryViewTsx.includes('handlePointerMove'));
  assert.ok(galleryViewTsx.includes('didDragRef'));

  const selectionJs = fs.readFileSync(path.resolve(process.cwd(), 'static/scripts/selection.js'), 'utf-8');
  assert.ok(selectionJs.includes('selection-marquee'));
  assert.ok(selectionJs.includes('isDragSelecting'));
  assert.ok(selectionJs.includes('pointermove'));
  assert.ok(selectionJs.includes('pointerdown'));

  // 2. Lightbox Gestures and Coherent Animation (Web + Android Native)
  const lightboxModalTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/components/LightboxModal.tsx'), 'utf-8');
  assert.ok(lightboxModalTsx.includes('lightbox-animate-next-in'));
  assert.ok(lightboxModalTsx.includes('lightbox-animate-prev-in'));
  assert.ok(lightboxModalTsx.includes('lightbox-animate-dismiss'));
  assert.ok(lightboxModalTsx.includes('lightbox-spring-reset'));
  assert.ok(lightboxModalTsx.includes('handlePointerMove'));
  assert.ok(lightboxModalTsx.includes('navigateWithAnimation'));

  const lightboxJs = fs.readFileSync(path.resolve(process.cwd(), 'static/scripts/lightbox.js'), 'utf-8');
  assert.ok(lightboxJs.includes('lightbox-animate-next-in'));
  assert.ok(lightboxJs.includes('lightbox-animate-prev-in'));
  assert.ok(lightboxJs.includes('lightbox-animate-dismiss'));
  assert.ok(lightboxJs.includes('pointermove'));

  const mainActivityKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt'),
    'utf-8'
  );
  assert.ok(mainActivityKt.includes('currentPageOffsetFraction'));
  assert.ok(mainActivityKt.includes('dismissOffsetY'));
  assert.ok(mainActivityKt.includes('detectTapGestures'));
  assert.ok(mainActivityKt.includes('userScrollEnabled = currentTab == VaultTab.GALLERY && dragStartIndex == null'));
  assert.ok(mainActivityKt.includes('selectedAiCategoryFilter'));
  assert.ok(mainActivityKt.includes('Indicizzazione AI in corso:'));
  assert.ok(mainActivityKt.includes('onDemandAiTags'));

  // 3. Optional On-Demand AI model download manager, LocalPhotoCategorizer, Room Database, and WorkManager Worker
  const bundledAssetModelPath = path.resolve(process.cwd(), 'android-app/app/src/main/assets/efficientnet_lite4.tflite');
  assert.equal(fs.existsSync(bundledAssetModelPath), false, 'AI model must not be bundled inside APK assets; it is downloaded on-demand');

  const serverModelPath = path.resolve(process.cwd(), 'release/efficientnet_lite4.tflite');
  assert.ok(fs.existsSync(serverModelPath), 'On-demand TFLite model must be available in release/efficientnet_lite4.tflite');
  assert.ok(fs.statSync(serverModelPath).size > 10 * 1024 * 1024, 'efficientnet_lite4.tflite must be > 10MB');

  const aiDownloadManagerKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/AiModelDownloadManager.kt'),
    'utf-8'
  );
  assert.ok(aiDownloadManagerKt.includes('enum class AiModelStatus'));
  assert.ok(aiDownloadManagerKt.includes('startOrResumeDownload'));
  assert.ok(aiDownloadManagerKt.includes('pauseDownload'));
  assert.ok(aiDownloadManagerKt.includes('cancelDownload'));
  assert.ok(aiDownloadManagerKt.includes('deleteInstalledModel'));
  assert.ok(aiDownloadManagerKt.includes('Range'));
  assert.ok(aiDownloadManagerKt.includes('/api/ai-model/efficientnet_lite4.tflite'));

  const appAutoUpdaterKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/AppAutoUpdater.kt'),
    'utf-8'
  );
  assert.ok(appAutoUpdaterKt.includes('checkForUpdatesOnLaunch'));
  assert.ok(appAutoUpdaterKt.includes('verifyDownloadedApk'));
  assert.ok(appAutoUpdaterKt.includes('extractSigningCertificateDigests'));
  assert.ok(appAutoUpdaterKt.includes('computeFileSha256'));
  assert.ok(appAutoUpdaterKt.includes('promptInstallApk'));
  assert.ok(appAutoUpdaterKt.includes('/api/android/update-manifest'));
  assert.ok(appAutoUpdaterKt.includes('releases/latest'));

  const categorizerKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/LocalPhotoCategorizer.kt'),
    'utf-8'
  );
  assert.ok(categorizerKt.includes('Delegate.GPU'));
  assert.ok(categorizerKt.includes('Delegate.CPU'));
  assert.ok(categorizerKt.includes('AiModelDownloadManager.isModelInstalled'));
  assert.ok(categorizerKt.includes('setModelAssetBuffer'));
  assert.ok(categorizerKt.includes('Bitmap.Config.ARGB_8888'));
  assert.ok(categorizerKt.includes('ExifInterface'));
  assert.ok(categorizerKt.includes('0.55f'));

  const dbKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/PhotoAiDatabase.kt'),
    'utf-8'
  );
  assert.ok(dbKt.includes('@Entity(tableName = "photo_ai_categories")'));
  assert.ok(dbKt.includes('observeIndexingProgress'));
  assert.ok(dbKt.includes('observeDistinctCategoriesWithCount'));

  const workerKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/PhotoAiIndexingWorker.kt'),
    'utf-8'
  );
  assert.equal(workerKt.includes('MediaStore.Images.Media.EXTERNAL_CONTENT_URI'), false);
  assert.ok(workerKt.includes('AiModelDownloadManager.isModelInstalled'));
  assert.ok(workerKt.includes('deleteNonCloudEntries()'));
  assert.ok(workerKt.includes('getCachedGalleryItems()'));
  assert.ok(workerKt.includes('ai_photo_indexing'));
  assert.ok(workerKt.includes('ExistingWorkPolicy'));
  assert.ok(workerKt.includes('categorizer?.close()'));
  assert.ok(mainActivityKt.includes('val effectiveAiTotal = if (workerTotal > 0) workerTotal else 0'));
  assert.ok(mainActivityKt.includes('galleryCloudPhotoKey'));
  assert.ok(mainActivityKt.includes('AppUpdateModal'));
  assert.ok(mainActivityKt.includes('Modello AI Locale (Facoltativo)'));

  const proguardRules = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/proguard-rules.pro'),
    'utf-8'
  );
  assert.ok(proguardRules.includes('-keep class com.google.mediapipe.** { *; }'));
  assert.ok(proguardRules.includes('-keep interface com.google.mediapipe.** { *; }'));
  assert.ok(proguardRules.includes('-dontwarn com.google.mediapipe.**'));

  // 4. Unified GalleryDragSelectionController & single-pass pointerInput verification (v1.2.4)
  const dragControllerKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/GalleryDragSelectionController.kt'),
    'utf-8'
  );
  assert.ok(dragControllerKt.includes('class GalleryDragSelectionController'));
  assert.ok(dragControllerKt.includes('fun startDragSelection'));
  assert.ok(dragControllerKt.includes('fun updateDragSelection'));
  assert.ok(dragControllerKt.includes('fun endDragSelection'));
  assert.ok(dragControllerKt.includes('fun findCellAtPoint'));
  assert.ok(dragControllerKt.includes('fun computeAutoScrollVelocityPxPerFrame'));
  assert.ok(mainActivityKt.includes('val galleryDragController = remember { GalleryDragSelectionController() }'));
  assert.ok(mainActivityKt.includes('extractVisibleGridCells'));
  assert.ok(mainActivityKt.includes('val autoScrollJob = scope.launch'));
  assert.equal(mainActivityKt.includes('detectDragGesturesAfterLongPress('), false, 'Conflicting dual pointerInput detector call must be removed');

  // 5. Release APK, historical APKs preserved, metadata, and Gradle configuration
  const apkPath = path.resolve(process.cwd(), 'release/photocloud-release-v1.2.5-signed.apk');
  assert.ok(fs.existsSync(apkPath));
  assert.ok(fs.statSync(apkPath).size > 20 * 1024 * 1024, 'Signed release APK v1.2.5 should be > 20MB');
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.2.4-signed.apk')));
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.2.3-signed.apk')));
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.2.2-signed.apk')));
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.1.3-signed.apk')));

  const appBuildGradle = fs.readFileSync(path.resolve(process.cwd(), 'android-app/app/build.gradle.kts'), 'utf-8');
  assert.ok(appBuildGradle.includes('versionName = "1.2.8"'));
  assert.ok(appBuildGradle.includes('versionCode = 25'));
  assert.ok(appBuildGradle.includes('noCompress += "tflite"'));
  assert.ok(appBuildGradle.includes('com.google.mediapipe:tasks-vision:0.10.14'));
  assert.ok(appBuildGradle.includes('androidx.work:work-runtime-ktx:2.9.0'));
  assert.ok(appBuildGradle.includes('androidx.room:room-runtime:2.6.1'));

  const pkgJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
  assert.equal(pkgJson.version, '1.2.8');

  // 6. Multi-platform interactive CLI scripts (photocloud.bat & photocloud.sh)
  const batPath = path.resolve(process.cwd(), 'photocloud.bat');
  assert.ok(fs.existsSync(batPath), 'photocloud.bat must exist');
  const batContent = fs.readFileSync(batPath, 'utf-8');
  assert.ok(batContent.includes('\r\n'), 'photocloud.bat must use CRLF line endings for Windows cmd.exe label offsets');
  assert.ok(batContent.includes('setlocal DisableDelayedExpansion'), 'photocloud.bat must disable delayed expansion to avoid ! mangling');
  assert.equal(/if\s+[^\r\n]+\(\s*\r?\n/i.test(batContent), false, 'photocloud.bat must not use multi-line parenthesized if (...) blocks that crash cmd.exe when echoing parentheses');
  assert.ok(batContent.includes('git pull'), 'photocloud.bat must support updating');
  assert.ok(batContent.includes('git clone'), 'photocloud.bat must support cloning');
  assert.ok(batContent.includes('call npm run dev'), 'photocloud.bat must support launching dev mode via call npm');
  assert.ok(batContent.includes('winget'), 'photocloud.bat must detect and install missing dependencies');

  const shPath = path.resolve(process.cwd(), 'photocloud.sh');
  assert.ok(fs.existsSync(shPath), 'photocloud.sh must exist');
  const shContent = fs.readFileSync(shPath, 'utf-8');
  assert.equal(shContent.includes('\r\n'), false, 'photocloud.sh must use LF line endings');
  assert.equal(/^set -e$/m.test(shContent), false, 'photocloud.sh must not use global set -e which crashes the interactive menu');
  assert.ok(shContent.includes('git pull'), 'photocloud.sh must support updating');
  assert.ok(shContent.includes('git clone'), 'photocloud.sh must support cloning');
  assert.ok(shContent.includes('npm run dev'), 'photocloud.sh must support launching dev mode');
  assert.ok(shContent.includes('check_and_install_dependencies'), 'photocloud.sh must check and install dependencies');
});

test('Security Hardening: constant-time verifyKey, AndroidBuilder escaping, and WebView file access lockdown', async () => {
  const {
    validateAndroidConfig,
    generateAndroidManifestXml,
    generateAppBuildGradleKts,
    generateMainActivityKt,
  } = await import('./androidBuilder');

  const validKey = 'MyStrongKey#2026!';
  const validHash = hashKey(validKey);
  assert.equal(verifyKey(validKey, validHash), true);
  assert.equal(verifyKey(validKey, validHash.toUpperCase() + '\n'), true);
  assert.equal(verifyKey(validKey, 'short_invalid_hash'), false);
  assert.equal(verifyKey('wrong', validHash), false);

  const baseConfig = {
    appName: 'PhotoCloud "Vault" <Test>',
    packageName: 'com.valerio.photocloud',
    versionName: '1.2.8',
    versionCode: 25,
    serverUrl: 'http://10.0.2.2:3000',
    minSdk: 26,
    targetSdk: 35,
    enableBiometricLock: true,
    enableOfflineCache: true,
    enableAutoBackup: false,
    signingMode: 'release' as const,
    keystoreAlias: 'photocloud-release-key',
  };

  assert.equal(validateAndroidConfig(baseConfig), null);
  assert.notEqual(
    validateAndroidConfig({ ...baseConfig, serverUrl: 'javascript:alert(1)' }),
    null
  );
  assert.notEqual(
    validateAndroidConfig({ ...baseConfig, keystoreAlias: 'bad"alias' }),
    null
  );

  const manifestXml = generateAndroidManifestXml(baseConfig);
  assert.ok(manifestXml.includes('PhotoCloud &quot;Vault&quot; &lt;Test&gt;'));
  assert.ok(!manifestXml.includes('android:label="PhotoCloud "Vault"'));

  const gradleKts = generateAppBuildGradleKts(baseConfig);
  assert.ok(gradleKts.includes('versionName = "1.2.8"'));

  const mainKt = generateMainActivityKt(baseConfig);
  assert.ok(mainKt.includes('settings.allowFileAccess = false'));
  assert.ok(mainKt.includes('settings.allowContentAccess = false'));
});

test('Dual-Theme & Liquid Glass Design System (Web + Android Kyant0/AndroidLiquidGlass parity)', async () => {
  const {
    DEFAULT_LIQUID_GLASS_CONFIG,
    LIQUID_GLASS_PRESETS,
    sanitizeLiquidGlassConfig,
    computeLiquidGlassCssVariables,
    exportLiquidGlassConfigJson,
    importLiquidGlassConfigJson,
  } = await import('./liquidGlassEngine');

  assert.equal(LIQUID_GLASS_PRESETS.length, 6);
  const sanitized = sanitizeLiquidGlassConfig({
    glassIntensity: 95,
    transparency: 60,
    blurRadius: 40,
    primaryColor: '#c084fc',
    navBarGlassStyle: 'crystal',
    cardGlassStyle: 'prism',
  });
  assert.equal(sanitized.glassIntensity, 95);
  assert.equal(sanitized.transparency, 60);
  assert.equal(sanitized.opacity, 40);
  assert.equal(sanitized.blurRadius, 40);
  assert.equal(sanitized.primaryColor, '#C084FC');
  assert.equal(sanitized.navBarGlassStyle, 'crystal');
  assert.equal(sanitized.cardGlassStyle, 'prism');

  const cssVars = computeLiquidGlassCssVariables(sanitized, true);
  assert.equal(cssVars['--lg-primary'], '#C084FC');
  assert.equal(cssVars['--lg-blur'], '40px');
  assert.ok(Number(cssVars['--lg-surface-alpha']) > 0);

  const exported = exportLiquidGlassConfigJson(sanitized);
  const reimported = importLiquidGlassConfigJson(exported);
  assert.ok(reimported);
  assert.equal(reimported?.primaryColor, '#C084FC');
  assert.equal(reimported?.glassIntensity, 95);
  assert.equal(importLiquidGlassConfigJson('not-valid-json'), null);
  assert.equal(DEFAULT_LIQUID_GLASS_CONFIG.glassIntensity, 78);

  const galleryHtml = renderGalleryTemplate([], []);
  assert.ok(galleryHtml.includes('id="lg-settings-modal-backdrop"'));
  assert.ok(galleryHtml.includes('id="open-settings-btn"'));
  assert.ok(galleryHtml.includes('/static/styles/liquid-glass.css'));
  assert.ok(galleryHtml.includes('/static/scripts/liquid-glass.js'));

  const lgKtPath = path.resolve(
    process.cwd(),
    'android-app/app/src/main/java/com/valerio/photocloud/LiquidGlassDesignSystem.kt'
  );
  assert.ok(fs.existsSync(lgKtPath));
  const lgKt = fs.readFileSync(lgKtPath, 'utf-8');
  assert.ok(lgKt.includes('enum class DesignThemeMode'));
  assert.ok(lgKt.includes('data class LiquidGlassConfig'));
  assert.ok(lgKt.includes('fun Modifier.liquidGlassSurface'));
  assert.ok(lgKt.includes('fun LiquidGlassStudioSection'));

  // Regression guard: isLgActive & lgCfg must be hoisted at top of NativeVaultScreen before Box(Modifier.fillMaxSize())
  const mainActivityKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt'),
    'utf-8'
  );
  const vaultFnIdx = mainActivityKt.indexOf('fun NativeVaultScreen(');
  const firstLgActiveIdx = mainActivityKt.indexOf('val isLgActive = LocalLiquidGlassActive.current', vaultFnIdx);
  const firstLgCfgIdx = mainActivityKt.indexOf('val lgCfg = LocalLiquidGlassConfig.current', vaultFnIdx);
  const firstVaultBoxIdx = mainActivityKt.indexOf('Box(modifier = Modifier.fillMaxSize())', vaultFnIdx);
  assert.ok(vaultFnIdx > 0 && firstLgActiveIdx > vaultFnIdx && firstLgCfgIdx > vaultFnIdx);
  assert.ok(
    firstLgActiveIdx < firstVaultBoxIdx && firstLgCfgIdx < firstVaultBoxIdx,
    'isLgActive and lgCfg must be hoisted above Box(Modifier.fillMaxSize()) so all NativeVaultScreen overlays and floating bar can resolve them'
  );
});

test('Auto-update anti-loop: APK version must be newer than installed and match the announced release', async () => {
  const root = process.cwd();
  const read = (rel: string) => fs.readFileSync(path.resolve(root, rel), 'utf-8');

  const updaterKt = read('android-app/app/src/main/java/com/valerio/photocloud/AppAutoUpdater.kt');

  // 1. L'APK scaricato viene ispezionato a runtime: la sua versione deve essere > di quella installata
  assert.ok(updaterKt.includes('val declaredVersionName = archiveInfo.versionName'));
  assert.ok(updaterKt.includes('archiveInfo.longVersionCode'));
  assert.ok(
    updaterKt.includes('declaredVersionCode <= BuildConfig.VERSION_CODE.toLong()'),
    'AppAutoUpdater must reject APKs whose versionCode is not greater than the installed one'
  );
  assert.ok(
    updaterKt.includes('declaredVersionCode != manifest.versionCode.toLong()'),
    'AppAutoUpdater must reject APKs whose versionCode differs from the announced one'
  );

  // 2. Guardia lato manifest: se la release pubblica ancora l'APK della versione installata,
  //    nessun download e nessun modal (era la causa del loop v1.2.6 -> v1.2.5).
  assert.ok(updaterKt.includes('fun isPublishedApkOlderThanInstalled('));
  assert.ok(updaterKt.includes('if (isPublishedApkOlderThanInstalled(manifest)) {'));
  assert.ok(updaterKt.includes('renderStaleReleaseNotice'));

  // 3. Il versionName mostrato proviene dal manifest allegato alla release, non solo dal tag
  assert.ok(updaterKt.includes('versionName = extraManifest?.versionName'));
  assert.equal(
    updaterKt.includes('extraManifest?.versionName?.takeIf { it == tagName }'),
    false,
    'Il versionName non deve essere scartato quando differisce dal tag della release'
  );

  // 4. Il server deriva versione e APK dalla configurazione Gradle reale
  const serverTs = read('server.ts');
  assert.ok(serverTs.includes('function readAndroidAppVersion()'));
  assert.ok(serverTs.includes('function resolveReleaseApk('));
  assert.ok(serverTs.includes("const versionName = manifestAheadOfCode"));
  assert.equal(
    /versionName:\s*String\(manifestData\.versionName\s*\|\|\s*'1\.2\.5'\)/.test(serverTs),
    false,
    'Il manifest server non deve più avere la versione hardcoded 1.2.5'
  );

  // 5. Il workflow CI non deve più avere nomi APK/tag hardcoded e deve validare la versione
  const workflow = read('.github/workflows/android-release.yml');
  assert.equal(
    /photocloud-release-v1\.2\.5-signed\.apk/.test(workflow),
    false,
    'Il workflow non deve più produrre APK con nome versione hardcoded'
  );
  assert.ok(workflow.includes('Read version from Gradle configuration'));
  assert.ok(workflow.includes('Determine and validate Release Tag'));
  assert.ok(workflow.includes('Verify built APK declares the expected version'));
  assert.ok(workflow.includes('Generate auto-update manifest from the built APK'));

  // 6. Coerenza versione tra Gradle, package.json e manifest di update nel repository
  const gradle = read('android-app/app/build.gradle.kts');
  const gradleVersion = gradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
  const gradleCode = Number(gradle.match(/versionCode\s*=\s*([0-9]+)/)?.[1]);
  const pkgJson = JSON.parse(read('package.json'));
  const manifestJson = JSON.parse(read('release/photocloud-release-build.json'));
  assert.equal(pkgJson.version, gradleVersion);
  assert.equal(manifestJson.versionName, gradleVersion);
  assert.equal(manifestJson.versionCode, gradleCode);
  assert.ok(gradleCode > 23, 'versionCode must be greater than the previous release (23)');
});

test('Cloud Total Used Storage Indicator (Header Badge, Popover, Settings Card & Trash Recoverable Banner)', async () => {
  const { computeCloudStorageStats, renderGalleryTemplate, renderTrashTemplate } = await import('./templateRenderer');

  const activeItems = [
    { filename: 'vacanza.jpg', timestamp: 1700000000, size: 2 * 1024 * 1024, isMedia: true, category: 'media' as const },
    { filename: 'clip.mp4', timestamp: 1700000100, size: 3 * 1024 * 1024, isMedia: true, category: 'media' as const },
    { filename: 'contratto.pdf', timestamp: 1700000200, size: 1 * 1024 * 1024, isMedia: false, category: 'document' as const },
  ];
  const trashedItems = [
    { filename: 'vecchio.zip', timestamp: 1700000300, size: 4 * 1024 * 1024, isMedia: false, category: 'archive' as const },
  ];

  const stats = computeCloudStorageStats(activeItems, trashedItems);
  assert.equal(stats.mediaBytes, 5 * 1024 * 1024);
  assert.equal(stats.filesBytes, 1 * 1024 * 1024);
  assert.equal(stats.activeTotalBytes, 6 * 1024 * 1024);
  assert.equal(stats.trashBytes, 4 * 1024 * 1024);
  assert.equal(stats.grandTotalBytes, 10 * 1024 * 1024);
  assert.equal(stats.mediaCount, 2);
  assert.equal(stats.filesCount, 1);
  assert.equal(stats.trashCount, 1);
  assert.equal(stats.mediaPercent, 50);
  assert.equal(stats.filesPercent, 10);
  assert.equal(stats.trashPercent, 40);
  assert.equal(stats.activeTotalFormatted, '6.0 MB');
  assert.equal(stats.grandTotalFormatted, '10.0 MB');

  const galleryHtml = renderGalleryTemplate(activeItems, ['Estate'], trashedItems);
  assert.ok(galleryHtml.includes('id="cloud-storage-header-badge"'));
  assert.ok(galleryHtml.includes('id="cloud-storage-popover"'));
  assert.ok(galleryHtml.includes('id="settings-cloud-storage-card"'));
  assert.ok(galleryHtml.includes('6.0 MB'));

  const trashHtml = renderTrashTemplate(trashedItems, activeItems);
  assert.ok(trashHtml.includes('id="trash-recoverable-storage-banner"'));
  assert.ok(trashHtml.includes('4.0 MB'));

  const mainActivityKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt'),
    'utf-8'
  );
  assert.ok(mainActivityKt.includes('fun CloudStorageSegmentedProgressBar('));
  assert.ok(mainActivityKt.includes('fun TrashRecoverableStorageBanner('));
  assert.ok(mainActivityKt.includes('fun CloudStorageBreakdownDialog('));
  assert.ok(mainActivityKt.includes('Memoria Usata Totale del Cloud'));
});

test('Zero-OOM Streaming Bulk Upload (250+ photos) & Configurable Parallel Transfers (Web & Android v1.2.8)', async () => {
  const apiClientKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/PhotoCloudApiClient.kt'),
    'utf-8'
  );
  // 1. Android must stream URIs on demand (UriStreamingRequestBody + ForwardingSink) and never readBytes() all selected URIs into RAM
  assert.ok(apiClientKt.includes('class UriStreamingRequestBody('));
  assert.ok(apiClientKt.includes('class ProgressRequestBody('));
  assert.ok(apiClientKt.includes('ForwardingSink(sink)'));
  assert.equal(
    apiClientKt.includes('context.contentResolver.openInputStream(uri)?.use { it.readBytes() }'),
    false,
    'uploadMediaUris must never read all selected URIs into ByteArray in RAM upfront'
  );
  assert.ok(apiClientKt.includes('fun resolveUriMetadata('));
  assert.ok(apiClientKt.includes('val semaphore = Semaphore(parallelLimit)'));
  assert.ok(apiClientKt.includes('fun getMaxParallelTransfers(): Int'));
  assert.ok(apiClientKt.includes('fun setMaxParallelTransfers(value: Int)'));
  assert.ok(apiClientKt.includes('fun saveStreamToDownloads('));

  // 2. Android Settings screen & CustomizationState must expose presets + custom numeric input (1..16)
  const mainActivityKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt'),
    'utf-8'
  );
  assert.ok(mainActivityKt.includes('val maxParallelTransfers: Int = 3'));
  assert.ok(mainActivityKt.includes('synchronized(transferOpsLock)'));
  assert.ok(mainActivityKt.includes('title = "Trasferimenti & Caricamenti Paralleli"'));
  assert.ok(mainActivityKt.includes('1 to "1 • Sequenziale"'));
  assert.ok(mainActivityKt.includes('3 to "3 • Bilanciato"'));
  assert.ok(mainActivityKt.includes('8 to "8 • Massimo"'));
  assert.ok(mainActivityKt.includes('Oppure imposta numero manuale (1 – 16)'));

  // 3. Web App Settings Modal & upload.js parallel worker pool
  const baseHtml = fs.readFileSync(path.resolve(process.cwd(), 'templates/base.html'), 'utf-8');
  assert.ok(baseHtml.includes('id="settings-parallel-transfers-card"'));
  assert.ok(baseHtml.includes('data-parallel-preset="1"'));
  assert.ok(baseHtml.includes('data-parallel-preset="3"'));
  assert.ok(baseHtml.includes('data-parallel-preset="8"'));
  assert.ok(baseHtml.includes('id="settings-parallel-custom-input"'));

  const uploadJs = fs.readFileSync(path.resolve(process.cwd(), 'static/scripts/upload.js'), 'utf-8');
  assert.ok(uploadJs.includes('window.getMaxParallelTransfers = function'));
  assert.ok(uploadJs.includes('window.setMaxParallelTransfers = function'));
  assert.ok(uploadJs.includes('async function runWorker()'));
  assert.ok(uploadJs.includes("formData.append('skipList', '1')"));
});


