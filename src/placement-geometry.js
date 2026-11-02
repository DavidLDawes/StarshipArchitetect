/**
 * Starship Architect - Placement Geometry Module
 *
 * Shape and count helpers for placements, plus free-space analysis used by the
 * bulk-allocation features ("block of N", "fill rest of floor", "fill region").
 *
 * Placement entries (shipData.componentPlacements[i].floors[k]) look like:
 *   { floor, x, y, length, width }                 a single rectangle holding 1 item
 *   { floor, x, y, length, width, count }          a rectangle holding `count` items
 *   { floor, x, y, length, width, count, rects }   an odd-shaped region made of
 *                                                  several rectangles; x/y/length/width
 *                                                  are its bounding box
 *
 * Free space is computed on a coordinate-compressed grid: every armor edge and
 * component edge on the floor becomes a grid line, so each grid cell is either
 * entirely occupied or entirely free. Connected free cells form regions.
 */

// ========================================
// Constants
// ========================================

/** Tolerance used when comparing coordinates (meters) */
const GEOM_EPS = 1e-6;

/**
 * Free cells must share an edge at least this long (meters) to count as connected.
 * This stops a hairline gap between two components from joining otherwise
 * separate free regions into one.
 */
const MIN_PASSAGE = 0.5;

// ========================================
// Placement Shape / Count Helpers
// ========================================

/**
 * Get the rectangles that make up a placement entry
 * @param {object} pos - Placement entry ({floor, x, y, length, width, rects?})
 * @param {object} placement - Parent placement (for legacy component-level dimensions)
 * @returns {Array<{x, y, length, width}>} Rectangles in absolute floor coordinates
 */
function getPlacementRects(pos, placement) {
    if (pos.rects && pos.rects.length > 0) {
        return pos.rects;
    }
    return [{
        x: pos.x,
        y: pos.y,
        length: pos.length || (placement && placement.length),
        width: pos.width || (placement && placement.width)
    }];
}

/**
 * Number of items held by a single placement entry
 * @param {object} pos - Placement entry
 * @returns {number} Item count (defaults to 1)
 */
function getPlacementCount(pos) {
    return pos && pos.count > 0 ? pos.count : 1;
}

/**
 * Total number of items placed for a component
 * @param {object} placement - shipData.componentPlacements[i]
 * @returns {number} Sum of item counts across all entries
 */
function getPlacedCount(placement) {
    if (!placement || !placement.floors) return 0;
    return placement.floors.reduce((sum, pos) => sum + getPlacementCount(pos), 0);
}

/**
 * Item counts placed on each floor for a component
 * @param {object} placement - shipData.componentPlacements[i]
 * @returns {Object<number, number>} { floorNumber: count }
 */
function getPlacedCountByFloor(placement) {
    const byFloor = {};
    if (!placement || !placement.floors) return byFloor;
    for (const pos of placement.floors) {
        byFloor[pos.floor] = (byFloor[pos.floor] || 0) + getPlacementCount(pos);
    }
    return byFloor;
}

/**
 * Bounding box of a list of rectangles
 * @param {Array<{x, y, length, width}>} rects
 * @returns {{x, y, length, width}|null}
 */
function getBoundingBox(rects) {
    if (!rects || rects.length === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.length);
        y1 = Math.max(y1, r.y + r.width);
    }
    return { x: x0, y: y0, length: x1 - x0, width: y1 - y0 };
}

/**
 * Total area of a list of non-overlapping rectangles
 * @param {Array<{length, width}>} rects
 * @returns {number} Area in m²
 */
function sumRectArea(rects) {
    return rects.reduce((sum, r) => sum + r.length * r.width, 0);
}

/**
 * All occupied rectangles on a floor
 * @param {number} floorIndex - Floor number (1-based)
 * @param {object} placements - Defaults to shipData.componentPlacements
 * @returns {Array<{x, y, length, width}>}
 */
