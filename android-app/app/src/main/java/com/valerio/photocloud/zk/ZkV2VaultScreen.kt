package com.valerio.photocloud.zk

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInParent
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import com.valerio.photocloud.GalleryDragSelectionController
import com.valerio.photocloud.GridCellBounds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.UUID

private enum class ZkVaultTab(val label: String) {
    GALLERY("Galleria"),
    ALBUMS("Album"),
    MAP("Mappa"),
    SHARES("Condivisi"),
    SECURITY("Sicurezza")
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ZkV2VaultScreen(
    session: ZkSessionSnapshot,
    form: ZkV2LoginFormUiState,
    repository: ZkVaultRepository,
    transferManager: ZkTransferManager,
    onAuthEvent: (ZkV2UiEvent) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedTab by remember { mutableStateOf(ZkVaultTab.GALLERY) }
    var showTrashView by remember { mutableStateOf(false) }
    var mapFocusItemId by remember { mutableStateOf<String?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    var activeItems by remember { mutableStateOf<List<DecryptedZkItem>>(emptyList()) }
    var trashedItems by remember { mutableStateOf<List<DecryptedZkItem>>(emptyList()) }
    var albumsState by remember { mutableStateOf(ZkAlbumsState(ZkAlbumsDocument(), 0, null)) }
    var stats by remember { mutableStateOf<V2StatsResponse?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }
    var statusError by remember { mutableStateOf<String?>(null) }

    var viewerItem by remember { mutableStateOf<DecryptedZkItem?>(null) }
    var editorItem by remember { mutableStateOf<DecryptedZkItem?>(null) }
    var itemsForShareDialog by remember { mutableStateOf<List<DecryptedZkItem>?>(null) }
    var showAddToAlbumDialog by remember { mutableStateOf(false) }
    var shareResult by remember { mutableStateOf<ZkShareCreationResult?>(null) }
    var showCreateAlbumDialog by remember { mutableStateOf(false) }
    var newAlbumName by remember { mutableStateOf("") }
    var selectedAlbumId by remember { mutableStateOf<String?>(null) }

    // Multi-select & drag-select state (GalleryDragSelectionController)
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    val dragController = remember { GalleryDragSelectionController() }
    val tileBounds = remember { mutableMapOf<String, GridCellBounds>() }

    var backupConfig by remember { mutableStateOf(ZkAutoBackupPrefs.load(context)) }
    val transfers by transferManager.transfers.collectAsState()
    val parallelism by transferManager.parallelism.collectAsState()

    fun refreshAll() {
        scope.launch {
            isRefreshing = true
            statusError = null
            try {
                activeItems = repository.listDecryptedItems(state = "active", limit = 200)
                trashedItems = repository.listDecryptedItems(state = "trashed", limit = 200)
                albumsState = repository.loadAlbums()
                stats = repository.fetchStats()
            } catch (t: Throwable) {
                statusError = t.message ?: "Errore sincronizzazione vault cifrato."
            } finally {
                isRefreshing = false
            }
        }
    }

    LaunchedEffect(session.userId, session.isUnlocked) {
        if (session.isUnlocked) {
            refreshAll()
        }
    }

    val mediaUploadPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris: List<Uri> ->
        onAuthEvent(ZkV2UiEvent.EndTransientExternalActivity)
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val includeGps = backupConfig.includeGps
        scope.launch {
            val sources = withContext(Dispatchers.IO) {
                uris.map { uri -> AndroidUriPlaintextSource(context = context, uri = uri) }
            }
            for (source in sources) {
                transferManager.enqueue(source = source, includeGps = includeGps)
            }
            Toast.makeText(
                context,
                "${sources.size} file in coda cifrata Zero-Knowledge",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    // Refresh gallery automatically when an upload finishes
    val completedCount = transfers.count { it.status == ZkTransferStatus.COMPLETED }
    LaunchedEffect(completedCount) {
        if (completedCount > 0) {
            refreshAll()
        }
    }

    if (editorItem != null) {
        ZkV2PhotoEditorDialog(
            item = editorItem!!,
            repository = repository,
            onDismiss = { editorItem = null },
            onSavedCopy = { created ->
                editorItem = null
                viewerItem = created
                Toast.makeText(context, "Copia modificata cifrata salvata!", Toast.LENGTH_SHORT).show()
                refreshAll()
            },
            onOverwritten = { updated ->
                editorItem = null
                viewerItem = updated
                activeItems = activeItems.map { if (it.id == updated.id) updated else it }
                Toast.makeText(context, "Foto sovrascritta in modo sicuro E2EE!", Toast.LENGTH_SHORT).show()
                refreshAll()
            }
        )
    }

    if (itemsForShareDialog != null) {
        ZkV2CreateShareDialog(
            itemsToShare = itemsForShareDialog!!,
            repository = repository,
            onDismiss = { itemsForShareDialog = null },
            onCreated = {
                selectedIds = emptySet()
            }
        )
    }

    if (viewerItem != null) {
        ZkV2ItemViewerScreen(
            item = viewerItem!!,
            repository = repository,
            onClose = { viewerItem = null },
            onToggleFavorite = { item ->
                scope.launch {
                    try {
                        val updated = repository.toggleFavorite(item)
                        viewerItem = updated
                        activeItems = activeItems.map { if (it.id == updated.id) updated else it }
                    } catch (t: Throwable) {
                        Toast.makeText(context, t.message ?: "Errore preferiti", Toast.LENGTH_SHORT).show()
                    }
                }
            },
            onEditPhoto = { item ->
                editorItem = item
            },
            onOpenOnMap = { item ->
                mapFocusItemId = item.id
                viewerItem = null
                showTrashView = false
                selectedTab = ZkVaultTab.MAP
            },
            onCreateShare = { item ->
                itemsForShareDialog = listOf(item)
            },
            onOpenExternal = { item ->
                scope.launch {
                    try {
                        val helper = repository.externalOpenHelper
                            ?: ZkExternalOpenHelper(context.cacheDir)
                        val target = helper.createTargetFile(item.meta.name)
                        repository.decryptBlobToFile(item.blobId, target)
                        val uri = FileProvider.getUriForFile(
                            context,
                            "${context.packageName}.fileprovider",
                            target
                        )
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, item.meta.mime)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        onAuthEvent(ZkV2UiEvent.BeginTransientExternalActivity)
                        try {
                            context.startActivity(Intent.createChooser(intent, "Apri file decifrato con..."))
                        } catch (t: Throwable) {
                            onAuthEvent(ZkV2UiEvent.EndTransientExternalActivity)
                            throw t
                        }
                    } catch (t: Throwable) {
                        Toast.makeText(
                            context,
                            "Errore apertura esterna: ${t.message ?: "riprova"}",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            },
            onMoveToTrash = { item ->
                scope.launch {
                    try {
                        repository.moveToTrash(listOf(item.id))
                        viewerItem = null
                        refreshAll()
                    } catch (t: Throwable) {
                        Toast.makeText(context, t.message ?: "Errore cestino", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        )
        return
    }

    Scaffold(
        topBar = {
            if (selectedIds.isNotEmpty() && selectedTab == ZkVaultTab.GALLERY && !showTrashView) {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = { selectedIds = emptySet() }) {
                            Icon(Icons.Default.Close, contentDescription = "Annulla selezione")
                        }
                    },
                    title = {
                        Text(
                            text = "${selectedIds.size} selezionati",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    },
                    actions = {
                        IconButton(onClick = {
                            selectedIds = if (selectedIds.size == activeItems.size) {
                                emptySet()
                            } else {
                                activeItems.map { it.id }.toSet()
                            }
                        }) {
                            Icon(Icons.Default.SelectAll, contentDescription = "Seleziona tutto")
                        }
                    }
                )
            } else {
                TopAppBar(
                    navigationIcon = {
                        if (showTrashView) {
                            IconButton(onClick = { showTrashView = false }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Torna alla Galleria")
                            }
                        }
                    },
                    title = {
                        Column {
                            Text(
                                text = if (showTrashView) "Cestino Cifrato (${trashedItems.size})" else "PhotoCloud E2EE",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = session.username ?: "-",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    },
                    actions = {
                        if (!showTrashView) {
                            IconButton(onClick = { showTrashView = true }) {
                                Icon(Icons.Default.Delete, contentDescription = "Cestino")
                            }
                        }
                        IconButton(onClick = { refreshAll() }, enabled = !isRefreshing) {
                            Icon(Icons.Default.Refresh, contentDescription = "Aggiorna")
                        }
                        IconButton(onClick = { onAuthEvent(ZkV2UiEvent.LockNow) }) {
                            Icon(Icons.Default.Lock, contentDescription = "Blocca Vault")
                        }
                    }
                )
            }
        },
        floatingActionButton = {
            if (!showTrashView && selectedTab == ZkVaultTab.GALLERY && selectedIds.isEmpty()) {
                FloatingActionButton(
                    onClick = {
                        onAuthEvent(ZkV2UiEvent.BeginTransientExternalActivity)
                        try {
                            mediaUploadPicker.launch(arrayOf("image/*", "video/*"))
                        } catch (t: Throwable) {
                            onAuthEvent(ZkV2UiEvent.EndTransientExternalActivity)
                            Toast.makeText(
                                context,
                                "Impossibile aprire il selettore file: ${t.message ?: "riprova"}",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Carica file cifrato")
                }
            } else if (!showTrashView && selectedTab == ZkVaultTab.ALBUMS && selectedAlbumId == null) {
                FloatingActionButton(
                    onClick = {
                        newAlbumName = ""
                        showCreateAlbumDialog = true
                    }
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Nuovo album cifrato")
                }
            }
        },
        bottomBar = {
            if (selectedIds.isNotEmpty() && selectedTab == ZkVaultTab.GALLERY && !showTrashView) {
                val selectedItemsList = activeItems.filter { it.id in selectedIds }
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    tonalElevation = 6.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(onClick = { showAddToAlbumDialog = true }) {
                            Icon(Icons.Default.Collections, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Album")
                        }
                        TextButton(onClick = {
                            if (selectedItemsList.isNotEmpty()) {
                                itemsForShareDialog = selectedItemsList
                            }
                        }) {
                            Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Condividi")
                        }
                        TextButton(onClick = {
                            scope.launch {
                                try {
                                    for (it in selectedItemsList) {
                                        if (!it.meta.isFavorite) repository.toggleFavorite(it)
                                    }
                                    selectedIds = emptySet()
                                    refreshAll()
                                    Toast.makeText(context, "Aggiunti ai preferiti", Toast.LENGTH_SHORT).show()
                                } catch (t: Throwable) {
                                    Toast.makeText(context, t.message ?: "Errore batch preferiti", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }) {
                            Icon(Icons.Default.Favorite, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Preferiti")
                        }
                        TextButton(onClick = {
                            scope.launch {
                                try {
                                    repository.moveToTrash(selectedIds.toList())
                                    selectedIds = emptySet()
                                    refreshAll()
                                    Toast.makeText(context, "Spostati nel cestino", Toast.LENGTH_SHORT).show()
                                } catch (t: Throwable) {
                                    Toast.makeText(context, t.message ?: "Errore cestino", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }) {
                            Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Cestina", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            } else {
                NavigationBar {
                    NavigationBarItem(
                        selected = !showTrashView && selectedTab == ZkVaultTab.GALLERY,
                        onClick = { showTrashView = false; selectedTab = ZkVaultTab.GALLERY },
                        icon = { Icon(Icons.Default.PhotoLibrary, contentDescription = null) },
                        label = { Text(ZkVaultTab.GALLERY.label) }
                    )
                    NavigationBarItem(
                        selected = !showTrashView && selectedTab == ZkVaultTab.ALBUMS,
                        onClick = { showTrashView = false; selectedTab = ZkVaultTab.ALBUMS },
                        icon = { Icon(Icons.Default.Collections, contentDescription = null) },
                        label = { Text(ZkVaultTab.ALBUMS.label) }
                    )
                    NavigationBarItem(
                        selected = !showTrashView && selectedTab == ZkVaultTab.MAP,
                        onClick = { showTrashView = false; selectedTab = ZkVaultTab.MAP },
                        icon = { Icon(Icons.Default.LocationOn, contentDescription = null) },
                        label = { Text(ZkVaultTab.MAP.label) }
                    )
                    NavigationBarItem(
                        selected = !showTrashView && selectedTab == ZkVaultTab.SHARES,
                        onClick = { showTrashView = false; selectedTab = ZkVaultTab.SHARES },
                        icon = { Icon(Icons.Default.Link, contentDescription = null) },
                        label = { Text(ZkVaultTab.SHARES.label) }
                    )
                    NavigationBarItem(
                        selected = !showTrashView && selectedTab == ZkVaultTab.SECURITY,
                        onClick = { showTrashView = false; selectedTab = ZkVaultTab.SECURITY },
                        icon = { Icon(Icons.Default.Security, contentDescription = null) },
                        label = { Text(ZkVaultTab.SECURITY.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        if (showTrashView) {
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = innerPadding.calculateTopPadding() + 12.dp,
                    bottom = innerPadding.calculateBottomPadding() + 24.dp
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                if (trashedItems.isNotEmpty()) {
                    item {
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    try {
                                        repository.emptyTrash()
                                        refreshAll()
                                    } catch (t: Throwable) {
                                        Toast.makeText(context, t.message ?: "Errore svuotamento cestino", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.DeleteForever, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Svuota Cestino (${trashedItems.size})")
                        }
                    }
                }
                if (trashedItems.isEmpty()) {
                    item {
                        Text(
                            text = "Il cestino cifrato è vuoto.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 24.dp)
                        )
                    }
                } else {
                    items(trashedItems, key = { it.id }) { item ->
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.padding(12.dp)
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = item.meta.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = formatBytesHuman(item.meta.size),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                IconButton(onClick = {
                                    scope.launch {
                                        try {
                                            repository.restoreFromTrash(listOf(item.id))
                                            refreshAll()
                                        } catch (t: Throwable) {
                                            Toast.makeText(context, t.message ?: "Errore ripristino", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                }) {
                                    Icon(Icons.Default.RestoreFromTrash, contentDescription = "Ripristina")
                                }
                                IconButton(onClick = {
                                    scope.launch {
                                        try {
                                            repository.deleteItemPermanently(item.id)
                                            refreshAll()
                                        } catch (t: Throwable) {
                                            Toast.makeText(context, t.message ?: "Errore eliminazione", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                }) {
                                    Icon(
                                        Icons.Default.DeleteForever,
                                        contentDescription = "Elimina definitivamente",
                                        tint = MaterialTheme.colorScheme.error
                                    )
                                }
                            }
                        }
                    }
                }
            }
        } else when (selectedTab) {
            ZkVaultTab.GALLERY -> {
                val filtered = remember(activeItems, searchQuery) {
                    val q = searchQuery.trim().lowercase(Locale.ROOT)
                    if (q.isEmpty()) activeItems
                    else activeItems.filter {
                        it.meta.name.lowercase(Locale.ROOT).contains(q) ||
                            it.meta.mime.lowercase(Locale.ROOT).contains(q)
                    }
                }
                val orderedFilteredIds = remember(filtered) { filtered.map { it.id } }
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(
                        start = 12.dp,
                        end = 12.dp,
                        top = innerPadding.calculateTopPadding() + 8.dp,
                        bottom = innerPadding.calculateBottomPadding() + 84.dp
                    ),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(orderedFilteredIds, selectedIds) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = { startOffset ->
                                    val hit = GalleryDragSelectionController.findCellAtPoint(
                                        cells = tileBounds.values.toList(),
                                        x = startOffset.x,
                                        y = startOffset.y,
                                        snapToNearest = false
                                    )
                                    if (hit != null) {
                                        selectedIds = dragController.startDragSelection(
                                            anchorIndex = hit.index,
                                            allFilenames = orderedFilteredIds,
                                            existingSelection = selectedIds
                                        )
                                    }
                                },
                                onDrag = { change, _ ->
                                    change.consume()
                                    val pos = change.position
                                    val hit = GalleryDragSelectionController.findCellAtPoint(
                                        cells = tileBounds.values.toList(),
                                        x = pos.x,
                                        y = pos.y,
                                        snapToNearest = true
                                    )
                                    if (hit != null) {
                                        val update = dragController.updateDragSelection(
                                            targetIndex = hit.index,
                                            allFilenames = orderedFilteredIds
                                        )
                                        if (update.changed) {
                                            selectedIds = update.selectedFilenames
                                        }
                                    }
                                },
                                onDragEnd = { dragController.endDragSelection() },
                                onDragCancel = { dragController.endDragSelection() }
                            )
                        }
                ) {
                    if (ZkTransferManager.requiresHttpsWarning(form.serverUrl)) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.errorContainer,
                                modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(10.dp)
                                ) {
                                    Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        text = "Attenzione: connessione HTTP non HTTPS attiva (solo test locale).",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onErrorContainer
                                    )
                                }
                            }
                        }
                    }

                    item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            placeholder = { Text("Cerca in RAM (nome, tipo)...") },
                            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                            trailingIcon = {
                                if (searchQuery.isNotEmpty()) {
                                    IconButton(onClick = { searchQuery = "" }) {
                                        Icon(Icons.Default.Close, contentDescription = "Pulisci")
                                    }
                                }
                            },
                            singleLine = true,
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)
                        )
                    }

                    if (statusError != null) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            Text(
                                text = statusError!!,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(vertical = 4.dp)
                            )
                        }
                    }

                    if (transfers.isNotEmpty()) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            ZkTransferQueueCard(
                                transfers = transfers,
                                onPause = { transferManager.pause(it) },
                                onResume = { transferManager.resume(it) },
                                onCancel = { transferManager.cancel(it) },
                                onClearFinished = { transferManager.clearFinished() }
                            )
                        }
                    }

                    if (isRefreshing && activeItems.isEmpty()) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(32.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator()
                            }
                        }
                    } else if (filtered.isEmpty()) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(32.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "Nessun elemento nel Vault cifrato. Tocca + per caricare foto o video.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    } else {
                        itemsIndexed(filtered, key = { _, it -> it.id }) { index, item ->
                            val isSelected = item.id in selectedIds
                            ZkEncryptedThumbTile(
                                item = item,
                                itemIndex = index,
                                repository = repository,
                                isSelectionMode = selectedIds.isNotEmpty(),
                                isSelected = isSelected,
                                onBoundsChanged = { bounds ->
                                    tileBounds[item.id] = bounds
                                },
                                onClick = {
                                    if (selectedIds.isNotEmpty()) {
                                        selectedIds = if (isSelected) selectedIds - item.id else selectedIds + item.id
                                    } else {
                                        viewerItem = item
                                    }
                                },
                                onLongClick = {
                                    selectedIds = if (isSelected) selectedIds - item.id else selectedIds + item.id
                                }
                            )
                        }
                    }
                }
            }

            ZkVaultTab.ALBUMS -> {
                val activeAlbum = albumsState.document.albums.firstOrNull { it.id == selectedAlbumId }
                if (activeAlbum != null) {
                    val albumItems = activeItems.filter { it.id in activeAlbum.itemIds }
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        contentPadding = PaddingValues(
                            start = 12.dp,
                            end = 12.dp,
                            top = innerPadding.calculateTopPadding() + 8.dp,
                            bottom = innerPadding.calculateBottomPadding() + 24.dp
                        ),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconButton(onClick = { selectedAlbumId = null }) {
                                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Indietro")
                                    }
                                    Text(
                                        text = "${activeAlbum.name} (${albumItems.size})",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                TextButton(onClick = {
                                    scope.launch {
                                        try {
                                            val updatedDoc = albumsState.document.copy(
                                                albums = albumsState.document.albums.filterNot { it.id == activeAlbum.id }
                                            )
                                            albumsState = repository.saveAlbums(
                                                updatedDoc,
                                                albumsState.revision,
                                                albumsState.etag
                                            )
                                            selectedAlbumId = null
                                        } catch (t: Throwable) {
                                            Toast.makeText(context, t.message ?: "Errore eliminazione album", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                }) {
                                    Text("Elimina", color = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                        items(albumItems, key = { it.id }) { item ->
                            ZkEncryptedThumbTile(
                                item = item,
                                repository = repository,
                                onClick = { viewerItem = item }
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(
                            start = 16.dp,
                            end = 16.dp,
                            top = innerPadding.calculateTopPadding() + 12.dp,
                            bottom = innerPadding.calculateBottomPadding() + 84.dp
                        ),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        if (albumsState.document.albums.isEmpty()) {
                            item {
                                Text(
                                    text = "Nessun album cifrato. Tocca + per creare un album (salvato cifrato con ETag/If-Match).",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(vertical = 24.dp)
                                )
                            }
                        } else {
                            items(albumsState.document.albums, key = { it.id }) { album ->
                                Surface(
                                    onClick = { selectedAlbumId = album.id },
                                    shape = RoundedCornerShape(16.dp),
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        modifier = Modifier.padding(16.dp)
                                    ) {
                                        Column {
                                            Text(
                                                text = album.name,
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.SemiBold
                                            )
                                            Text(
                                                text = "${album.itemIds.size} elementi • cifrato E2EE",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                        Icon(Icons.Default.Collections, contentDescription = null)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            ZkVaultTab.MAP -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                ) {
                    ZkV2GpsMapScreen(
                        items = activeItems,
                        repository = repository,
                        focusItemId = mapFocusItemId,
                        onOpenItem = { item -> viewerItem = item }
                    )
                }
            }

            ZkVaultTab.SHARES -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                ) {
                    ZkV2SharesScreen(repository = repository)
                }
            }

            ZkVaultTab.SECURITY -> {
                LazyColumn(
                    contentPadding = PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        top = innerPadding.calculateTopPadding() + 12.dp,
                        bottom = innerPadding.calculateBottomPadding() + 28.dp
                    ),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    // Storage stats card
                    item {
                        Surface(
                            shape = RoundedCornerShape(18.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "Spazio Vault Cifrato",
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    TextButton(onClick = { onAuthEvent(ZkV2UiEvent.OpenServerConfig) }) {
                                        Icon(Icons.Default.Dns, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("Server")
                                    }
                                }
                                val st = stats
                                if (st != null) {
                                    Text(
                                        text = "Attivi: ${st.activeCount} (${formatBytesHuman(st.activeBytes)}) • Cestino: ${st.trashedCount} (${formatBytesHuman(st.trashedBytes)})",
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                    if (st.quotaBytes > 0L) {
                                        val frac = ((st.activeBytes + st.trashedBytes).toFloat() / st.quotaBytes.toFloat()).coerceIn(0f, 1f)
                                        LinearProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxWidth())
                                        Text(
                                            text = "Quota: ${formatBytesHuman(st.quotaBytes)}",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                } else {
                                    Text("Caricamento statistiche...", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }

                    // Auto-Backup Zero-Knowledge v2 Card
                    item {
                        Surface(
                            shape = RoundedCornerShape(18.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Backup, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        text = "Auto-Backup Zero-Knowledge v2",
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("Attiva Auto-Backup cifrato", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                                        Text(
                                            "Usa chiave background AndroidKeyStore (setUnlockedDeviceRequired)",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    Switch(
                                        checked = backupConfig.enabled,
                                        onCheckedChange = { enable ->
                                            if (enable && session.keyProtectionStatus?.backgroundEnrolled != true) {
                                                onAuthEvent(ZkV2UiEvent.ToggleBackgroundBackupKey(true))
                                            }
                                            val updated = backupConfig.copy(
                                                enabled = enable,
                                                paused = false,
                                                activatedAtMs = if (enable && backupConfig.activatedAtMs == 0L) System.currentTimeMillis() else backupConfig.activatedAtMs
                                            )
                                            backupConfig = updated
                                            ZkAutoBackupPrefs.save(context, updated)
                                            ZkAutoBackupWorker.syncScheduleFromPrefs(context)
                                        }
                                    )
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Solo Wi-Fi (unmetered)", style = MaterialTheme.typography.bodySmall)
                                    Switch(
                                        checked = backupConfig.wifiOnly,
                                        onCheckedChange = { v ->
                                            val updated = backupConfig.copy(wifiOnly = v)
                                            backupConfig = updated
                                            ZkAutoBackupPrefs.save(context, updated)
                                            ZkAutoBackupWorker.syncScheduleFromPrefs(context)
                                        }
                                    )
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Solo in carica", style = MaterialTheme.typography.bodySmall)
                                    Switch(
                                        checked = backupConfig.chargingOnly,
                                        onCheckedChange = { v ->
                                            val updated = backupConfig.copy(chargingOnly = v)
                                            backupConfig = updated
                                            ZkAutoBackupPrefs.save(context, updated)
                                            ZkAutoBackupWorker.syncScheduleFromPrefs(context)
                                        }
                                    )
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("Includi coordinate GPS nei metadati", style = MaterialTheme.typography.bodySmall)
                                        Text(
                                            "Disattivato di default per privacy (GPS escluso da encMeta)",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    Switch(
                                        checked = backupConfig.includeGps,
                                        onCheckedChange = { v ->
                                            val updated = backupConfig.copy(includeGps = v)
                                            backupConfig = updated
                                            ZkAutoBackupPrefs.save(context, updated)
                                        }
                                    )
                                }
                                Text(
                                    text = "Parallelismo upload (1–16): $parallelism",
                                    style = MaterialTheme.typography.labelMedium
                                )
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    listOf(1, 2, 4, 8, 16).forEach { p ->
                                        val selected = parallelism == p
                                        OutlinedButton(
                                            onClick = {
                                                val applied = transferManager.setParallelism(p)
                                                val updated = backupConfig.copy(parallelism = applied)
                                                backupConfig = updated
                                                ZkAutoBackupPrefs.save(context, updated)
                                            },
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                            colors = if (selected) {
                                                ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
                                            } else {
                                                ButtonDefaults.outlinedButtonColors()
                                            },
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Text("$p")
                                        }
                                    }
                                }
                                if (backupConfig.enabled) {
                                    FilledTonalButton(
                                        onClick = {
                                            ZkAutoBackupWorker.enqueueImmediate(context)
                                            Toast.makeText(context, "Backup cifrato v2 avviato in background", Toast.LENGTH_SHORT).show()
                                        },
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Text("Avvia Backup Ora")
                                    }
                                }
                            }
                        }
                    }

                    // Keystore & Auto-lock & Rewrap & Logout (Phase 4B controls)
                    item {
                        ZkV2SecurityControlsCard(
                            session = session,
                            form = form,
                            onEvent = onAuthEvent
                        )
                    }
                }
            }
        }
    }

    if (showCreateAlbumDialog) {
        AlertDialog(
            onDismissRequest = { showCreateAlbumDialog = false },
            title = { Text("Nuovo Album Cifrato", fontWeight = FontWeight.SemiBold) },
            text = {
                OutlinedTextField(
                    value = newAlbumName,
                    onValueChange = { newAlbumName = it },
                    label = { Text("Nome album") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(
                    enabled = newAlbumName.isNotBlank(),
                    onClick = {
                        val name = newAlbumName.trim()
                        showCreateAlbumDialog = false
                        scope.launch {
                            try {
                                val now = System.currentTimeMillis()
                                val created = ZkAlbumRecord(
                                    id = UUID.randomUUID().toString().lowercase(),
                                    name = name,
                                    itemIds = emptyList(),
                                    createdAt = now,
                                    updatedAt = now
                                )
                                val updatedDoc = albumsState.document.copy(
                                    albums = albumsState.document.albums + created
                                )
                                albumsState = repository.saveAlbums(
                                    updatedDoc,
                                    albumsState.revision,
                                    albumsState.etag
                                )
                            } catch (t: Throwable) {
                                Toast.makeText(context, t.message ?: "Errore creazione album", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                ) {
                    Text("Crea")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateAlbumDialog = false }) {
                    Text("Annulla")
                }
            }
        )
    }

    if (showAddToAlbumDialog && selectedIds.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { showAddToAlbumDialog = false },
            title = { Text("Aggiungi ${selectedIds.size} foto ad Album") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (albumsState.document.albums.isEmpty()) {
                        Text("Nessun album presente. Creane prima uno nella scheda Album.")
                    } else {
                        albumsState.document.albums.forEach { album ->
                            Surface(
                                onClick = {
                                    scope.launch {
                                        try {
                                            val merged = (album.itemIds + selectedIds).distinct()
                                            val updatedAlbums = albumsState.document.albums.map {
                                                if (it.id == album.id) it.copy(itemIds = merged, updatedAt = System.currentTimeMillis()) else it
                                            }
                                            albumsState = repository.saveAlbums(
                                                albumsState.document.copy(albums = updatedAlbums),
                                                albumsState.revision,
                                                albumsState.etag
                                            )
                                            showAddToAlbumDialog = false
                                            selectedIds = emptySet()
                                            Toast.makeText(context, "Aggiunti ad \"${album.name}\"", Toast.LENGTH_SHORT).show()
                                        } catch (t: Throwable) {
                                            Toast.makeText(context, t.message ?: "Errore aggiunta album", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                },
                                shape = RoundedCornerShape(10.dp),
                                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = "${album.name} (${album.itemIds.size})",
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showAddToAlbumDialog = false }) {
                    Text("Chiudi")
                }
            }
        )
    }

    if (shareResult != null) {
        val sr = shareResult!!
        AlertDialog(
            onDismissRequest = { shareResult = null },
            icon = { Icon(Icons.Default.Share, contentDescription = null) },
            title = { Text("Link Zero-Knowledge Creato", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "La chiave di decifratura è contenuta solo nel #fragment dell'URL e non viene mai inviata al server.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerHighest,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = sr.shareUrlWithFragment,
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }
            },
            confirmButton = {
                Button(onClick = {
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("PhotoCloud Share Link", sr.shareUrlWithFragment))
                    Toast.makeText(context, "Link cifrato copiato negli appunti", Toast.LENGTH_SHORT).show()
                    shareResult = null
                }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Copia Link")
                }
            },
            dismissButton = {
                TextButton(onClick = { shareResult = null }) {
                    Text("Chiudi")
                }
            }
        )
    }
}

@Composable
private fun ZkTransferQueueCard(
    transfers: List<ZkTransferItemState>,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onCancel: (String) -> Unit,
    onClearFinished: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Coda Upload Cifrata (${transfers.size})",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )
                TextButton(onClick = onClearFinished) {
                    Text("Pulisci")
                }
            }
            for (t in transfers.take(6)) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = t.displayName,
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = when (t.status) {
                                    ZkTransferStatus.QUEUED -> "In coda..."
                                    ZkTransferStatus.RUNNING -> "Cifratura/Upload ${t.uploadedChunks}/${t.totalChunks}"
                                    ZkTransferStatus.PAUSED -> "In pausa"
                                    ZkTransferStatus.COMPLETED -> "Completato"
                                    ZkTransferStatus.SKIPPED_DUPLICATE -> "Già presente (dedup)"
                                    ZkTransferStatus.CANCELLED -> "Annullato"
                                    ZkTransferStatus.FAILED -> t.errorMessage ?: "Errore"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = if (t.status == ZkTransferStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Row {
                            if (t.status == ZkTransferStatus.RUNNING || t.status == ZkTransferStatus.QUEUED) {
                                IconButton(onClick = { onPause(t.transferId) }, modifier = Modifier.size(32.dp)) {
                                    Icon(Icons.Default.Pause, contentDescription = "Pausa", modifier = Modifier.size(18.dp))
                                }
                            } else if (t.status == ZkTransferStatus.PAUSED || t.status == ZkTransferStatus.FAILED) {
                                IconButton(onClick = { onResume(t.transferId) }, modifier = Modifier.size(32.dp)) {
                                    Icon(Icons.Default.PlayArrow, contentDescription = "Riprendi", modifier = Modifier.size(18.dp))
                                }
                            }
                            if (t.status != ZkTransferStatus.COMPLETED && t.status != ZkTransferStatus.SKIPPED_DUPLICATE && t.status != ZkTransferStatus.CANCELLED) {
                                IconButton(onClick = { onCancel(t.transferId) }, modifier = Modifier.size(32.dp)) {
                                    Icon(Icons.Default.Cancel, contentDescription = "Annulla", modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                    if (t.status == ZkTransferStatus.RUNNING || t.status == ZkTransferStatus.PAUSED) {
                        LinearProgressIndicator(
                            progress = { t.progressFraction },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ZkEncryptedThumbTile(
    item: DecryptedZkItem,
    repository: ZkVaultRepository,
    itemIndex: Int = -1,
    isSelectionMode: Boolean = false,
    isSelected: Boolean = false,
    onBoundsChanged: ((GridCellBounds) -> Unit)? = null,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null
) {
    var bitmap by remember(item.blobId) { mutableStateOf<Bitmap?>(null) }

    LaunchedEffect(item.blobId) {
        val bytes = try {
            repository.getDecryptedThumbnail(item.blobId, "320")
        } catch (_: Throwable) {
            null
        }
        if (bytes != null) {
            val decoded = withContext(Dispatchers.Default) {
                try {
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                } catch (_: Throwable) {
                    null
                } finally {
                    bytes.zeroize()
                }
            }
            bitmap = decoded
        }
    }

    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .onGloballyPositioned { coords ->
                if (onBoundsChanged != null && itemIndex >= 0) {
                    val r = coords.boundsInParent()
                    onBoundsChanged(
                        GridCellBounds(
                            filename = item.id,
                            index = itemIndex,
                            left = r.left,
                            top = r.top,
                            right = r.right,
                            bottom = r.bottom
                        )
                    )
                }
            }
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .then(
                if (isSelected) Modifier.border(2.5.dp, Color(0xFF38BDF8), RoundedCornerShape(10.dp))
                else Modifier
            )
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            )
    ) {
        val bmp = bitmap
        if (bmp != null) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = item.meta.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Box(
                modifier = Modifier.fillMaxSize().padding(6.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = item.meta.name,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        if (isSelectionMode || isSelected) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(6.dp)
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(if (isSelected) Color(0xFF0284C7) else Color(0x88000000))
                    .border(1.5.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                if (isSelected) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = "Selezionato",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }

        if (item.isVideo) {
            Surface(
                shape = CircleShape,
                color = Color.Black.copy(alpha = 0.65f),
                modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Videocam,
                    contentDescription = "Video",
                    tint = Color.White,
                    modifier = Modifier.padding(4.dp).size(14.dp)
                )
            }
        }

        if (item.meta.isFavorite) {
            Icon(
                imageVector = Icons.Default.Favorite,
                contentDescription = "Preferito",
                tint = Color.Red,
                modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).size(16.dp)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ZkV2ItemViewerScreen(
    item: DecryptedZkItem,
    repository: ZkVaultRepository,
    onClose: () -> Unit,
    onToggleFavorite: (DecryptedZkItem) -> Unit,
    onEditPhoto: (DecryptedZkItem) -> Unit,
    onOpenOnMap: (DecryptedZkItem) -> Unit,
    onCreateShare: (DecryptedZkItem) -> Unit,
    onOpenExternal: (DecryptedZkItem) -> Unit,
    onMoveToTrash: (DecryptedZkItem) -> Unit
) {
    var fullImageBitmap by remember(item.blobId) { mutableStateOf<Bitmap?>(null) }
    var loadError by remember(item.blobId) { mutableStateOf<String?>(null) }
    var isLoading by remember(item.blobId) { mutableStateOf(!item.isVideo) }

    LaunchedEffect(item.blobId) {
        if (!item.isVideo) {
            isLoading = true
            loadError = null
            try {
                val bytes = repository.decryptBlobToBytes(item.blobId)
                val decoded = withContext(Dispatchers.Default) {
                    try {
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    } finally {
                        bytes.zeroize()
                    }
                }
                fullImageBitmap = decoded
            } catch (t: Throwable) {
                loadError = t.message ?: "Errore decifratura elemento."
            } finally {
                isLoading = false
            }
        }
    }

    val hasGps = item.meta.exifSubset?.lat != null && item.meta.exifSubset.lon != null

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Chiudi")
                    }
                },
                title = {
                    Text(
                        text = item.meta.name,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium
                    )
                },
                actions = {
                    if (item.isImage) {
                        IconButton(onClick = { onEditPhoto(item) }) {
                            Icon(Icons.Default.Edit, contentDescription = "Modifica foto E2EE")
                        }
                    }
                    if (hasGps) {
                        IconButton(onClick = { onOpenOnMap(item) }) {
                            Icon(Icons.Default.LocationOn, contentDescription = "Vedi sulla Mappa GPS")
                        }
                    }
                    IconButton(onClick = { onToggleFavorite(item) }) {
                        Icon(
                            imageVector = if (item.meta.isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                            contentDescription = "Preferito"
                        )
                    }
                    IconButton(onClick = { onCreateShare(item) }) {
                        Icon(Icons.Default.Share, contentDescription = "Condividi Zero-Knowledge")
                    }
                    IconButton(onClick = { onOpenExternal(item) }) {
                        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Apri con...")
                    }
                    IconButton(onClick = { onMoveToTrash(item) }) {
                        Icon(Icons.Default.Delete, contentDescription = "Cestina")
                    }
                }
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .padding(innerPadding),
            contentAlignment = Alignment.Center
        ) {
            if (item.isVideo) {
                ZkEncryptedStreamingVideoPlayer(
                    blobId = item.blobId,
                    repository = repository
                )
            } else if (isLoading) {
                CircularProgressIndicator()
            } else if (loadError != null) {
                Text(text = loadError!!, color = Color.White)
            } else if (fullImageBitmap != null) {
                Image(
                    bitmap = fullImageBitmap!!.asImageBitmap(),
                    contentDescription = item.meta.name,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Text(
                    text = "Anteprima non immagine (${item.meta.mime}). Usa 'Apri con...' per aprire il file.",
                    color = Color.White,
                    modifier = Modifier.padding(24.dp)
                )
            }
        }
    }
}

@Composable
private fun ZkEncryptedStreamingVideoPlayer(
    blobId: String,
    repository: ZkVaultRepository
) {
    val reader = remember(blobId) { repository.openStreamingRangeReader(blobId) }
    var mediaPlayer by remember(blobId) { mutableStateOf<MediaPlayer?>(null) }
    var isPlaying by remember(blobId) { mutableStateOf(false) }
    var durationMs by remember(blobId) { mutableIntStateOf(0) }
    var positionMs by remember(blobId) { mutableFloatStateOf(0f) }
    var playerError by remember(blobId) { mutableStateOf<String?>(null) }

    DisposableEffect(blobId) {
        onDispose {
            try {
                mediaPlayer?.stop()
                mediaPlayer?.release()
            } catch (_: Throwable) {
            }
            mediaPlayer = null
            reader.close()
        }
    }

    LaunchedEffect(mediaPlayer, isPlaying) {
        while (isPlaying && mediaPlayer != null) {
            try {
                positionMs = (mediaPlayer?.currentPosition ?: 0).toFloat()
            } catch (_: Throwable) {
            }
            delay(400L)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            AndroidView(
                factory = { ctx ->
                    SurfaceView(ctx).apply {
                        holder.addCallback(object : SurfaceHolder.Callback {
                            override fun surfaceCreated(holder: SurfaceHolder) {
                                try {
                                    val mp = MediaPlayer()
                                    mp.setDisplay(holder)
                                    mp.setDataSource(ZkAndroidMediaDataSource(reader))
                                    mp.setOnPreparedListener { ready ->
                                        durationMs = ready.duration.coerceAtLeast(1)
                                        ready.start()
                                        isPlaying = true
                                    }
                                    mp.setOnCompletionListener {
                                        isPlaying = false
                                    }
                                    mp.setOnErrorListener { _, what, extra ->
                                        playerError = "Errore riproduzione cifrata ($what/$extra)"
                                        isPlaying = false
                                        true
                                    }
                                    mp.prepareAsync()
                                    mediaPlayer = mp
                                } catch (t: Throwable) {
                                    playerError = t.message ?: "Impossibile avviare stream video cifrato."
                                }
                            }

                            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

                            override fun surfaceDestroyed(holder: SurfaceHolder) {
                                try {
                                    mediaPlayer?.pause()
                                    isPlaying = false
                                } catch (_: Throwable) {
                                }
                            }
                        })
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
            if (playerError != null) {
                Text(text = playerError!!, color = Color.White, modifier = Modifier.padding(16.dp))
            }
        }

        Surface(
            color = Color.Black.copy(alpha = 0.8f),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                IconButton(onClick = {
                    val mp = mediaPlayer ?: return@IconButton
                    try {
                        if (mp.isPlaying) {
                            mp.pause()
                            isPlaying = false
                        } else {
                            mp.start()
                            isPlaying = true
                        }
                    } catch (_: Throwable) {
                    }
                }) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) "Pausa" else "Riproduci",
                        tint = Color.White
                    )
                }
                Slider(
                    value = positionMs.coerceIn(0f, durationMs.coerceAtLeast(1).toFloat()),
                    onValueChange = { target ->
                        positionMs = target
                        try {
                            mediaPlayer?.seekTo(target.toInt())
                        } catch (_: Throwable) {
                        }
                    },
                    valueRange = 0f..durationMs.coerceAtLeast(1).toFloat(),
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun ZkV2SecurityControlsCard(
    session: ZkSessionSnapshot,
    form: ZkV2LoginFormUiState,
    onEvent: (ZkV2UiEvent) -> Unit
) {
    val keyStatus = session.keyProtectionStatus

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "AndroidKeyStore Hardware Protection",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
                val hwSummary = when {
                    keyStatus == null -> "Stato non inizializzato"
                    keyStatus.strongBoxBacked -> "StrongBox Hardware SE attivo"
                    keyStatus.hardwareBacked -> "TEE Hardware KeyStore attivo (StrongBox non disponibile)"
                    else -> "Chiavi hardware da configurare"
                }
                Text(
                    text = hwSummary,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (form.canUseStrongBiometrics) {
                    FilledTonalButton(
                        onClick = { onEvent(ZkV2UiEvent.EnrollBiometricUnlock) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Fingerprint, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (keyStatus?.biometricEnrolled == true) {
                                "Disattiva Sblocco Biometrico"
                            } else {
                                "Attiva Sblocco Biometrico (CryptoObject)"
                            }
                        )
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Chiave Background (setUnlockedDeviceRequired)",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Switch(
                        checked = keyStatus?.backgroundEnrolled == true,
                        onCheckedChange = { onEvent(ZkV2UiEvent.ToggleBackgroundBackupKey(it)) }
                    )
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "Auto-Lock e Rotazione Passphrase",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Blocca su passaggio in background", style = MaterialTheme.typography.bodySmall)
                    Switch(
                        checked = session.lockOnBackground,
                        onCheckedChange = {
                            onEvent(ZkV2UiEvent.SetAutoLockConfig(session.autoLockTimeoutMs, it))
                        }
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf(
                        5 * 60 * 1000L to "5m",
                        15 * 60 * 1000L to "15m",
                        30 * 60 * 1000L to "30m"
                    ).forEach { (ms, label) ->
                        val selected = session.autoLockTimeoutMs == ms
                        OutlinedButton(
                            onClick = { onEvent(ZkV2UiEvent.SetAutoLockConfig(ms, session.lockOnBackground)) },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            colors = if (selected) {
                                ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
                            } else {
                                ButtonDefaults.outlinedButtonColors()
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(label)
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    FilledTonalButton(
                        onClick = { onEvent(ZkV2UiEvent.LockNow) },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Blocca Ora")
                    }
                    OutlinedButton(
                        onClick = { onEvent(ZkV2UiEvent.OpenRewrapDialog) },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Passphrase")
                    }
                }
                OutlinedButton(
                    onClick = { onEvent(ZkV2UiEvent.ExportCurrentKeyFile) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Esporta Backup File Chiave (.json)")
                }
            }
        }

        Button(
            onClick = { onEvent(ZkV2UiEvent.Logout) },
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.errorContainer,
                contentColor = MaterialTheme.colorScheme.onErrorContainer
            ),
            shape = CircleShape,
            modifier = Modifier.fillMaxWidth().height(48.dp)
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Disconnetti e Cancella Chiavi", fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun formatBytesHuman(bytes: Long): String {
    if (bytes < 1024L) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024.0) return String.format(Locale.US, "%.1f KB", kb)
    val mb = kb / 1024.0
    if (mb < 1024.0) return String.format(Locale.US, "%.1f MB", mb)
    return String.format(Locale.US, "%.2f GB", mb / 1024.0)
}
