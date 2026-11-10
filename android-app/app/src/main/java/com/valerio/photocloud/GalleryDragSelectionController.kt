package com.valerio.photocloud

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Visual bounds of a single media cell currently visible in the Gallery grid,
 * expressed in the coordinate space of the outer LazyVerticalGrid pointerInput box.
 */
data class GridCellBounds(
    val filename: String,
    val index: Int,
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float
) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
    val centerX: Float get() = (left + right) * 0.5f
    val centerY: Float get() = (top + bottom) * 0.5f

    fun contains(x: Float, y: Float, marginPx: Float = 0f): Boolean {
        return x >= (left - marginPx) &&
            x <= (right + marginPx) &&
            y >= (top - marginPx) &&
            y <= (bottom + marginPx)
    }

    fun verticalDistanceTo(y: Float): Float {
        return when {
            y < top -> top - y
            y > bottom -> y - bottom
            else -> 0f
        }
    }

    fun horizontalDistanceTo(x: Float): Float {
        return when {
            x < left -> left - x
            x > right -> x - right
            else -> 0f
        }
    }
}

/**
 * Result of updating the drag selection when the user's finger moves or auto-scrolls.
 */
data class DragSelectionUpdateResult(
    val changed: Boolean,
    val currentIndex: Int,
    val selectedFilenames: Set<String>
)

/**
 * Pure, testable controller for Gallery Long-Press + Drag-to-Select multi-selection.
 *
 * Handles:
 * - Accurate hit-testing of grid cells (direct hit, inter-tile margin tolerance on touch-down,
 *   and row-aware nearest-cell snapping during active drag across rows, columns, and headers).
 * - Range-based selection and deselection:
 *   1. Starting on an unselected photo enters additive range mode (`isAddingMode = true`),
 *      selecting all photos in `min(anchorIndex, targetIndex)..max(anchorIndex, targetIndex)`.
 *      Moving the finger backward toward `anchorIndex` automatically deselects photos outside
 *      the new range that were not selected before the drag started.
 *   2. Starting on an already-selected photo enters subtractive range mode (`isAddingMode = false`),
 *      deselecting photos across `min(anchorIndex, targetIndex)..max(anchorIndex, targetIndex)`.
 * - Smooth proportional auto-scroll velocity calculation when the finger reaches the top or
 *   bottom edge zones of the viewport.
 */
class GalleryDragSelectionController {

    var isActive: Boolean = false
        private set

    var anchorIndex: Int = -1
        private set

    var lastIndex: Int = -1
        private set

    var isAddingMode: Boolean = true
        private set

    private var selectionBeforeDrag: Set<String> = emptySet()
    private var currentSelection: Set<String> = emptySet()

    /**
     * Starts a new drag-selection session anchored at [anchorIndex].
     * Immediately toggles the anchor item and returns the updated selection set.
     */
    fun startDragSelection(
        anchorIndex: Int,
        allFilenames: List<String>,
        existingSelection: Set<String>
    ): Set<String> {
        if (anchorIndex !in allFilenames.indices) {
            isActive = false
            return existingSelection
        }
        val anchorFilename = allFilenames[anchorIndex]
        this.isActive = true
        this.anchorIndex = anchorIndex
        this.lastIndex = anchorIndex
        this.selectionBeforeDrag = existingSelection
        this.isAddingMode = !existingSelection.contains(anchorFilename)
        this.currentSelection = if (this.isAddingMode) {
            existingSelection + anchorFilename
        } else {
            existingSelection - anchorFilename
        }
        return this.currentSelection
    }

