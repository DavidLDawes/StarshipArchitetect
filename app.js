/**
 * Starship Architect - Main Application
 * Traveller Ship Design & Layout Tool
 */

// ========================================
// Constants
// ========================================
const SQM_PER_TON = 14;           // 1 ton of displacement = 14 square meters
const DEFAULT_CEILING_HEIGHT = 2.5; // Default ceiling height in meters

// ========================================
// State
// ========================================
let shipData = {
    totalTons: 0,
    totalCost: 0,
    components: [],
    numFloors: 4,
    floorLength: 30,
    ceilingHeight: DEFAULT_CEILING_HEIGHT
};

// ========================================
// DOM References
// ========================================
const elements = {
    csvInput: document.getElementById('csv-input'),
    fileName: document.getElementById('file-name'),

    statsSection: document.getElementById('stats-section'),
    totalTons: document.getElementById('total-tons'),
    totalSqm: document.getElementById('total-sqm'),
    totalCost: document.getElementById('total-cost'),

    floorConfigSection: document.getElementById('floor-config-section'),
    floorSlider: document.getElementById('floor-slider'),
    floorCount: document.getElementById('floor-count'),
    floorDimensions: document.getElementById('floor-dimensions'),
    floorLength: document.getElementById('floor-length'),
    floorWidth: document.getElementById('floor-width'),
    ceilingHeight: document.getElementById('ceiling-height'),
    sqmPerFloor: document.getElementById('sqm-per-floor'),

    floorDisplaySection: document.getElementById('floor-display-section'),
    floorList: document.getElementById('floor-list'),

    componentsSection: document.getElementById('components-section'),
    componentsList: document.getElementById('components-list')
};

// ========================================
// CSV Parsing
// ========================================

/**
 * Parse CSV content into ship components
 * @param {string} csvContent - Raw CSV content
 * @returns {object} Parsed ship data with components and totals
 */
function parseCSV(csvContent) {
    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    // Skip header row
    const dataLines = lines.slice(1);
    const components = [];
    let currentCategory = '';
    let totalTons = 0;
    let totalCost = 0;

    for (const line of dataLines) {
        // Parse CSV line (handles quoted fields)
        const fields = parseCSVLine(line);
        if (fields.length < 4) continue;

        let [category, item, tons, cost] = fields;

        // Clean up values
        category = category.trim();
        item = item.trim();
        tons = parseFloat(tons.replace(/[^0-9.-]/g, '')) || 0;
        cost = parseFloat(cost.replace(/[^0-9.-]/g, '')) || 0;

        // Handle category inheritance
        if (category) {
            currentCategory = category;
        } else {
            category = currentCategory;
        }

        // Check if this is the total line
        if (category.toLowerCase() === 'total') {
            totalTons = tons;
            totalCost = cost;
        } else {
            components.push({
                category: category,
                item: item,
                tons: tons,
                cost: cost
            });
        }
    }

    return {
        components,
        totalTons,
        totalCost
    };
}

/**
 * Parse a single CSV line handling quoted fields
 * @param {string} line - CSV line
 * @returns {string[]} Array of field values
 */
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);

    return fields;
}

// ========================================
// Floor Calculations
// ========================================

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
 * Generate dimension options for the dropdown
 * Creates pairs of length × width in pertinent multiples (10m for small ships, 100m for large)
 * @param {number} floorArea - Floor area in square meters
 * @returns {Array} Array of {length, width, label} objects
 */
function generateDimensionOptions(floorArea) {
    const options = [];

    // Determine the step size based on ship size
    // For very large ships (area > 10000 m²), use 100m increments
    // For medium ships (area > 1000 m²), use 50m increments
    // For smaller ships, use 10m increments
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
    // Length should be reasonable - not too narrow or too wide
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
    // If too few, try smaller step
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
        // Always include the last option for the full range
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
    step = Math.max(5, step); // Minimum 5m step

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

// ========================================
// UI Updates
// ========================================

/**
 * Show hidden sections after CSV is loaded
 */
function showSections() {
    elements.statsSection.classList.remove('hidden');
    elements.floorConfigSection.classList.remove('hidden');
    elements.floorDisplaySection.classList.remove('hidden');
    elements.componentsSection.classList.remove('hidden');
}

/**
 * Update ship statistics display
 */
function updateStats() {
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);

    elements.totalTons.textContent = shipData.totalTons.toLocaleString();
    elements.totalSqm.textContent = Math.round(totalArea).toLocaleString();
    elements.totalCost.textContent = shipData.totalCost.toLocaleString();
}

/**
 * Update floor configuration display
 */
function updateFloorConfig() {
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const width = calculateFloorWidth(floorArea, shipData.floorLength);

    elements.floorCount.textContent = shipData.numFloors;
    elements.floorLength.value = shipData.floorLength;
    elements.ceilingHeight.value = shipData.ceilingHeight;
    elements.sqmPerFloor.textContent = Math.round(floorArea).toLocaleString();
    elements.floorWidth.textContent = width.toFixed(1);

    // Update dimension dropdown
    updateDimensionDropdown(floorArea);
}

