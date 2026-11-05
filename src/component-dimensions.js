/**
 * Starship Architect - Component Dimensions Module
 * Handles component area calculation and dimension options generation
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - placement-geometry.js (getPlacedCount, getPlacedTons)
 * - hull-access.js (getShapedInner)
 * - hull-shapes.js (getPolygonBounds, getRectFitRegion, polygonArea)
 * - floor-utils.js (getCurrentFloorDimensions, getShipGeometry)
 */

// ========================================
// Components That Take Irregular Space
// ========================================

/** Tons of a component small enough to count as placed (rounding, not a real remainder) */
const TONS_EPS = 0.01;

/** Fuel, cargo and similar stores can be any shape, so they can fill irregular space */
const IRREGULAR_ITEM = /\bfuel\b|\bcargo\b|\bspares\b|vacuum\s*(bay|storage)|data\s*storage|cold\s*storage/i;

/** Equipment that handles fuel or cargo is still a solid machine */
const IRREGULAR_EXCLUDE = /process|purif|scoop|pump|refiner|crane|lift|door|hatch/i;

/**
 * Whether a component can fill irregular floor space, and so is placed by tonnage
 * instead of as a whole rectangle. A fuel row can be named only by its category,
 * such as "9.75 tons (504 hours)" under Fuel.
 * @param {object} component - Parsed component ({category, item, itemName})
 * @returns {boolean}
 */
function canTakeIrregularSpace(component) {
    if (!component) return false;
    const name = `${component.itemName || ''} ${component.item || ''}`;
    if (IRREGULAR_EXCLUDE.test(name)) return false;
    return IRREGULAR_ITEM.test(name) || /^fuel$/i.test(component.category || '');
}

/**
 * Tons of a component still to place, for one placed by tonnage
 * @param {object} component
 * @param {object} placement - shipData.componentPlacements[i]
 * @returns {number} Tons, 0 once what is left is only rounding
 */
function getRemainingTons(component, placement) {
    const left = component.tons - getPlacedTons(placement);
    return left > TONS_EPS ? left : 0;
}

/**
 * Whether all of a component has been placed
 * @param {object} component
 * @param {object} placement - shipData.componentPlacements[i]
 * @returns {boolean}
 */
function isComponentFullyPlaced(component, placement) {
    if (canTakeIrregularSpace(component)) return getRemainingTons(component, placement) === 0;
    return getPlacedCount(placement) >= (component.quantity || 1);
}

/**
 * What the next placement of a component has to hold. A component placed by tonnage
 * only needs room for what is left of it.
 * @param {object} component
 * @param {object} placement - shipData.componentPlacements[i]
 * @returns {object} Component to size
 */
function getPlacementTarget(component, placement) {
    if (!canTakeIrregularSpace(component)) return component;
    const tons = getRemainingTons(component, placement);
    return { ...component, tons, tonsPerItem: tons, quantity: 1, overheadPerItem: 0 };
}

/**
 * Floor area still needed by everything that isn't placed yet
 * @param {Array<object>} components
 * @param {object} placements - shipData.componentPlacements
 * @returns {number} Area in m²
 */
function getStillToPlaceArea(components, placements) {
    return components.reduce((sum, c, i) => {
        if (!(c.tons > 0) || c.combinedWithStaterooms) return sum;
        if (canTakeIrregularSpace(c)) {
            return sum + getRemainingTons(c, placements[i]) * SQM_PER_TON / shipData.ceilingHeight;
        }
        const left = Math.max(0, (c.quantity || 1) - getPlacedCount(placements[i]));
        return sum + left * calculateComponentArea(c);
    }, 0);
}

// ========================================
// Component Area Calculation
// ========================================

/**
 * Tons taken up by one item, including any overhead it carries
 * (staterooms carry a share of rec/health tonnage when the two are combined;
 * see rec-health.js)
 * @param {object} component - Component with tons/tonsPerItem and optional overheadPerItem
 * @returns {number} Tons per item
 */
function getEffectiveTonsPerItem(component) {
    // Use per-item tonnage if available (for multi-quantity items)
    return (component.tonsPerItem || component.tons) + (component.overheadPerItem || 0);
}

/**
 * Calculate component area in square meters (for a single item)
 * @param {object} component - Component object with tons/tonsPerItem property
 * @returns {number} Area in square meters for one item
 */
function calculateComponentArea(component) {
    return (getEffectiveTonsPerItem(component) * SQM_PER_TON) / shipData.ceilingHeight;
}

// ========================================
// Dimension Options Generation
// ========================================

/**
 * Generate dimension options for a component
 * @param {object} component - The component
 * @param {number} floorArea - Area of one floor in m²
 * @param {number} floorLength - Floor length in meters
 * @param {number} floorWidth - Floor width in meters
 * @param {number} numFloorsSelected - Number of floors selected by user (defaults to calculated minimum)
 * @param {Array<[number, number]>} hull - Usable space to fit on a shaped hull. Sizes
 *   then come from this space rather than the floor size and armor, and only sizes
 *   that fit it are offered
 * @returns {object} Options and metadata
 */
