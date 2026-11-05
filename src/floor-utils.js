/**
 * Starship Architect - Floor Utilities Module
 * Floor dimension calculations and option generation
 */

/**
 * Calculate total floor area from tonnage
 * Floor area = (total tons) * 14 / ceiling height
 * @param {number} tons - Total ship tonnage
 * @param {number} ceilingHeight - Ceiling height in meters
 * @returns {number} Total floor area in square meters
 */
function calculateTotalFloorArea(tons, ceilingHeight) {
    return (tons * SQM_PER_TON) / ceilingHeight;
}

/**
 * Calculate floor area per floor
 * @param {number} totalArea - Total floor area
 * @param {number} numFloors - Number of floors
 * @returns {number} Square meters per floor
 */
function calculateFloorArea(totalArea, numFloors) {
    return totalArea / numFloors;
}

/**
 * Calculate default floor length based on area
 * Uses nearest multiple of 10 below the square root, minimum 5
 * @param {number} floorArea - Floor area in square meters
 * @returns {number} Suggested floor length
 */
function calculateDefaultFloorLength(floorArea) {
    const sqRoot = Math.sqrt(floorArea);
    let length = Math.floor(sqRoot / 10) * 10;
    if (length < 5) length = 5;
    return length;
}

/**
 * Calculate floor width from area and length
 * @param {number} floorArea - Floor area in square meters
 * @param {number} length - Floor length in meters
 * @returns {number} Floor width in meters
 */
function calculateFloorWidth(floorArea, length) {
    return floorArea / length;
}

/**
 * Generate dimension options for the floor dropdown
 * Creates pairs of length × width in pertinent multiples
 * @param {number} floorArea - Floor area in square meters
 * @returns {Array} Array of {length, width, label} objects
 */
function generateDimensionOptions(floorArea) {
    const options = [];

    // Determine the step size based on ship size
    let step;
    if (floorArea > 50000) {
        step = 100;
    } else if (floorArea > 10000) {
        step = 50;
    } else if (floorArea > 2500) {
        step = 20;
    } else {
        step = 10;
    }

    // Calculate the range of sensible lengths
    const sqRoot = Math.sqrt(floorArea);

    // Find minimum length (at least step, and width shouldn't be more than 3x length)
    const minLength = Math.max(step, Math.ceil((Math.sqrt(floorArea / 3)) / step) * step);

    // Find maximum length (width shouldn't be less than 1/3 of length)
    const maxLength = Math.floor((Math.sqrt(floorArea * 3)) / step) * step;

    // Generate options from min to max length
    for (let length = minLength; length <= maxLength; length += step) {
        const width = floorArea / length;

        // Only include reasonable width ratios (between 1:3 and 3:1)
        const ratio = length / width;
        if (ratio >= 0.33 && ratio <= 3) {
            options.push({
                length: length,
                width: width,
                label: `${length} × ${width.toFixed(1)} m`
            });
        }
    }

    // Ensure we have between 3 and 12 options
    if (options.length < 3 && step > 5) {
        return generateDimensionOptionsWithStep(floorArea, step / 2);
    }

    // If too many, thin out by taking every Nth
    if (options.length > 12) {
        const thinFactor = Math.ceil(options.length / 12);
        const thinned = [];
        for (let i = 0; i < options.length; i += thinFactor) {
            thinned.push(options[i]);
        }
        if (thinned[thinned.length - 1] !== options[options.length - 1]) {
            thinned.push(options[options.length - 1]);
        }
        return thinned;
    }

    return options;
}

/**
 * Helper to generate options with a specific step size
 */
function generateDimensionOptionsWithStep(floorArea, step) {
    step = Math.max(5, step);

    const options = [];
    const minLength = Math.max(step, Math.ceil((Math.sqrt(floorArea / 3)) / step) * step);
    const maxLength = Math.floor((Math.sqrt(floorArea * 3)) / step) * step;

    for (let length = minLength; length <= maxLength; length += step) {
        const width = floorArea / length;
        const ratio = length / width;
        if (ratio >= 0.33 && ratio <= 3) {
            options.push({ length, width, label: `${length} × ${width.toFixed(1)} m` });
        }
    }

    if (options.length < 3 && step > 5) {
        return generateDimensionOptionsWithStep(floorArea, step / 2);
    }

    return options;
}

/**
 * Calculate armor thickness
 * Armor is one even layer on the walls of every floor, so its volume is spread
 * over the total length of wall on the ship
 * @param {number} totalArmorTons - Total armor tonnage
 * @param {number} totalPerimeter - Combined perimeter of all floors in meters
 * @param {number} ceilingHeight - Ceiling height in meters
 * @returns {number} Armor thickness in meters
 */
function calculateArmorThickness(totalArmorTons, totalPerimeter, ceilingHeight) {
    if (totalArmorTons <= 0 || totalPerimeter <= 0) {
        return 0;
    }
    return (totalArmorTons * SQM_PER_TON) / (totalPerimeter * ceilingHeight);
}

