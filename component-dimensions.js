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
 * @returns {object} Options and metadata
 */
function generateComponentDimensionOptions(component, floorArea, floorLength, floorWidth) {
    const componentArea = calculateComponentArea(component);
    const options = [];
    const seen = new Set();

    // Determine component size category
    const isSmall = componentArea < 40;
    const isLarge = componentArea >= floorArea * 0.5;
    const isMultiFloor = componentArea > floorArea;
    const floorsNeeded = Math.ceil(componentArea / floorArea);

    // Calculate area per floor for multi-floor components
    const areaPerFloor = isMultiFloor ? componentArea / floorsNeeded : componentArea;

    // Minimum dimension - use 1m for small components, 5m for larger
    const minDim = isSmall ? 1 : 5;

    // Helper to add option if valid and unique
    function addOption(length, width, label) {
        // Round to reasonable precision
        length = Math.round(length * 10) / 10;
        width = Math.round(width * 10) / 10;

        const key = `${length}x${width}`;
        if (seen.has(key)) return;
        if (length < minDim || width < minDim) return;
        if (length > floorLength || width > floorWidth) return;
        // For multi-floor components, validate against per-floor area
        if (length * width < areaPerFloor * 0.95) return;

        seen.add(key);
        options.push({ length, width, label });
    }

    // 1. Floor width-based options (component spans floor width)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const width = floorWidth / divisor;
        if (width >= minDim) {
            const length = areaPerFloor / width;
            if (length <= floorLength && length >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 2. Floor length-based options (component spans floor length)
    for (let divisor = 1; divisor <= 4; divisor++) {
        const length = floorLength / divisor;
        if (length >= minDim) {
            const width = areaPerFloor / length;
            if (width <= floorWidth && width >= minDim) {
                addOption(length, width, `${length.toFixed(1)} × ${width.toFixed(1)} m`);
            }
        }
    }

    // 3. Square-ish option (close to square)
    const sqSide = Math.sqrt(areaPerFloor);
    if (sqSide >= minDim && sqSide <= Math.min(floorLength, floorWidth)) {
        addOption(sqSide, sqSide, `${sqSide.toFixed(1)} × ${sqSide.toFixed(1)} m`);
    }

    // 4. Multiples of 5m (or 1m for small components)
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

    // 5. If no options found, try full floor coverage (for very large components)
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
        areaPerFloor
    };
}
