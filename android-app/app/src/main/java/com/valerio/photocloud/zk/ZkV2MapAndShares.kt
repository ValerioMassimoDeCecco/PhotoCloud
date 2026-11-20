package com.valerio.photocloud.zk

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tan

private data class ZkMapCluster(
    val id: String,
    val centerLat: Double,
    val centerLon: Double,
    val screenX: Float,
    val screenY: Float,
    val items: List<DecryptedZkItem>
)

private fun latLonToWorldNormalized(lat: Double, lon: Double): Pair<Double, Double> {
    val clampedLat = lat.coerceIn(-85.05112878, 85.05112878)
    val x = (lon + 180.0) / 360.0
    val sinLat = sin(clampedLat * PI / 180.0)
    val y = 0.5 - ln((1.0 + sinLat) / (1.0 - sinLat)) / (4.0 * PI)
    return x to y
}

private fun buildViewportClusters(
    items: List<DecryptedZkItem>,
    centerLat: Double,
    centerLon: Double,
    zoom: Float,
    canvasW: Float,
    canvasH: Float,
    clusterRadiusPx: Float = 54f
): List<ZkMapCluster> {
    if (canvasW <= 1f || canvasH <= 1f || items.isEmpty()) return emptyList()
    val worldPx = 256.0 * 2.0.pow(zoom.toDouble())
    val (cxNorm, cyNorm) = latLonToWorldNormalized(centerLat, centerLon)
    val cxPx = cxNorm * worldPx
    val cyPx = cyNorm * worldPx

    data class Projected(val item: DecryptedZkItem, val lat: Double, val lon: Double, val sx: Float, val sy: Float)
    val projected = items.mapNotNull { item ->
        val lat = item.meta.exifSubset?.lat ?: return@mapNotNull null
        val lon = item.meta.exifSubset?.lon ?: return@mapNotNull null
        if (!lat.isFinite() || !lon.isFinite() || lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
            return@mapNotNull null
        }
        val (nx, ny) = latLonToWorldNormalized(lat, lon)
        val sx = (nx * worldPx - cxPx + canvasW / 2.0).toFloat()
        val sy = (ny * worldPx - cyPx + canvasH / 2.0).toFloat()
        Projected(item, lat, lon, sx, sy)
    }

    val visited = BooleanArray(projected.size)
    val clusters = ArrayList<ZkMapCluster>()
    for (i in projected.indices) {
        if (visited[i]) continue
        visited[i] = true
        val seed = projected[i]
        val members = ArrayList<Projected>().apply { add(seed) }
        for (j in i + 1 until projected.size) {
            if (visited[j]) continue
            val cand = projected[j]
            if (hypot((cand.sx - seed.sx).toDouble(), (cand.sy - seed.sy).toDouble()) <= clusterRadiusPx) {
                visited[j] = true
                members.add(cand)
            }
        }
        val avgLat = members.map { it.lat }.average()
        val avgLon = members.map { it.lon }.average()
        val avgX = members.map { it.sx.toDouble() }.average().toFloat()
        val avgY = members.map { it.sy.toDouble() }.average().toFloat()
        clusters.add(
            ZkMapCluster(
                id = members.first().item.id,
                centerLat = avgLat,
                centerLon = avgLon,
                screenX = avgX,
                screenY = avgY,
                items = members.map { it.item }
            )
        )
    }
    return clusters
}

/**
 * Client-Side Encrypted GPS Map Screen.
 * Coordinates are decrypted strictly in RAM from `encMeta.exifSubset.{lat,lon}` and NEVER sent to the server.
 */
