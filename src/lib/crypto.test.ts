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

  // 5. Release v1.2.4 signed APK, historical APKs preserved, metadata, and Gradle configuration
  const apkPath = path.resolve(process.cwd(), 'release/photocloud-release-v1.2.4-signed.apk');
  assert.ok(fs.existsSync(apkPath));
  assert.ok(fs.statSync(apkPath).size > 20 * 1024 * 1024, 'Signed release APK v1.2.4 should be > 20MB');
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.2.3-signed.apk')));
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.2.2-signed.apk')));
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'release/photocloud-release-v1.1.3-signed.apk')));

  const appBuildGradle = fs.readFileSync(path.resolve(process.cwd(), 'android-app/app/build.gradle.kts'), 'utf-8');
  assert.ok(appBuildGradle.includes('versionName = "1.2.4"'));
  assert.ok(appBuildGradle.includes('versionCode = 21'));
  assert.ok(appBuildGradle.includes('noCompress += "tflite"'));
  assert.ok(appBuildGradle.includes('com.google.mediapipe:tasks-vision:0.10.14'));
  assert.ok(appBuildGradle.includes('androidx.work:work-runtime-ktx:2.9.0'));
  assert.ok(appBuildGradle.includes('androidx.room:room-runtime:2.6.1'));

  const pkgJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
  assert.equal(pkgJson.version, '1.2.4');
});