function getOccupiedRects(floorIndex, placements = shipData.componentPlacements) {
    const rects = [];
    for (const placement of Object.values(placements)) {
        if (!placement || !placement.floors) continue;
        for (const pos of placement.floors) {
            if (pos.floor !== floorIndex) continue;
            rects.push(...getPlacementRects(pos, placement));
        }
    }
    return rects;
}

// ========================================
// Free-Space Analysis
// ========================================

/**
 * Sort numbers and collapse values that are within GEOM_EPS of each other
 * @param {number[]} values
 * @returns {number[]}
 */
function uniqueSorted(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const out = [];
    for (const v of sorted) {
        if (out.length === 0 || v - out[out.length - 1] > GEOM_EPS) {
            out.push(v);
        }
    }
    return out;
}

/**
 * Index of the first grid line >= value (within tolerance)
 * @param {number[]} lines - Sorted grid lines
 * @param {number} value
 * @returns {number}
 */
function lowerBound(lines, value) {
    let lo = 0;
    let hi = lines.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid] < value - GEOM_EPS) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Analyze the free space inside a bounding area
 * @param {{x0, y0, x1, y1}} bounds - Usable area (inside the armor)
 * @param {Array<{x, y, length, width}>} occupied - Occupied rectangles
 * @returns {object} { xs, ys, cellRegion, regions } where each region is
 *   { index, cells: [{x, y, length, width}], area, rects, bbox }
 */
function analyzeFreeSpace(bounds, occupied) {
    const { x0, y0, x1, y1 } = bounds;
    const clampX = v => Math.max(x0, Math.min(x1, v));
    const clampY = v => Math.max(y0, Math.min(y1, v));

    const xVals = [x0, x1];
    const yVals = [y0, y1];
    for (const r of occupied) {
        xVals.push(clampX(r.x), clampX(r.x + r.length));
        yVals.push(clampY(r.y), clampY(r.y + r.width));
    }
    const xs = uniqueSorted(xVals);
    const ys = uniqueSorted(yVals);
    const cols = Math.max(0, xs.length - 1);
    const rows = Math.max(0, ys.length - 1);

    // Mark occupied cells (index = col * rows + row)
    const occupiedGrid = new Uint8Array(cols * rows);
    for (const r of occupied) {
        const ia = lowerBound(xs, clampX(r.x));
        const ib = lowerBound(xs, clampX(r.x + r.length));
        const ja = lowerBound(ys, clampY(r.y));
        const jb = lowerBound(ys, clampY(r.y + r.width));
        for (let i = ia; i < ib; i++) {
            for (let j = ja; j < jb; j++) {
                occupiedGrid[i * rows + j] = 1;
            }
        }
    }

    const colWidth = i => xs[i + 1] - xs[i];
    const rowHeight = j => ys[j + 1] - ys[j];
    const isFree = (i, j) => i >= 0 && i < cols && j >= 0 && j < rows && !occupiedGrid[i * rows + j];
    const isTiny = (i, j) => colWidth(i) < MIN_PASSAGE && rowHeight(j) < MIN_PASSAGE;

    // Flood fill non-tiny free cells, connecting only through edges >= MIN_PASSAGE
    const cellRegion = new Int32Array(cols * rows).fill(-1);
    const regionCells = [];
    for (let si = 0; si < cols; si++) {
        for (let sj = 0; sj < rows; sj++) {
            if (!isFree(si, sj) || isTiny(si, sj) || cellRegion[si * rows + sj] !== -1) continue;

            const regionIndex = regionCells.length;
            const cells = [];
            const stack = [[si, sj]];
            cellRegion[si * rows + sj] = regionIndex;

            while (stack.length > 0) {
                const [i, j] = stack.pop();
                cells.push([i, j]);
                const neighbors = [
                    [i - 1, j, rowHeight(j)],
                    [i + 1, j, rowHeight(j)],
                    [i, j - 1, colWidth(i)],
                    [i, j + 1, colWidth(i)]
                ];
                for (const [ni, nj, shared] of neighbors) {
                    if (shared < MIN_PASSAGE) continue;
                    if (!isFree(ni, nj) || isTiny(ni, nj)) continue;
                    if (cellRegion[ni * rows + nj] !== -1) continue;
                    cellRegion[ni * rows + nj] = regionIndex;
                    stack.push([ni, nj]);
                }
            }
            regionCells.push(cells);
        }
    }

    // Absorb tiny free cells (where thin rows and columns cross) into a
    // neighboring region so filled regions don't leave pinhole gaps behind.
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            if (!isFree(i, j) || !isTiny(i, j)) continue;
            const neighbors = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
            for (const [ni, nj] of neighbors) {
                if (!isFree(ni, nj) || isTiny(ni, nj)) continue;
                const r = cellRegion[ni * rows + nj];
                if (r !== -1) {
                    cellRegion[i * rows + j] = r;
                    regionCells[r].push([i, j]);
                    break;
                }
            }
        }
    }

    const regions = regionCells.map((cellIdx, index) => {
        const cells = cellIdx.map(([i, j]) => ({
            x: xs[i], y: ys[j], length: colWidth(i), width: rowHeight(j)
        }));
        const rects = mergeCellsToRects(cells);
        return {
            index,
            cells,
            area: sumRectArea(cells),
            rects,
            bbox: getBoundingBox(rects)
        };
    });

    return { xs, ys, rows, cols, cellRegion, regions };
}