// ========================================
// Current Ship
// ========================================

/** Last geometry built by getShipGeometry() and the settings it was built from */
let shipGeometryCache = null;
let shipGeometryCacheKey = '';

/**
 * Floor geometry for the current ship (see buildFloorGeometry in hull-shapes.js).
 * This runs on every mouse move during a drag, so the result is kept until a
 * setting it depends on changes.
 * @returns {object} { shape, length, width, totalArea, armorThickness, floors }
 */
function getShipGeometry() {
    const { hullShape, totalTons, ceilingHeight, numFloors, floorLength, armorTons } = shipData;
    const key = [hullShape, totalTons, ceilingHeight, numFloors, floorLength, armorTons].join('|');
    if (key !== shipGeometryCacheKey || !shipGeometryCache) {
        shipGeometryCache = buildFloorGeometry({
            shape: hullShape,
            totalTons,
            ceilingHeight,
            numFloors,
            length: floorLength,
            armorTons
        });
        shipGeometryCacheKey = key;
    }
    return shipGeometryCache;
}

/**
 * Geometry of one floor of the current ship
 * @param {number} floorIndex - Floor number (1 is the bottom deck)
 * @returns {object|null} See buildFloorGeometry, or null if there is no such floor
 */
function getFloorGeometry(floorIndex) {
    return getShipGeometry().floors[floorIndex - 1] || null;
}

/**
 * Floors the armor leaves with no usable space
 * @returns {number[]} Floor numbers
 */
function getUnusableFloors() {
    return getShipGeometry().floors.filter(f => f.inner.length === 0).map(f => f.floor);
}

/**
 * Bring the floor length and armor thickness in line with the ship's settings.
 * Call this after changing the tonnage, floor count, ceiling height, floor
 * length, armor, or hull shape.
 * @param {object} options
 * @param {boolean} options.resetLength - Go back to the shape's default length
 */
function recalculateFloors({ resetLength = false } = {}) {
    if (resetLength) {
        const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
        const length = getDefaultHullLength(shipData.hullShape, totalArea, shipData.numFloors);
        if (length !== null) shipData.floorLength = length;
    }
    const geometry = getShipGeometry();
    // Some shapes set their own length from their area
    shipData.floorLength = geometry.length;
    shipData.armorThickness = geometry.armorThickness;
}

/**
 * Smallest and largest floor area of the current ship
 * @returns {{min: number, max: number}} Areas in m²
 */
function getFloorAreaRange() {
    const areas = getShipGeometry().floors.map(f => f.area);
    return { min: Math.min(...areas), max: Math.max(...areas) };
}

/**
 * Frame width the current ship would have at a given length
 * @param {number} length - Length in meters
 * @returns {number} Width in meters
 */
function getFrameWidthAtLength(length) {
    const { hullShape, totalTons, ceilingHeight, numFloors } = shipData;
    return buildFloorGeometry({ shape: hullShape, totalTons, ceilingHeight, numFloors, length }).width;
}

/**
 * Size choices for the floor dimensions dropdown on the current ship
 * @param {number} floorArea - Average floor area in m²
 * @returns {Array} Array of {length, width, label} objects
 */
function getHullDimensionOptions(floorArea) {
    const shape = resolveHullShape(shipData.hullShape);
    if (shape === 'rectangular') return generateDimensionOptions(floorArea);

    if (!HULL_SHAPES[shape].freeLength) {
        const { length, width } = getShipGeometry();
        return [{ length, width, label: `${length.toFixed(1)} × ${width.toFixed(1)} m (set by shape)` }];
    }
    return generateDimensionOptions(floorArea).map(({ length }) => {
        const width = getFrameWidthAtLength(length);
        return { length, width, label: `${length} × ${width.toFixed(1)} m` };
    });
}

/**
 * Get current floor dimensions from global shipData
 * floorLength and floorWidth are the frame all floors share: the box that holds
 * the largest floor outlines
 * @returns {Object} Object containing { totalArea, floorArea, floorWidth, floorLength }
 */
function getCurrentFloorDimensions() {
    const { totalArea, length, width } = getShipGeometry();
    return {
        totalArea,
        floorArea: calculateFloorArea(totalArea, shipData.numFloors),
        floorWidth: width,
        floorLength: length
    };
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        calculateTotalFloorArea,
        calculateFloorArea,
        calculateDefaultFloorLength,
        calculateFloorWidth,
        generateDimensionOptions,
        generateDimensionOptionsWithStep,
        calculateArmorThickness,
        getShipGeometry,
        getFloorGeometry,
        getUnusableFloors,
        recalculateFloors,
        getFloorAreaRange,
        getFrameWidthAtLength,
        getHullDimensionOptions,
        getCurrentFloorDimensions,
    };
}