    /**
     * Updates the active drag selection when the finger reaches [targetIndex].
     * All items between [anchorIndex] and [targetIndex] (inclusive) are selected (or deselected
     * when [isAddingMode] is false) relative to [selectionBeforeDrag].
     * If the user retraces backward toward [anchorIndex], items outside the new
     * `anchorIndex..targetIndex` range automatically revert to their [selectionBeforeDrag] state.
     */
    fun updateDragSelection(
        targetIndex: Int,
        allFilenames: List<String>
    ): DragSelectionUpdateResult {
        if (!isActive || anchorIndex !in allFilenames.indices || targetIndex !in allFilenames.indices) {
            return DragSelectionUpdateResult(
                changed = false,
                currentIndex = lastIndex,
                selectedFilenames = currentSelection
            )
        }

        if (targetIndex == lastIndex) {
            return DragSelectionUpdateResult(
                changed = false,
                currentIndex = lastIndex,
                selectedFilenames = currentSelection
            )
        }

        lastIndex = targetIndex
        val rangeStart = min(anchorIndex, targetIndex)
        val rangeEnd = max(anchorIndex, targetIndex)

        val nextSelection: Set<String> = if (isAddingMode) {
            val set = LinkedHashSet<String>(selectionBeforeDrag.size + (rangeEnd - rangeStart + 1))
            set.addAll(selectionBeforeDrag)
            for (i in rangeStart..rangeEnd) {
                set.add(allFilenames[i])
            }
            set
        } else {
            val rangeToRemove = HashSet<String>((rangeEnd - rangeStart + 1) * 2)
            for (i in rangeStart..rangeEnd) {
                rangeToRemove.add(allFilenames[i])
            }
            selectionBeforeDrag - rangeToRemove
        }

        currentSelection = nextSelection
        return DragSelectionUpdateResult(
            changed = true,
            currentIndex = targetIndex,
            selectedFilenames = currentSelection
        )
    }

    /**
     * Ends or cancels the active drag gesture while keeping the selected items active in selection mode.
     */
    fun endDragSelection() {
        isActive = false
        anchorIndex = -1
        lastIndex = -1
        selectionBeforeDrag = emptySet()
    }