/**
 * Analyze free space on one floor using current ship state
 * @param {number} floorIndex - Floor number (1-based)
 * @param {number} floorLength - Floor length in meters
 * @param {number} floorWidth - Floor width in meters
 * @param {number} armorThickness - Armor thickness in meters
 * @param {object} placements - Defaults to shipData.componentPlacements
 * @returns {object} Result of analyzeFreeSpace
 */
function analyzeFloorFreeSpace(floorIndex, floorLength, floorWidth, armorThickness = 0, placements = shipData.componentPlacements) {
    const bounds = {
        x0: armorThickness,
        y0: armorThickness,
        x1: Math.max(armorThickness, floorLength - armorThickness),
        y1: Math.max(armorThickness, floorWidth - armorThickness)
    };
    return analyzeFreeSpace(bounds, getOccupiedRects(floorIndex, placements));
}

/**
 * Find the free region containing a point
 * @param {object} analysis - Result of analyzeFreeSpace
 * @param {number} x - X in meters
 * @param {number} y - Y in meters
 * @returns {object|null} Region, or null if the point is occupied or outside
 */
function findRegionAtPoint(analysis, x, y) {
    const { xs, ys, rows, cols, cellRegion, regions } = analysis;
    if (cols === 0 || rows === 0) return null;
    if (x < xs[0] || x > xs[cols] || y < ys[0] || y > ys[rows]) return null;

    // Last grid line <= point gives the cell index
    const i = Math.min(cols - 1, Math.max(0, lowerBound(xs, x + GEOM_EPS) - 1));
    const j = Math.min(rows - 1, Math.max(0, lowerBound(ys, y + GEOM_EPS) - 1));
    const r = cellRegion[i * rows + j];
    return r === -1 ? null : regions[r];
}

// ========================================
// Rectangle Merging and Area Sweeping
// ========================================

/**
 * Merge grid cells into a smaller set of covering rectangles
 * Cells in the same column are merged vertically into strips, then strips with
 * identical vertical extent in adjacent columns are merged horizontally.
 * @param {Array<{x, y, length, width}>} cells - Non-overlapping cells
 * @returns {Array<{x, y, length, width}>}
 */
