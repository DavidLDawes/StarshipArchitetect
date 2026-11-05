/**
 * Starship Architect - Placement Logic Module
 * Handles overlap detection, position finding, and placement management
 */

// ========================================
// Armor Boundary Checking
// ========================================

/**
 * Fit tolerance in meters. Size presets can exactly fill the usable area, and
 * armor + (floorLength - 2 * armor) can drift past floorLength - armor by ~1e-15
 * in floating point; without a tolerance an exact fit is rejected as too big.
 */
const USABLE_AREA_EPS = 1e-6;

/**
 * Check if a placement is within the usable area (respecting armor boundary)
 * @param {number} x - X position in meters
 * @param {number} y - Y position in meters
 * @param {number} length - Component length in meters
 * @param {number} width - Component width in meters
 * @param {number} floorLength - Floor length in meters
 * @param {number} floorWidth - Floor width in meters
 * @param {number} armorThickness - Armor thickness in meters (defaults to shipData.armorThickness)
 * @returns {boolean} True if placement is within usable area
 */
function isWithinUsableArea(x, y, length, width, floorLength, floorWidth, armorThickness = shipData.armorThickness) {
    // Check if component is fully inside the armor boundary
    return x >= armorThickness - USABLE_AREA_EPS &&
           y >= armorThickness - USABLE_AREA_EPS &&
           x + length <= floorLength - armorThickness + USABLE_AREA_EPS &&
           y + width <= floorWidth - armorThickness + USABLE_AREA_EPS;
}

/**
 * Check if a placement fits on a floor, following the current ship's hull shape
 * @param {number|number[]} floors - Floor number, or the floors a component spans
 * @returns {boolean} True if the whole rectangle is inside the usable space
 */
function fitsFloor(floors, x, y, length, width, floorLength, floorWidth, armorThickness = shipData.armorThickness) {
    const inner = getShapedInner(floors);
    if (!inner) return isWithinUsableArea(x, y, length, width, floorLength, floorWidth, armorThickness);
    return isRectInConvexPolygon(inner, x, y, length, width);
}

/**
 * Move a rectangle to the nearest position inside the usable space of a floor.
 * On a shaped hull, a rectangle too big for the floor comes back where it was.
 * @param {number|number[]} floors - Floor number, or the floors a component spans
 * @returns {{x, y}}
 */
function clampToFloor(floors, x, y, length, width, floorLength, floorWidth, armorThickness = shipData.armorThickness) {
    const inner = getShapedInner(floors);
    if (!inner) {
        return {
            x: Math.max(armorThickness, Math.min(x, floorLength - length - armorThickness)),
            y: Math.max(armorThickness, Math.min(y, floorWidth - width - armorThickness))
        };
    }
    return closestPointInConvexPolygon(getRectFitRegion(inner, length, width), x, y) || { x, y };
}

// ========================================
// Overlap Detection
// ========================================

/**
 * Overlap tolerance in meters. Region allocations share edges exactly with their
 * neighbors, and x + length can drift by ~1e-15 in floating point; without a
 * tolerance, touching shapes would be reported as overlapping.
 */
const OVERLAP_EPS = 1e-6;

/**
 * Check if a placement overlaps with existing components
 * @param {number} excludeComponentIndex - Set to -1 to check all, or a specific index to exclude
 */
function checkOverlap(floorIndex, x, y, length, width, excludeComponentIndex = -1) {
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        const compIdx = parseInt(compIdxStr);
        // Only skip if explicitly excluding this specific component (used for repositioning)
        if (excludeComponentIndex >= 0 && compIdx === excludeComponentIndex) continue;

        if (!placement.floors) continue;

        for (const pos of placement.floors) {
            if (pos.floor !== floorIndex) continue;

            // A placement may be a single rectangle or an odd-shaped set of rectangles
            for (const r of getPlacementRects(pos, placement)) {
                const overlap = !(x + length <= r.x + OVERLAP_EPS ||
                    r.x + r.length <= x + OVERLAP_EPS ||
                    y + width <= r.y + OVERLAP_EPS ||
                    r.y + r.width <= y + OVERLAP_EPS);

                if (overlap) return true;
            }
        }
    }
    return false;
}

