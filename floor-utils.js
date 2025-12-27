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
    const options = [];
    step = Math.max(5, step);

    const minLength = Math.max(step, Math.ceil((Math.sqrt(floorArea / 3)) / step) * step);
    const maxLength = Math.floor((Math.sqrt(floorArea * 3)) / step) * step;

    for (let length = minLength; length <= maxLength; length += step) {
        const width = floorArea / length;
        const ratio = length / width;
        if (ratio >= 0.33 && ratio <= 3) {
            options.push({
                length: length,
                width: width,
                label: `${length} × ${width.toFixed(1)} m`
            });
        }
    }

    return options;
}