function mergeCellsToRects(cells) {
    if (cells.length === 0) return [];

    // Group by column (x + length)
    const columns = new Map();
    for (const c of cells) {
        const key = `${c.x.toFixed(6)}|${c.length.toFixed(6)}`;
        if (!columns.has(key)) columns.set(key, { x: c.x, length: c.length, cells: [] });
        columns.get(key).cells.push(c);
    }

    // Vertical merge within each column
    const strips = [];
    for (const col of columns.values()) {
        col.cells.sort((a, b) => a.y - b.y);
        let current = null;
        for (const c of col.cells) {
            if (current && Math.abs(current.y + current.width - c.y) <= GEOM_EPS) {
                current.width = c.y + c.width - current.y;
            } else {
                current = { x: col.x, y: c.y, length: col.length, width: c.width };
                strips.push(current);
            }
        }
    }

    // Horizontal merge of strips with identical vertical extent
    strips.sort((a, b) => a.x - b.x || a.y - b.y);
    const open = new Map(); // "y|width" -> rect whose right edge may extend
    const result = [];
    for (const s of strips) {
        const key = `${s.y.toFixed(6)}|${s.width.toFixed(6)}`;
        const prev = open.get(key);
        if (prev && Math.abs(prev.x + prev.length - s.x) <= GEOM_EPS) {
            prev.length = s.x + s.length - prev.x;
        } else {
            const rect = { ...s };
            result.push(rect);
            open.set(key, rect);
        }
    }
    return result;
}

/**
 * Take a target area from a set of cells by sweeping in from one side.
 * Whole bands (columns for left/right, rows for top/bottom) are taken until the
 * last band, which is cut to the exact size needed. The result is the compact
 * part of the free space nearest the starting side.
 * @param {Array<{x, y, length, width}>} cells
 * @param {number} targetArea - Area to take in m²
 * @param {string} direction - Side to start from: 'left' (low x), 'right' (high x),
 *   'top' (low y), or 'bottom' (high y)
 * @returns {Array<{x, y, length, width}>} Chosen cells (last band trimmed)
 */
function takeAreaFromCells(cells, targetArea, direction = 'left') {
    const horizontal = direction === 'left' || direction === 'right';
    const fromEnd = direction === 'right' || direction === 'bottom';
    const start = c => (horizontal ? c.x : c.y);
    const size = c => (horizontal ? c.length : c.width);
    const cross = c => (horizontal ? c.width : c.length);

    const bands = new Map();
    for (const c of cells) {
        const key = start(c).toFixed(6);
        if (!bands.has(key)) bands.set(key, { start: start(c), size: size(c), cells: [] });
        bands.get(key).cells.push(c);
    }
    const sorted = [...bands.values()].sort((a, b) => a.start - b.start);
    if (fromEnd) sorted.reverse();

    // Trim a cell to `cut` along the sweep axis, keeping the side swept from
    const trim = (c, cut) => {
        if (direction === 'left') return { ...c, length: cut };
        if (direction === 'right') return { ...c, x: c.x + c.length - cut, length: cut };
        if (direction === 'top') return { ...c, width: cut };
        return { ...c, y: c.y + c.width - cut, width: cut };
    };

    const chosen = [];
    let taken = 0;
    for (const band of sorted) {
        if (taken >= targetArea - GEOM_EPS) break;
        const crossSize = band.cells.reduce((sum, c) => sum + cross(c), 0);
        const bandArea = band.size * crossSize;
        if (taken + bandArea <= targetArea + GEOM_EPS) {
            chosen.push(...band.cells.map(c => ({ ...c })));
            taken += bandArea;
        } else {
            const cut = (targetArea - taken) / crossSize;
            chosen.push(...band.cells.map(c => trim(c, cut)));
            taken = targetArea;
        }
    }
    return chosen;
}

/**
 * Side of a bounding box closest to a point, used to pack a partial region
 * allocation next to where the user clicked
 * @param {{x, y, length, width}} bbox
 * @param {number} x
 * @param {number} y
 * @returns {string} 'left' | 'right' | 'top' | 'bottom'
 */