function generateComponentDimensionOptions(component, floorArea, floorLength, floorWidth, numFloorsSelected = null, hull = null) {
    const componentArea = calculateComponentArea(component);
    const options = [];
    const seen = new Set();

    // Determine component size category
    const isSmall = componentArea < 40;
    const isLarge = componentArea >= floorArea * 0.5;
    const isMultiFloor = componentArea > floorArea;
    const floorsNeeded = Math.ceil(componentArea / floorArea);

    // Calculate area per floor based on SELECTED floors (or calculated minimum)
    const effectiveFloorCount = numFloorsSelected || (isMultiFloor ? floorsNeeded : 1);
    const areaPerFloor = componentArea / effectiveFloorCount;

    // Account for armor boundary: usable area is reduced by armor on all sides
    const armorThickness = shipData.armorThickness || 0;
    const hullBox = hull && hull.length > 0 ? getPolygonBounds(hull) : { length: 0, width: 0 };
    const usableFloorLength = hull ? hullBox.length : Math.max(0, floorLength - 2 * armorThickness);
    const usableFloorWidth = hull ? hullBox.width : Math.max(0, floorWidth - 2 * armorThickness);

    // Minimum dimension - use 1m for small components, 5m for larger
    const minDim = isSmall ? 1 : 5;

    // Helper to add option if valid and unique
    function addOption(length, width, label) {
        // Use precise values for validation; use rounded values only for key/label
        const preciseLength = length;
        const preciseWidth = width;
        const roundedLength = Math.round(preciseLength * 10) / 10;
        const roundedWidth = Math.round(preciseWidth * 10) / 10;

        const key = `${roundedLength}x${roundedWidth}`;

        if (seen.has(key)) return;
        if (preciseLength < minDim || preciseWidth < minDim) return;

        // Sizes that exactly fill the usable floor are the point of some options,
        // so this only needs to allow for floating point error
        if (preciseLength > usableFloorLength + 1e-6 || preciseWidth > usableFloorWidth + 1e-6) return;
        if (hull && getRectFitRegion(hull, preciseLength, preciseWidth).length === 0) return;

        // For multi-floor components, validate against per-floor area
        const areaCheck = preciseLength * preciseWidth;
        const minArea = areaPerFloor * 0.95;
        if (areaCheck < minArea) return;

        // Never offer more floor than the item needs: on a full ship the extra
        // leaves something else without room
        if (areaCheck > areaPerFloor + 1e-6) return;

        // Append "(per floor)" to label if multiple floors selected
        const finalLabel = effectiveFloorCount > 1 ? `${label} (per floor)` : label;

        seen.add(key);
        options.push({ length: preciseLength, width: preciseWidth, label: finalLabel });
    }

    // 1. Floor dimension-based options (ALWAYS INCLUDE WHEN APPLICABLE)
    // These help users create components that span floor dimensions or ceiling height
    // Per user requirements: "Always add that to the list no matter how many selections are already there"
    // IMPORTANT: These must come FIRST so they get the descriptive labels
    // (e.g., "12 × 35 m (full width)" instead of generic "12 × 35 m")
    // The `seen` Set prevents duplicate dimensions, so order matters!

    // Option 1: Component spans full usable floor width (usable floor width as Y dimension)
    if (usableFloorWidth > 0) {
        const lengthForFullWidth = areaPerFloor / usableFloorWidth;
        if (lengthForFullWidth >= minDim) {
            addOption(lengthForFullWidth, usableFloorWidth, `${lengthForFullWidth.toFixed(1)} × ${usableFloorWidth.toFixed(1)} m (full width)`);
        }
    }

    // Option 2: Component spans full usable floor length (usable floor length as X dimension)
    if (usableFloorLength > 0) {
        const widthForFullLength = areaPerFloor / usableFloorLength;
        if (widthForFullLength >= minDim) {
            addOption(usableFloorLength, widthForFullLength, `${usableFloorLength.toFixed(1)} × ${widthForFullLength.toFixed(1)} m (full length)`);
        }
    }

    // 2. Floor width-based options (component spans floor width)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const width = usableFloorWidth / divisor;
        if (width >= minDim) {
            const length = areaPerFloor / width;
            if (length <= usableFloorLength && length >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 3. Floor length-based options (component spans floor length)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const length = usableFloorLength / divisor;
        if (length >= minDim) {
            const width = areaPerFloor / length;
            if (width <= usableFloorWidth && width >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 4. Square-ish option (close to square)
    const sqSide = Math.sqrt(areaPerFloor);
    if (sqSide >= minDim && sqSide <= Math.min(usableFloorLength, usableFloorWidth)) {
        addOption(sqSide, sqSide, `${sqSide.toFixed(1)} × ${sqSide.toFixed(1)} m`);
    }

    // On a shaped hull the options above often don't fit, so try other proportions
    if (hull) {
        for (const aspect of [1.25, 1.5, 2, 2.5, 3, 4]) {
            const short = Math.sqrt(areaPerFloor / aspect);
            const long = short * aspect;
            addOption(long, short, `${long.toFixed(1)} × ${short.toFixed(1)} m`);
            addOption(short, long, `${short.toFixed(1)} × ${long.toFixed(1)} m`);
        }
    }

    // 5. Multiples of 5m (or 1m for small components)
    const step = isSmall ? 1 : 5;
    const maxLengthOpt = Math.min(usableFloorLength, Math.ceil(areaPerFloor / step));

    for (let l = step; l <= maxLengthOpt; l += step) {
        const w = areaPerFloor / l;
        const roundedW = Math.round(w / step) * step;
        if (roundedW >= step && roundedW <= usableFloorWidth) {
            // Only a round size that is exactly the right area
            if (Math.abs(l * roundedW - areaPerFloor) <= 1e-6) {
                addOption(l, roundedW, `${l} × ${roundedW} m`);
            }
        }
    }

    // 6. If no options found, try full floor coverage (for very large components)
    if (options.length === 0 && isMultiFloor) {
        // Use full floor dimensions
        // Use usable floor dimensions for full-floor option
        addOption(usableFloorLength, usableFloorWidth, `${usableFloorLength.toFixed(1)} × ${usableFloorWidth.toFixed(1)} m (full floor)`);

        // Also try 90% of usable floor in each dimension
        const len90 = usableFloorLength * 0.9;
        const wid90 = usableFloorWidth * 0.9;
        if (len90 * wid90 >= areaPerFloor * 0.95) {
            addOption(len90, wid90, `${len90.toFixed(1)} × ${wid90.toFixed(1)} m`);
        }
    }

    // 7. Very small items fall under the 1 m minimum: offer a square if it fits
    if (options.length === 0 && sqSide > 0 && sqSide < minDim &&
        sqSide <= Math.min(usableFloorLength, usableFloorWidth) &&
        (!hull || getRectFitRegion(hull, sqSide, sqSide).length > 0)) {
        options.push({ length: sqSide, width: sqSide, label: `${sqSide.toFixed(1)} × ${sqSide.toFixed(1)} m` });
    }

    // Sort options by how close to square they are
    options.sort((a, b) => {
        const ratioA = Math.abs(1 - a.length / a.width);
        const ratioB = Math.abs(1 - b.length / b.width);
        return ratioA - ratioB;
    });

    return {
        options,
        componentArea,
        isSmall,
        isLarge,
        isMultiFloor,
        floorsNeeded,
        areaPerFloor,
        effectiveFloorCount,
        floorArea
    };
}

/**
 * Dimension options for a component on the floors it will go on. On a shaped hull
 * these fit those floors, and "needs more than one floor" is judged by the largest.
 * @param {object} component
 * @param {number|number[]} floors - Floor number, or the floors a component spans
 * @param {number} numFloorsSelected - Floors chosen by the user (defaults to the minimum)
 * @returns {object} See generateComponentDimensionOptions
 */
function getDeckDimensionOptions(component, floors, numFloorsSelected = null) {
    const { floorArea, floorLength, floorWidth } = getCurrentFloorDimensions();
    const inner = getShapedInner(floors);
    if (!inner) {
        return generateComponentDimensionOptions(component, floorArea, floorLength, floorWidth, numFloorsSelected);
    }
    const largestDeck = Math.max(...getShipGeometry().floors.map(f => f.usableArea));
    return generateComponentDimensionOptions(component, largestDeck, floorLength, floorWidth, numFloorsSelected, inner);
}

/**
 * Adjacent floors to suggest for a component: the bottom ones on a rectangular
 * ship, and on a shaped hull the ones sharing the most usable space
 * @param {number} count - Floors wanted
 * @returns {number[]} Floor numbers
 */
function getSuggestedFloors(count) {
    const total = shipData.numFloors;
    const wanted = Math.min(Math.max(1, count), total);
    const start = from => Array.from({ length: wanted }, (_, i) => from + i);
    if (!getShapedInner(1)) return start(1);

    let best = start(1);
    let bestArea = -1;
    for (let from = 1; from + wanted - 1 <= total; from++) {
        const area = polygonArea(getShapedInner(start(from)));
        if (area > bestArea) {
            best = start(from);
            bestArea = area;
        }
    }
    return best;
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        canTakeIrregularSpace,
        getRemainingTons,
        isComponentFullyPlaced,
        getPlacementTarget,
        getStillToPlaceArea,
        getEffectiveTonsPerItem,
        calculateComponentArea,
        generateComponentDimensionOptions,
        getDeckDimensionOptions,
        getSuggestedFloors
    };
}