// ========================================
// Position Finding
// ========================================

/**
 * Rectangles of other components on a floor
 * @returns {Array<{x, y, length, width}>}
 */
function getObstacleRects(floorIndex, excludeComponentIndex) {
    const rects = [];
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        if (parseInt(compIdxStr) === excludeComponentIndex || !placement.floors) continue;
        for (const pos of placement.floors) {
            if (pos.floor === floorIndex) rects.push(...getPlacementRects(pos, placement));
        }
    }
    return rects;
}

/**
 * findValidPosition for a shaped hull. Works from every position where the
 * rectangle fits (getRectFitRegion), so anything taken from that region is
 * inside the hull and anything on its boundary is against the hull.
 * @param {Array<[number, number]>} inner - Usable space of the floor
 * @returns {object|null} {x, y} if valid position found, null otherwise
 */
function findValidPositionInHull(inner, floorIndex, origX, origY, compLength, compWidth, excludeComponentIndex, requireHull) {
    const isFree = (x, y) => !checkOverlap(floorIndex, x, y, compLength, compWidth, excludeComponentIndex);

    if (isRectInConvexPolygon(inner, origX, origY, compLength, compWidth) &&
        (!requireHull || isRectOnConvexPolygonWall(inner, origX, origY, compLength, compWidth)) &&
        isFree(origX, origY)) {
        return { x: origX, y: origY };
    }

    const region = getRectFitRegion(inner, compLength, compWidth);
    if (region.length === 0) return null;
    const settle = (x, y) => (requireHull
        ? closestPointOnPolygonBoundary(region, x, y)
        : closestPointInConvexPolygon(region, x, y));

    // Try alongside each obstacle, and where those lines meet the edge of the region
    const candidates = [settle(origX, origY)];
    for (const r of getObstacleRects(floorIndex, excludeComponentIndex)) {
        const xs = [r.x + r.length, r.x - compLength];
        const ys = [r.y + r.width, r.y - compWidth];
        for (const x of xs) {
            candidates.push(settle(x, origY), ...getPolygonCrossings(region, 'x', x));
            for (const y of ys) candidates.push(settle(x, y));
        }
        for (const y of ys) {
            candidates.push(settle(origX, y), ...getPolygonCrossings(region, 'y', y));
        }
    }
    for (const [x, y] of region) candidates.push({ x, y });

    let best = null;
    let bestDistance = Infinity;
    for (const c of candidates) {
        const distance = Math.hypot(c.x - origX, c.y - origY);
        if (distance < bestDistance && isFree(c.x, c.y)) {
            best = c;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * Find a valid position for a component, adjusting if there's overlap
 * @param {boolean} requireHull - Component must lie against the outer hull
 *   (weapons, vehicles, launch bays); candidates then slide along the hull
 * @param {number|number[]} fitFloors - Floors the position has to fit and touch the
 *   hull of, when the component spans several; overlap is only checked on floorIndex
 * @returns {object|null} {x, y} if valid position found, null otherwise
 */
function findValidPosition(floorIndex, origX, origY, compLength, compWidth, floorLength, floorWidth, excludeComponentIndex, requireHull = false, fitFloors = floorIndex) {
    const inner = getShapedInner(fitFloors);
    if (inner) {
        return findValidPositionInHull(inner, floorIndex, origX, origY, compLength, compWidth, excludeComponentIndex, requireHull);
    }

    const armorThickness = shipData.armorThickness || 0;
    const onHull = (x, y) => !requireHull ||
        touchesHull(x, y, compLength, compWidth, floorLength, floorWidth, armorThickness);

    // First, check if original position works (within usable area, on the hull if required, no overlap)
    if (isWithinUsableArea(origX, origY, compLength, compWidth, floorLength, floorWidth, armorThickness) &&
        onHull(origX, origY) &&
        !checkOverlap(floorIndex, origX, origY, compLength, compWidth, excludeComponentIndex)) {
        return { x: origX, y: origY };
    }

    // Get all components on this floor that might overlap
    const overlappingComponents = getObstacleRects(floorIndex, excludeComponentIndex);

    // Generate candidate positions by aligning to edges of overlapping components
    const candidates = [];

    // Hull components slide along the hull instead
    if (requireHull) {
        const bounds = getHullBounds(floorLength, floorWidth, armorThickness);
        candidates.push(...getHullCandidates(bounds, overlappingComponents, origX, origY, compLength, compWidth));
    }

    for (const comp of overlappingComponents) {
        // Try placing to the right of this component
        candidates.push({ x: comp.x + comp.length, y: origY });

        // Try placing to the left of this component
        candidates.push({ x: comp.x - compLength, y: origY });

        // Try placing below this component
        candidates.push({ x: origX, y: comp.y + comp.width });

        // Try placing above this component
        candidates.push({ x: origX, y: comp.y - compWidth });

        // Try corner positions
        candidates.push({ x: comp.x + comp.length, y: comp.y + comp.width });
        candidates.push({ x: comp.x + comp.length, y: comp.y - compWidth });
        candidates.push({ x: comp.x - compLength, y: comp.y + comp.width });
        candidates.push({ x: comp.x - compLength, y: comp.y - compWidth });
    }

    // Also try floor edges (respecting armor boundary)
    candidates.push({ x: armorThickness, y: origY });
    candidates.push({ x: floorLength - armorThickness - compLength, y: origY });
    candidates.push({ x: origX, y: armorThickness });
    candidates.push({ x: origX, y: floorWidth - armorThickness - compWidth });

    // Filter and sort candidates
    const validCandidates = candidates
        .map(pos => ({
            x: Math.max(armorThickness, Math.min(pos.x, floorLength - armorThickness - compLength)),
            y: Math.max(armorThickness, Math.min(pos.y, floorWidth - armorThickness - compWidth))
        }))
        .filter(pos => isWithinUsableArea(pos.x, pos.y, compLength, compWidth, floorLength, floorWidth, armorThickness) &&
                      onHull(pos.x, pos.y) &&
                      !checkOverlap(floorIndex, pos.x, pos.y, compLength, compWidth, excludeComponentIndex))
        .map(pos => ({
            ...pos,
            distance: Math.sqrt(Math.pow(pos.x - origX, 2) + Math.pow(pos.y - origY, 2))
        }))
        .sort((a, b) => a.distance - b.distance);

    // Remove duplicates
    const seen = new Set();
    const uniqueCandidates = validCandidates.filter(pos => {
        const key = `${pos.x},${pos.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Return the closest valid position, or null if none found
    if (uniqueCandidates.length > 0) {
        return { x: uniqueCandidates[0].x, y: uniqueCandidates[0].y };
    }

    return null;
}

// ========================================
// Placement Mode Management
// ========================================

/**
 * Finish placement mode
 */
function finishPlacement() {
    uiState.isPlacingComponent = false;
    uiState.placementData = null;

    // Clear drag preview
    clearPreview();

    // Remove placement-mode class from all canvases
    document.querySelectorAll('.floor-canvas.placement-mode').forEach(c => {
        c.classList.remove('placement-mode');
    });

    // Hide instructions
    const instructions = document.getElementById('placement-instructions');
    if (instructions) {
        instructions.classList.add('hidden');
    }

    // Update component list to show placed status
    renderComponents();
}

/**
 * Cancel placement mode
 */
function cancelPlacement() {
    if (!uiState.isPlacingComponent) return;

    // Remove any partial placements for this component
    const data = uiState.placementData;
    if (data && shipData.componentPlacements[data.componentIndex]) {
        // Keep existing placements, just cancel the current session
    }

    // Clear drag preview
    clearPreview();

    finishPlacement();
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = { isWithinUsableArea, fitsFloor, clampToFloor, checkOverlap, findValidPosition };
}