@Composable
fun ZkV2GpsMapScreen(
    items: List<DecryptedZkItem>,
    repository: ZkVaultRepository,
    focusItemId: String? = null,
    onOpenItem: (DecryptedZkItem) -> Unit
) {
    val geoItems = remember(items) {
        items.filter {
            val lat = it.meta.exifSubset?.lat
            val lon = it.meta.exifSubset?.lon
            lat != null && lon != null && lat.isFinite() && lon.isFinite()
        }
    }

    var centerLat by remember { mutableDoubleStateOf(41.9028) }
    var centerLon by remember { mutableDoubleStateOf(12.4964) }
    var zoom by remember { mutableFloatStateOf(4.5f) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var selectedClusterId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(geoItems, focusItemId) {
        if (geoItems.isNotEmpty()) {
            val focused = focusItemId?.let { id -> geoItems.firstOrNull { it.id == id } }
            if (focused != null) {
                centerLat = focused.meta.exifSubset!!.lat!!
                centerLon = focused.meta.exifSubset!!.lon!!
                zoom = 11f
                selectedClusterId = focused.id
            } else {
                centerLat = geoItems.map { it.meta.exifSubset!!.lat!! }.average()
                centerLon = geoItems.map { it.meta.exifSubset!!.lon!! }.average()
                zoom = if (geoItems.size == 1) 11f else 5.5f
            }
        }
    }

    val clusters = remember(geoItems, centerLat, centerLon, zoom, canvasSize) {
        buildViewportClusters(
            items = geoItems,
            centerLat = centerLat,
            centerLon = centerLon,
            zoom = zoom,
            canvasW = canvasSize.width.toFloat(),
            canvasH = canvasSize.height.toFloat()
        )
    }

    val selectedCluster = remember(clusters, selectedClusterId) {
        clusters.firstOrNull { it.id == selectedClusterId }
            ?: clusters.firstOrNull { c -> c.items.any { it.id == selectedClusterId } }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0A0B0E))
    ) {
        // Map Header HUD
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = "Mappa GPS Zero-Knowledge",
                    style = MaterialTheme.typography.titleMedium,
                    color = Color(0xFFF3F4F6),
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "${geoItems.size} foto geolocalizzate decifrate in RAM",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF9CA3AF)
                )
            }
            Text(
                text = String.format(Locale.US, "%.3f, %.3f · Z%.1f", centerLat, centerLon, zoom),
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                color = Color(0xFF38BDF8)
            )
        }

        if (geoItems.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.LocationOn,
                        contentDescription = null,
                        tint = Color(0xFF38BDF8),
                        modifier = Modifier.size(44.dp)
                    )
                    Text(
                        text = "Nessuna foto con coordinate GPS cifrate",
                        color = Color(0xFFF3F4F6),
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Per massima privacy, le coordinate EXIF GPS sono escluse di default. Abilita l'opzione \"Includi GPS cifrato\" prima del caricamento per visualizzare le foto sulla mappa locale.",
                        color = Color(0xFF9CA3AF),
                        fontSize = 13.sp
                    )
                }
            }
            return
        }

        // Interactive Offline-Capable Web Mercator Vector Map Canvas
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(Color(0xFF070A10))
                .onSizeChanged { canvasSize = it }
                .pointerInput(zoom) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        val worldPx = 256.0 * 2.0.pow(zoom.toDouble())
                        val lonDelta = -(dragAmount.x / worldPx) * 360.0
                        val cosLat = cos(centerLat * PI / 180.0).coerceAtLeast(0.1)
                        val latDelta = (dragAmount.y / worldPx) * 360.0 * cosLat
                        centerLon = ((centerLon + lonDelta + 540.0) % 360.0) - 180.0
                        centerLat = (centerLat + latDelta).coerceIn(-82.0, 82.0)
                    }
                }
                .pointerInput(clusters) {
                    detectTapGestures { tapOffset ->
                        val hit = clusters.minByOrNull { c ->
                            hypot((c.screenX - tapOffset.x).toDouble(), (c.screenY - tapOffset.y).toDouble())
                        }
                        if (hit != null && hypot((hit.screenX - tapOffset.x).toDouble(), (hit.screenY - tapOffset.y).toDouble()) <= 56.0) {
                            selectedClusterId = hit.id
                            if (hit.items.size > 1 && zoom < 13f) {
                                centerLat = hit.centerLat
                                centerLon = hit.centerLon
                                zoom = (zoom + 2f).coerceAtMost(15f)
                            }
                        } else {
                            selectedClusterId = null
                        }
                    }
                }
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val w = size.width
                val h = size.height
                val gridStep = 64f
                var gx = 0f
                while (gx <= w) {
                    drawLine(Color(0xFF141B26), Offset(gx, 0f), Offset(gx, h), strokeWidth = 1f)
                    gx += gridStep
                }
                var gy = 0f
                while (gy <= h) {
                    drawLine(Color(0xFF141B26), Offset(0f, gy), Offset(w, gy), strokeWidth = 1f)
                    gy += gridStep
                }

                // Draw lat/lon equator & prime meridian guides
                val worldPx = 256.0 * 2.0.pow(zoom.toDouble())
                val (cxNorm, cyNorm) = latLonToWorldNormalized(centerLat, centerLon)
                val (eqX, eqY) = latLonToWorldNormalized(0.0, 0.0)
                val meridianScreenX = ((eqX - cxNorm) * worldPx + w / 2.0).toFloat()
                val equatorScreenY = ((eqY - cyNorm) * worldPx + h / 2.0).toFloat()
                if (meridianScreenX in 0f..w) {
                    drawLine(Color(0xFF1F2E42), Offset(meridianScreenX, 0f), Offset(meridianScreenX, h), strokeWidth = 1.5f)
                }
                if (equatorScreenY in 0f..h) {
                    drawLine(Color(0xFF1F2E42), Offset(0f, equatorScreenY), Offset(w, equatorScreenY), strokeWidth = 1.5f)
                }

                // Draw cluster markers
                for (cluster in clusters) {
                    if (cluster.screenX < -40f || cluster.screenX > w + 40f || cluster.screenY < -40f || cluster.screenY > h + 40f) {
                        continue
                    }
                    val isSelected = cluster.id == selectedCluster?.id
                    val baseRadius = if (cluster.items.size > 1) 24f else 15f
                    drawCircle(
                        color = if (isSelected) Color(0x4438BDF8) else Color(0x2838BDF8),
                        radius = baseRadius + 10f,
                        center = Offset(cluster.screenX, cluster.screenY)
                    )
                    drawCircle(
                        color = if (isSelected) Color(0xFF38BDF8) else Color(0xFF0284C7),
                        radius = baseRadius,
                        center = Offset(cluster.screenX, cluster.screenY)
                    )
                    drawCircle(
                        color = Color.White,
                        radius = baseRadius,
                        center = Offset(cluster.screenX, cluster.screenY),
                        style = Stroke(width = if (isSelected) 3f else 2f)
                    )
                }
            }

            // Cluster count badges overlay
            clusters.forEach { cluster ->
                if (cluster.items.size > 1) {
                    // Positioned via simple zoom controls HUD; detailed list shown in bottom drawer
                }
            }

            // Zoom & Recenter Controls
            Column(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Surface(
                    shape = CircleShape,
                    color = Color(0xDD151924),
                    modifier = Modifier.size(44.dp)
                ) {
                    IconButton(onClick = { zoom = (zoom + 1.5f).coerceAtMost(16f) }) {
                        Icon(Icons.Default.Add, contentDescription = "Zoom avanti", tint = Color(0xFFF3F4F6))
                    }
                }
                Surface(
                    shape = CircleShape,
                    color = Color(0xDD151924),
                    modifier = Modifier.size(44.dp)
                ) {
                    IconButton(onClick = { zoom = (zoom - 1.5f).coerceAtLeast(1.5f) }) {
                        Icon(Icons.Default.Remove, contentDescription = "Zoom indietro", tint = Color(0xFFF3F4F6))
                    }
                }
                Surface(
                    shape = CircleShape,
                    color = Color(0xDD151924),
                    modifier = Modifier.size(44.dp)
                ) {
                    IconButton(onClick = {
                        centerLat = geoItems.map { it.meta.exifSubset!!.lat!! }.average()
                        centerLon = geoItems.map { it.meta.exifSubset!!.lon!! }.average()
                        zoom = 5.5f
                    }) {
                        Icon(Icons.Default.MyLocation, contentDescription = "Centra", tint = Color(0xFF38BDF8))
                    }
                }
            }
        }

        // Bottom Decrypted Thumbnail Strip for Selected Cluster (or all geolocated photos)
        val previewItems = selectedCluster?.items ?: geoItems
        Surface(
            color = Color(0xFF11131A),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (selectedCluster != null) {
                            "Cluster (${selectedCluster.items.size} foto) · ${String.format(Locale.US, "%.4f, %.4f", selectedCluster.centerLat, selectedCluster.centerLon)}"
                        } else {
                            "Tutte le foto geolocalizzate (${geoItems.size})"
                        },
                        color = Color(0xFFD1D5DB),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                    if (selectedCluster != null) {
                        TextButton(onClick = { selectedClusterId = null }) {
                            Text("Mostra tutte", fontSize = 12.sp, color = Color(0xFF38BDF8))
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(previewItems, key = { it.id }) { item ->
                        ZkMapThumbCard(
                            item = item,
                            repository = repository,
                            onClick = { onOpenItem(item) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ZkMapThumbCard(
    item: DecryptedZkItem,
    repository: ZkVaultRepository,
    onClick: () -> Unit
) {
    var bmp by remember(item.blobId) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(item.blobId) {
        val bytes = try {
            repository.getDecryptedThumbnail(item.blobId, "320")
        } catch (_: Throwable) {
            null
        }
        if (bytes != null) {
            bmp = withContext(Dispatchers.Default) {
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        }
    }
    Column(
        modifier = Modifier
            .width(96.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0xFF191D28))
            .clickable(onClick = onClick)
            .padding(6.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(72.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Color(0xFF0E1118)),
            contentAlignment = Alignment.Center
        ) {
            val b = bmp
            if (b != null) {
                Image(
                    bitmap = b.asImageBitmap(),
                    contentDescription = item.meta.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Icon(Icons.Default.LocationOn, contentDescription = null, tint = Color(0xFF38BDF8))
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = item.meta.name,
            color = Color(0xFFE5E7EB),
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/**
 * E2EE Share Management & Revocation Screen.
 * Lists owner's encrypted shares via `GET /api/v2/shares`, decrypts titles & `#shareKey` locally,
 * supports 1-tap Copy Link and inline Revoke confirmation.
 */
@Composable
fun ZkV2SharesScreen(
    repository: ZkVaultRepository
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var shares by remember { mutableStateOf<List<DecryptedOwnerShare>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var infoMsg by remember { mutableStateOf<String?>(null) }
    var pendingRevokeId by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                shares = repository.listDecryptedOwnerShares()
            } catch (t: Throwable) {
                errorMsg = t.message ?: "Errore caricamento condivisioni."
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    val dateFormatter = remember { SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0A0B0E))
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = "Condivisioni E2EE",
                    style = MaterialTheme.typography.titleMedium,
                    color = Color(0xFFF3F4F6),
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Titoli e chiavi #fragment decifrati solo sul tuo dispositivo",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF9CA3AF)
                )
            }
            IconButton(onClick = { refresh() }) {
                Icon(Icons.Default.Refresh, contentDescription = "Aggiorna", tint = Color(0xFF38BDF8))
            }
        }

        if (infoMsg != null) {
            Text(infoMsg!!, color = Color(0xFF34D399), fontSize = 12.sp, modifier = Modifier.padding(vertical = 4.dp))
        }
        if (errorMsg != null) {
            Text(errorMsg!!, color = Color(0xFFF87171), fontSize = 12.sp, modifier = Modifier.padding(vertical = 4.dp))
        }

        Spacer(Modifier.height(8.dp))

        when {
            isLoading -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Color(0xFF38BDF8))
                }
            }
            shares.isEmpty() -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Default.Link, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(40.dp))
                        Text("Nessun link condiviso attivo", color = Color(0xFFF3F4F6), fontWeight = FontWeight.Medium)
                        Text(
                            "Seleziona una o più foto nella Galleria per creare un link E2EE revocabile in qualsiasi momento.",
                            color = Color(0xFF9CA3AF),
                            fontSize = 13.sp
                        )
                    }
                }
            }
            else -> {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(shares, key = { it.shareId }) { share ->
                        val expired = share.isExpired()
                        val exhausted = share.isExhausted()
                        val statusText = when {
                            expired -> "Scaduta"
                            exhausted -> "Esaurita"
                            else -> "Attiva"
                        }
                        val statusColor = when {
                            expired || exhausted -> Color(0xFFF59E0B)
                            else -> Color(0xFF34D399)
                        }
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF141822)),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.dp, Color(0xFF232938), RoundedCornerShape(12.dp))
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = share.title,
                                        color = Color(0xFFF3F4F6),
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 15.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Text(
                                        text = statusText,
                                        color = statusColor,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                                Text(
                                    text = "${share.itemCount} file · Download: ${share.downloadsCount}${share.maxDownloads?.let { "/$it" } ?: " (illimitati)"}",
                                    color = Color(0xFF9CA3AF),
                                    fontSize = 12.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                                Text(
                                    text = if (share.expiresAt != null) {
                                        "Scade il ${dateFormatter.format(Date(share.expiresAt))}"
                                    } else {
                                        "Nessuna scadenza · Creata il ${dateFormatter.format(Date(share.createdAt))}"
                                    },
                                    color = Color(0xFF6B7280),
                                    fontSize = 11.sp
                                )

                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    if (!share.shareUrlWithFragment.isNullOrBlank()) {
                                        OutlinedButton(
                                            onClick = {
                                                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                                cm?.setPrimaryClip(ClipData.newPlainText("PhotoCloud Share Link", share.shareUrlWithFragment))
                                                infoMsg = "Link E2EE copiato negli appunti."
                                            },
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(15.dp))
                                            Spacer(Modifier.width(6.dp))
                                            Text("Copia link", fontSize = 12.sp)
                                        }
                                    }
                                    if (pendingRevokeId == share.shareId) {
                                        Button(
                                            onClick = {
                                                scope.launch {
                                                    try {
                                                        repository.revokeShare(share.shareId)
                                                        pendingRevokeId = null
                                                        infoMsg = "Condivisione revocata."
                                                        refresh()
                                                    } catch (t: Throwable) {
                                                        errorMsg = t.message ?: "Revoca fallita."
                                                    }
                                                }
                                            },
                                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Text("Conferma revoca", fontSize = 12.sp, color = Color.White)
                                        }
                                        TextButton(onClick = { pendingRevokeId = null }) {
                                            Text("Annulla", fontSize = 12.sp)
                                        }
                                    } else {
                                        OutlinedButton(
                                            onClick = { pendingRevokeId = share.shareId },
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Icon(Icons.Default.Delete, contentDescription = null, tint = Color(0xFFF87171), modifier = Modifier.size(15.dp))
                                            Spacer(Modifier.width(6.dp))
                                            Text("Revoca", fontSize = 12.sp, color = Color(0xFFF87171))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Dialog for creating a single- or multi-item Zero-Knowledge E2EE Share Link.
 */
@Composable
fun ZkV2CreateShareDialog(
    itemsToShare: List<DecryptedZkItem>,
    repository: ZkVaultRepository,
    onDismiss: () -> Unit,
    onCreated: (ZkShareCreationResult) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var title by remember {
        mutableStateOf(
            if (itemsToShare.size == 1) itemsToShare.first().meta.name else "Condivisione (${itemsToShare.size} file)"
        )
    }
    var expiryHours by remember { mutableStateOf<Long?>(168L) } // 7 days default
    var maxDownloads by remember { mutableStateOf<Int?>(null) }
    var isCreating by remember { mutableStateOf(false) }
    var createdResult by remember { mutableStateOf<ZkShareCreationResult?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { if (!isCreating) onDismiss() },
        title = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Share, contentDescription = null, tint = Color(0xFF38BDF8))
                Text(if (createdResult == null) "Crea link E2EE (${itemsToShare.size})" else "Link E2EE pronto")
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (createdResult == null) {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        label = { Text("Titolo condivisione (cifrato)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("Scadenza", fontSize = 12.sp, color = Color(0xFF9CA3AF))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("Mai" to null, "24h" to 24L, "7g" to 168L, "30g" to 720L).forEach { (lbl, hrs) ->
                            val selected = expiryHours == hrs
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (selected) Color(0xFF0C4A6E) else Color(0xFF1F2937))
                                    .clickable { expiryHours = hrs }
                                    .padding(horizontal = 10.dp, vertical = 6.dp)
                            ) {
                                Text(lbl, fontSize = 12.sp, color = if (selected) Color.White else Color(0xFFD1D5DB))
                            }
                        }
                    }
                    Text("Limite download", fontSize = 12.sp, color = Color(0xFF9CA3AF))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("Illimitati" to null, "1" to 1, "5" to 5, "25" to 25).forEach { (lbl, lim) ->
                            val selected = maxDownloads == lim
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (selected) Color(0xFF0C4A6E) else Color(0xFF1F2937))
                                    .clickable { maxDownloads = lim }
                                    .padding(horizontal = 10.dp, vertical = 6.dp)
                            ) {
                                Text(lbl, fontSize = 12.sp, color = if (selected) Color.White else Color(0xFFD1D5DB))
                            }
                        }
                    }
                    if (errorMsg != null) {
                        Text(errorMsg!!, color = Color(0xFFF87171), fontSize = 12.sp)
                    }
                } else {
                    Text(
                        text = "La chiave di decifratura è inclusa solo dopo '#' e non viene mai inviata al server.",
                        fontSize = 12.sp,
                        color = Color(0xFF9CA3AF)
                    )
                    Text(
                        text = createdResult!!.shareUrlWithFragment,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = Color(0xFF38BDF8)
                    )
                    if (copied) {
                        Text("Link copiato negli appunti!", color = Color(0xFF34D399), fontSize = 12.sp)
                    }
                }
            }
        },
        confirmButton = {
            if (createdResult == null) {
                Button(
                    enabled = !isCreating && itemsToShare.isNotEmpty(),
                    onClick = {
                        scope.launch {
                            isCreating = true
                            errorMsg = null
                            try {
                                val exp = expiryHours?.let { System.currentTimeMillis() + it * 3600_000L }
                                val res = repository.createZeroKnowledgeShare(
                                    items = itemsToShare,
                                    title = title.trim(),
                                    expiresAtMs = exp,
                                    maxDownloads = maxDownloads
                                )
                                createdResult = res
                                onCreated(res)
                            } catch (t: Throwable) {
                                errorMsg = t.message ?: "Creazione condivisione fallita."
                            } finally {
                                isCreating = false
                            }
                        }
                    }
                ) {
                    if (isCreating) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Genera link")
                    }
                }
            } else {
                Button(onClick = {
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    cm?.setPrimaryClip(ClipData.newPlainText("PhotoCloud Share Link", createdResult!!.shareUrlWithFragment))
                    copied = true
                }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Copia link")
                }
            }
        },
        dismissButton = {
            TextButton(enabled = !isCreating, onClick = onDismiss) {
                Text(if (createdResult == null) "Annulla" else "Chiudi")
            }
        }
    )
}