function nearestSweepDirection(bbox, x, y) {
    const distances = [
        ['left', x - bbox.x],
        ['right', bbox.x + bbox.length - x],
        ['top', y - bbox.y],
        ['bottom', bbox.y + bbox.width - y]
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
}

// ========================================
// Allocation Planning
// ========================================

/**
 * Plan how many items go into one free region and which part of it they use.
 * - If the region holds every remaining item, only the needed area is used,
 *   packed in from the `direction` side of the region.
 * - Otherwise the whole region is consumed and holds floor(area / itemArea) items.
 * @param {object} region - Region from analyzeFreeSpace
 * @param {number} itemArea - Area of one item in m²
 * @param {number} remaining - Items still to be placed
 * @param {string} direction - Side to pack from (see takeAreaFromCells)
 * @returns {object|null} { count, rects, area, bbox, regionArea } or null if nothing fits
 */
function planRegionAllocation(region, itemArea, remaining, direction = 'left') {
    if (!region || itemArea <= 0 || remaining <= 0) return null;

    const neededArea = remaining * itemArea;
    let count;
    let rects;
    if (region.area >= neededArea - GEOM_EPS) {
        count = remaining;
        rects = region.area - neededArea > GEOM_EPS
            ? mergeCellsToRects(takeAreaFromCells(region.cells, neededArea, direction))
            : region.rects.map(r => ({ ...r }));
    } else {
        count = Math.floor((region.area + GEOM_EPS) / itemArea);
        rects = region.rects.map(r => ({ ...r }));
    }
    if (count <= 0) return null;

    return {
        count,
        rects,
        area: sumRectArea(rects),
        bbox: getBoundingBox(rects),
        regionArea: region.area
    };
}

/**
 * Plan filling the free space on a floor.
 * - If one region can hold every remaining item, the smallest such region is used
 *   (best fit), leaving larger open areas available for other components.
 * - Otherwise regions are filled largest first until items run out.
 * Regions too small for a single item are left alone.
 * @param {Array<object>} regions - Regions from analyzeFreeSpace
 * @param {number} itemArea - Area of one item in m²
 * @param {number} remaining - Items still to be placed
 * @returns {Array<object>} Allocations from planRegionAllocation
 */
function planFloorFill(regions, itemArea, remaining) {
    if (itemArea <= 0 || remaining <= 0) return [];

    const usable = regions.filter(r => r.area + GEOM_EPS >= itemArea);
    if (usable.length === 0) return [];

    const neededArea = remaining * itemArea;
    const bestFit = usable
        .filter(r => r.area >= neededArea - GEOM_EPS)
        .sort((a, b) => a.area - b.area)[0];
    if (bestFit) {
        return [planRegionAllocation(bestFit, itemArea, remaining)];
    }

    const allocations = [];
    let left = remaining;
    for (const region of usable.slice().sort((a, b) => b.area - a.area)) {
        if (left <= 0) break;
        const plan = planRegionAllocation(region, itemArea, left);
        if (plan) {
            allocations.push(plan);
            left -= plan.count;
        }
    }
    return allocations;
}

/**
 * Summarize free space for display
 * @param {Array<object>} regions - Regions from analyzeFreeSpace
 * @param {number} itemArea - Area of one item in m²
 * @returns {{freeArea, regionCount, fits}} Total free area, regions that hold
 *   at least one item, and how many items fit in total
 */
function summarizeFreeSpace(regions, itemArea) {
    let freeArea = 0;
    let regionCount = 0;
    let fits = 0;
    for (const r of regions) {
        freeArea += r.area;
        const n = itemArea > 0 ? Math.floor((r.area + GEOM_EPS) / itemArea) : 0;
        if (n > 0) {
            regionCount++;
            fits += n;
        }
    }
    return { freeArea, regionCount, fits };
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        GEOM_EPS,
        MIN_PASSAGE,
        getPlacementRects,
        getPlacementCount,
        getPlacedCount,
        getPlacedCountByFloor,
        getBoundingBox,
        sumRectArea,
        getOccupiedRects,
        analyzeFreeSpace,
        analyzeFloorFreeSpace,
        findRegionAtPoint,
        mergeCellsToRects,
        takeAreaFromCells,
        nearestSweepDirection,
        planRegionAllocation,
        planFloorFill,
        summarizeFreeSpace
    };
}