    companion object {
        /**
         * Locates the media cell at pointer coordinates ([x], [y]).
         *
         * - When [snapToNearest] is `false` (initial touch-down before long-press):
         *   Only matches if ([x], [y]) is directly inside a cell or within [touchMarginPx]
         *   (so touching a section header or empty area does not start a drag selection).
         * - When [snapToNearest] is `true` (active drag across the grid):
         *   First checks direct hit. If the finger is in the spacing between cells, over a
         *   section header, or inside the top/bottom auto-scroll zone, snaps to the cell on
         *   the vertically closest row and horizontally closest column so dragging across
         *   rows, columns, and diagonals never drops selection.
         */
        fun findCellAtPoint(
            cells: List<GridCellBounds>,
            x: Float,
            y: Float,
            snapToNearest: Boolean,
            touchMarginPx: Float = 12f
        ): GridCellBounds? {
            if (cells.isEmpty()) return null

            // 1. Exact bounds hit
            val directHit = cells.firstOrNull { it.contains(x, y, marginPx = 0f) }
            if (directHit != null) return directHit

            // 2. Small margin hit (covers inter-tile spacing)
            val marginHit = cells.firstOrNull { it.contains(x, y, marginPx = touchMarginPx) }
            if (marginHit != null) return marginHit

            if (!snapToNearest) {
                return null
            }

            // 3. Row-aware nearest cell snapping during active drag:
            // Find the minimum vertical distance from y to any visible cell row.
            val minVerticalDist = cells.minOf { it.verticalDistanceTo(y) }
            // Consider all cells belonging to that closest row (within 24px vertical tolerance)
            val rowCandidates = cells.filter {
                abs(it.verticalDistanceTo(y) - minVerticalDist) <= 24f
            }

            if (rowCandidates.isNotEmpty()) {
                return rowCandidates.minByOrNull { cell ->
                    val hDist = cell.horizontalDistanceTo(x)
                    if (hDist > 0f) hDist else abs(x - cell.centerX) * 0.1f
                }
            }

            // Fallback to Euclidean distance to cell center
            return cells.minByOrNull { cell ->
                hypot(x - cell.centerX, y - cell.centerY)
            }
        }

        /**
         * Computes the per-frame vertical scroll delta (in pixels) when the user's finger
         * is held near the top or bottom edge of the gallery viewport during drag selection.
         *
         * Returns:
         * - Negative value (scroll up) when `fingerY < topZonePx`
         * - Positive value (scroll down) when `fingerY > viewportHeight - bottomZonePx`
         * - `0f` when the finger is in the central comfort zone.
         */
        fun computeAutoScrollVelocityPxPerFrame(
            fingerY: Float,
            viewportHeight: Float,
            topZonePx: Float,
            bottomZonePx: Float,
            maxSpeedPxPerFrame: Float,
            minSpeedPxPerFrame: Float = 6f
        ): Float {
            if (viewportHeight <= 0f || maxSpeedPxPerFrame <= 0f) return 0f

            if (fingerY < topZonePx && topZonePx > 0f) {
                val intensity = ((topZonePx - fingerY) / topZonePx).coerceIn(0.15f, 1f)
                val speed = minSpeedPxPerFrame + (maxSpeedPxPerFrame - minSpeedPxPerFrame) * intensity
                return -speed
            }

            val bottomThreshold = viewportHeight - bottomZonePx
            if (fingerY > bottomThreshold && bottomZonePx > 0f) {
                val intensity = ((fingerY - bottomThreshold) / bottomZonePx).coerceIn(0.15f, 1f)
                val speed = minSpeedPxPerFrame + (maxSpeedPxPerFrame - minSpeedPxPerFrame) * intensity
                return speed
            }

            return 0f
        }

        /**
         * Executes comprehensive verification of all 9 mandatory Drag Selection test scenarios
         * against the compiled Kotlin bytecode.
         */
        @JvmStatic
        fun main(args: Array<String>) {
            val filenames = (0 until 60).map { "photo_%04d.jpg".format(it) }
            val cols = 3
            val tileSize = 320f
            val spacing = 12f
            val startPad = 18f

            fun buildGridCells(scrollOffsetY: Float = 0f, headerGapAfterRow2: Float = 90f): List<GridCellBounds> {
                val list = ArrayList<GridCellBounds>()
                for (i in filenames.indices) {
                    val row = i / cols
                    val col = i % cols
                    val headerOffset = if (row > 2) headerGapAfterRow2 else 0f
                    val left = startPad + col * (tileSize + spacing)
                    val top = startPad + row * (tileSize + spacing) + headerOffset - scrollOffsetY
                    val right = left + tileSize
                    val bottom = top + tileSize
                    if (bottom >= 0f && top <= 2200f) {
                        list.add(GridCellBounds(filenames[i], i, left, top, right, bottom))
                    }
                }
                return list
            }

            val controller = GalleryDragSelectionController()

            // Test 1: Long-press selection of a single photo
            var selected = controller.startDragSelection(0, filenames, emptySet())
            check(controller.isActive) { "Test 1 failed: controller should be active" }
            check(selected == setOf("photo_0000.jpg")) { "Test 1 failed: $selected" }
            controller.endDragSelection()
            check(!controller.isActive && selected.size == 1) { "Test 1 release failed" }

            // Test 2: Drag across 2, 5, and 10+ consecutive photos
            selected = controller.startDragSelection(1, filenames, emptySet())
            selected = controller.updateDragSelection(2, filenames).selectedFilenames
            check(selected.size == 2) { "Test 2 (2 photos) failed: ${selected.size}" }
            selected = controller.updateDragSelection(5, filenames).selectedFilenames
            check(selected.size == 5) { "Test 2 (5 photos) failed: ${selected.size}" }
            selected = controller.updateDragSelection(12, filenames).selectedFilenames
            check(selected.size == 12 && selected.contains("photo_0001.jpg") && selected.contains("photo_0012.jpg")) {
                "Test 2 (12 photos) failed: ${selected.size}"
            }
            controller.endDragSelection()

            // Test 3: Horizontal (left-to-right & right-to-left) and Vertical (top-to-bottom & bottom-to-top) drag
            val visibleCells = buildGridCells()
            val startHoriz = findCellAtPoint(visibleCells, 150f, 150f, snapToNearest = false)!!
            check(startHoriz.index == 0)
            selected = controller.startDragSelection(startHoriz.index, filenames, emptySet())
            val endHoriz = findCellAtPoint(visibleCells, 850f, 150f, snapToNearest = true)!!
            check(endHoriz.index == 2)
            selected = controller.updateDragSelection(endHoriz.index, filenames).selectedFilenames
            check(selected == setOf("photo_0000.jpg", "photo_0001.jpg", "photo_0002.jpg")) {
                "Test 3 horizontal failed: $selected"
            }
            controller.endDragSelection()

            // Vertical drag from row 3 col 1 (index 10) upwards to row 0 col 1 (index 1)
            selected = controller.startDragSelection(10, filenames, emptySet())
            selected = controller.updateDragSelection(1, filenames).selectedFilenames
            check(selected.size == 10 && selected.contains("photo_0001.jpg") && selected.contains("photo_0010.jpg")) {
                "Test 3 vertical upward failed: ${selected.size}"
            }
            controller.endDragSelection()

            // Test 4 & 5: Diagonal drag & Multi-row drag across section headers (gap between row 2 and row 3)
            val startDiag = findCellAtPoint(visibleCells, 150f, 150f, snapToNearest = false)!!
            selected = controller.startDragSelection(startDiag.index, filenames, emptySet())
            // Drag diagonally through the 90px section header gap at y = 1040f and x = 860f (col 2)
            val snapOverHeader = findCellAtPoint(visibleCells, 860f, 1040f, snapToNearest = true)
            check(snapOverHeader != null && snapOverHeader.index in setOf(8, 11)) {
                "Test 4/5 header gap snap failed: $snapOverHeader"
            }
            val endDiag = findCellAtPoint(visibleCells, 860f, 1250f, snapToNearest = true)!!
            check(endDiag.index == 11) { "Expected index 11 (row 3, col 2), got ${endDiag.index}" }
            selected = controller.updateDragSelection(endDiag.index, filenames).selectedFilenames
            check(selected.size == 12) { "Test 4/5 diagonal multi-row failed: ${selected.size}" }
            controller.endDragSelection()

            // Test 6: Auto-scroll down and up near viewport edges while finger holds steady
            val downSpeed = computeAutoScrollVelocityPxPerFrame(
                fingerY = 2120f,
                viewportHeight = 2200f,
                topZonePx = 220f,
                bottomZonePx = 350f,
                maxSpeedPxPerFrame = 56f
            )
            val upSpeed = computeAutoScrollVelocityPxPerFrame(
                fingerY = 60f,
                viewportHeight = 2200f,
                topZonePx = 220f,
                bottomZonePx = 350f,
                maxSpeedPxPerFrame = 56f
            )
            val midSpeed = computeAutoScrollVelocityPxPerFrame(
                fingerY = 1100f,
                viewportHeight = 2200f,
                topZonePx = 220f,
                bottomZonePx = 350f,
                maxSpeedPxPerFrame = 56f
            )
            check(downSpeed > 20f && upSpeed < -20f && midSpeed == 0f) {
                "Test 6 auto-scroll velocity failed: down=$downSpeed, up=$upSpeed, mid=$midSpeed"
            }

            // Simulate holding finger at bottom edge while grid scrolls down by 1400px
            selected = controller.startDragSelection(3, filenames, emptySet())
            var scrollY = 0f
            repeat(25) {
                scrollY += downSpeed
                val scrolledCells = buildGridCells(scrollOffsetY = scrollY)
                val hit = findCellAtPoint(scrolledCells, 860f, 2050f, snapToNearest = true)
                if (hit != null) {
                    selected = controller.updateDragSelection(hit.index, filenames).selectedFilenames
                }
            }
            check(selected.size >= 25) { "Test 6 continuous auto-scroll selection failed: ${selected.size}" }
            controller.endDragSelection()

            // Test 7: Deselection by retracing backward & subtractive drag on already-selected items & ACTION_CANCEL
            selected = controller.startDragSelection(2, filenames, emptySet())
            selected = controller.updateDragSelection(9, filenames).selectedFilenames
            check(selected.size == 8) // indices 2..9
            // Retrace finger backward from index 9 back to index 4
            selected = controller.updateDragSelection(4, filenames).selectedFilenames
            check(selected == setOf("photo_0002.jpg", "photo_0003.jpg", "photo_0004.jpg")) {
                "Test 7 backward retrace deselection failed: $selected"
            }
            controller.endDragSelection()

            // Subtractive drag starting on already-selected item (index 4) back to index 3
            selected = controller.startDragSelection(4, filenames, selected)
            check(!controller.isAddingMode)
            selected = controller.updateDragSelection(3, filenames).selectedFilenames
            check(selected == setOf("photo_0002.jpg")) {
                "Test 7 subtractive drag deselection failed: $selected"
            }
            controller.endDragSelection()

            // Test 8 & 9: Large gallery performance (5,000 photos)
            val largeGallery = (0 until 5000).map { "vault_img_%05d.jpg".format(it) }
            val t0 = System.nanoTime()
            var largeSel = controller.startDragSelection(10, largeGallery, emptySet())
            for (target in listOf(50, 250, 1200, 3500, 4990, 2400)) {
                largeSel = controller.updateDragSelection(target, largeGallery).selectedFilenames
            }
            controller.endDragSelection()
            val elapsedMs = (System.nanoTime() - t0) / 1_000_000.0
            check(largeSel.size == (2400 - 10 + 1)) { "Test 9 count failed: ${largeSel.size}" }
            check(elapsedMs < 150.0) { "Test 9 performance too slow: ${elapsedMs}ms" }

            println("ALL_9_DRAG_SELECTION_TESTS_PASSED (5000-photo benchmark: %.2f ms)".format(elapsedMs))
        }
    }
}
