/**
 * Starship Architect - Component Dimensions Module
 * Handles component area calculation and dimension options generation
 */

// ========================================
// Component Area Calculation
// ========================================

/**
 * Calculate component area in square meters (for a single item)
 * @param {object} component - Component object with tons/tonsPerItem property
 * @returns {number} Area in square meters for one item
 */
function calculateComponentArea(component) {
    // Use per-item tonnage if available (for multi-quantity items)
    const tons = component.tonsPerItem || component.tons;
    return (tons * SQM_PER_TON) / shipData.ceilingHeight;
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
 * @returns {object} Options and metadata
 */
function generateComponentDimensionOptions(component, floorArea, floorLength, floorWidth, numFloorsSelected = null) {
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

    // Minimum dimension - use 1m for small components, 5m for larger
    const minDim = isSmall ? 1 : 5;

    // Helper to add option if valid and unique
    function addOption(length, width, label) {
        // Round to reasonable precision
        length = Math.round(length * 10) / 10;
        width = Math.round(width * 10) / 10;

        const key = `${length}x${width}`;

        if (seen.has(key)) {
            return;
        }
        if (length < minDim || width < minDim) {
            return;
        }

        // Round floor dimensions to same precision for fair comparison
        const roundedFloorLength = Math.round(floorLength * 10) / 10;
        const roundedFloorWidth = Math.round(floorWidth * 10) / 10;

        if (length > roundedFloorLength || width > roundedFloorWidth) {
            return;
        }
        // For multi-floor components, validate against per-floor area
        const areaCheck = length * width;
        const minArea = areaPerFloor * 0.95;
        if (areaCheck < minArea) {
            return;
        }

        // Append "(per floor)" to label if multiple floors selected
        const finalLabel = effectiveFloorCount > 1 ? `${label} (per floor)` : label;

        seen.add(key);
        options.push({ length, width, label: finalLabel });
    }

    // 1. Floor dimension-based options (ALWAYS INCLUDE WHEN APPLICABLE)
    // These help users create components that span floor dimensions or ceiling height
    // Per user requirements: "Always add that to the list no matter how many selections are already there"
    // IMPORTANT: These must come FIRST so they get the descriptive labels
    // (e.g., "12 × 35 m (full width)" instead of generic "12 × 35 m")
    // The `seen` Set prevents duplicate dimensions, so order matters!

    // Option 1: Component spans full floor width (floor width as Y dimension)
    // Add if: componentArea / floorWidth >= 5 (minimum for X dimension)
    const lengthForFullWidth = areaPerFloor / floorWidth;
    if (lengthForFullWidth >= minDim) {
        addOption(lengthForFullWidth, floorWidth, `${lengthForFullWidth.toFixed(1)} × ${floorWidth.toFixed(1)} m (full width)`);
    }

    // Option 2: Component spans full floor length (floor length as X dimension)
    // Add if: componentArea / floorLength >= 5 (minimum for Y dimension)
    const widthForFullLength = areaPerFloor / floorLength;
    if (widthForFullLength >= minDim) {
        addOption(floorLength, widthForFullLength, `${floorLength.toFixed(1)} × ${widthForFullLength.toFixed(1)} m (full length)`);
    }

    // 2. Floor width-based options (component spans floor width)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const width = floorWidth / divisor;
        if (width >= minDim) {
            const length = areaPerFloor / width;
            if (length <= floorLength && length >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 3. Floor length-based options (component spans floor length)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const length = floorLength / divisor;
        if (length >= minDim) {
            const width = areaPerFloor / length;
            if (width <= floorWidth && width >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 4. Square-ish option (close to square)
    const sqSide = Math.sqrt(areaPerFloor);
    if (sqSide >= minDim && sqSide <= Math.min(floorLength, floorWidth)) {
        addOption(sqSide, sqSide, `${sqSide.toFixed(1)} × ${sqSide.toFixed(1)} m`);
    }

    // 5. Multiples of 5m (or 1m for small components)
    const step = isSmall ? 1 : 5;
    const maxLengthOpt = Math.min(floorLength, Math.ceil(areaPerFloor / step));

    for (let l = step; l <= maxLengthOpt; l += step) {
        const w = areaPerFloor / l;
        const roundedW = Math.round(w / step) * step;
        if (roundedW >= step && roundedW <= floorWidth) {
            const actualArea = l * roundedW;
            // Allow slight over-sizing (up to 10% more)
            if (actualArea >= areaPerFloor && actualArea <= areaPerFloor * 1.1) {
                addOption(l, roundedW, `${l} × ${roundedW} m`);
            }
        }
    }

    // 6. If no options found, try full floor coverage (for very large components)
    if (options.length === 0 && isMultiFloor) {
        // Use full floor dimensions
        addOption(floorLength, floorWidth, `${floorLength.toFixed(1)} × ${floorWidth.toFixed(1)} m (full floor)`);

        // Also try 90% of floor in each dimension
        const len90 = floorLength * 0.9;
        const wid90 = floorWidth * 0.9;
        if (len90 * wid90 >= areaPerFloor * 0.95) {
            addOption(len90, wid90, `${len90.toFixed(1)} × ${wid90.toFixed(1)} m`);
        }
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
        effectiveFloorCount
    };
}