/**
 * Update the dimension dropdown options
 */
function updateDimensionDropdown(floorArea) {
    const options = generateDimensionOptions(floorArea);

    // Clear existing options
    elements.floorDimensions.innerHTML = '';

    // Add new options
    let closestIndex = 0;
    let closestDiff = Infinity;

    options.forEach((opt, index) => {
        const option = document.createElement('option');
        option.value = opt.length;
        option.textContent = opt.label;
        elements.floorDimensions.appendChild(option);

        // Find the closest match to current floor length
        const diff = Math.abs(opt.length - shipData.floorLength);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = index;
        }
    });

    // Select the closest matching option
    if (options.length > 0) {
        elements.floorDimensions.selectedIndex = closestIndex;
        // Update floor length to match selected option if different
        if (shipData.floorLength !== options[closestIndex].length) {
            shipData.floorLength = options[closestIndex].length;
            elements.floorLength.value = shipData.floorLength;
            const width = calculateFloorWidth(floorArea, shipData.floorLength);
            elements.floorWidth.textContent = width.toFixed(1);
        }
    }
}

/**
 * Render floor list
 */
function renderFloors() {
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const width = calculateFloorWidth(floorArea, shipData.floorLength);

    elements.floorList.innerHTML = '';

    for (let i = 1; i <= shipData.numFloors; i++) {
        const floorItem = document.createElement('div');
        floorItem.className = 'floor-item';
        floorItem.innerHTML = `
            <div class="floor-number">${i}</div>
            <div class="floor-details">
                <div class="floor-name">Floor ${i}</div>
                <div class="floor-dimensions">${shipData.floorLength} × ${width.toFixed(1)} meters, ${shipData.ceilingHeight} meters tall</div>
            </div>
        `;
        elements.floorList.appendChild(floorItem);
    }
}

/**
 * Render components list
 */
function renderComponents() {
    elements.componentsList.innerHTML = '';

    for (const component of shipData.components) {
        const compItem = document.createElement('div');
        compItem.className = 'component-item';
        compItem.innerHTML = `
            <div class="component-category">${component.category}</div>
            <div class="component-name">${component.item}</div>
            <div class="component-stats">
                <span>📦 ${component.tons} tons</span>
                <span>💰 ${component.cost.toLocaleString()} MCr</span>
            </div>
        `;
        elements.componentsList.appendChild(compItem);
    }
}

/**
 * Full UI refresh
 */
function refreshUI() {
    updateStats();
    updateFloorConfig();
    renderFloors();
    renderComponents();
}

// ========================================
// Event Handlers
// ========================================

/**
 * Handle CSV file selection
 */
elements.csvInput.addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (!file) return;

    elements.fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsed = parseCSV(e.target.result);

            // Update state
            shipData.totalTons = parsed.totalTons;
            shipData.totalCost = parsed.totalCost;
            shipData.components = parsed.components;

            // Calculate default floor length
            const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
            const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
            shipData.floorLength = calculateDefaultFloorLength(floorArea);

            // Show sections and refresh UI
            showSections();
            refreshUI();
        } catch (error) {
            alert('Error parsing CSV: ' + error.message);
            console.error(error);
        }
    };
    reader.readAsText(file);
});

/**
 * Handle floor slider changes
 */
elements.floorSlider.addEventListener('input', function (event) {
    shipData.numFloors = parseInt(event.target.value, 10);

    // Recalculate default floor length
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    shipData.floorLength = calculateDefaultFloorLength(floorArea);

    refreshUI();
});

/**
 * Handle floor length changes
 */
elements.floorLength.addEventListener('input', function (event) {
    const value = parseFloat(event.target.value);
    if (value >= 5) {
        shipData.floorLength = value;
        refreshUI();
    }
});

/**
 * Handle ceiling height changes
 */
elements.ceilingHeight.addEventListener('input', function (event) {
    const value = parseFloat(event.target.value);
    if (value >= 2 && value <= 10) {
        shipData.ceilingHeight = value;
        refreshUI();
    }
});

/**
 * Handle dimension dropdown selection
 */
elements.floorDimensions.addEventListener('change', function (event) {
    const selectedLength = parseFloat(event.target.value);
    if (selectedLength >= 5) {
        shipData.floorLength = selectedLength;
        elements.floorLength.value = selectedLength;

        // Recalculate width
        const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
        const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
        const width = calculateFloorWidth(floorArea, selectedLength);
        elements.floorWidth.textContent = width.toFixed(1);

        renderFloors();
    }
});

// ========================================
// Initialization
// ========================================
console.log('🚀 Starship Architect initialized');
