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
    ceilingHeight: DEFAULT_CEILING_HEIGHT,
    componentPlacements: {} // { componentIndex: { length, width, floors: [{floor, x, y}] } }
};

let uiState = {
    selectedComponent: null,
    isPlacingComponent: false,
    placementData: null,
    placementHistory: [], // Stack of placements for undo
    redoHistory: [],      // Stack of undone placements for redo
    selectedPlacement: null // { componentIndex, floorIndex, placementIndex } - currently selected for moving
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
    const { totalArea } = getCurrentFloorDimensions();

    elements.totalTons.textContent = shipData.totalTons.toLocaleString();
    elements.totalSqm.textContent = Math.round(totalArea).toLocaleString();
    elements.totalCost.textContent = shipData.totalCost.toLocaleString();
}

/**
 * Update floor configuration display
 */
function updateFloorConfig() {
    const { floorArea, floorWidth } = getCurrentFloorDimensions();

    elements.floorCount.textContent = shipData.numFloors;
    elements.floorLength.value = shipData.floorLength;
    elements.ceilingHeight.value = shipData.ceilingHeight;
    elements.sqmPerFloor.textContent = Math.round(floorArea).toLocaleString();
    elements.floorWidth.textContent = floorWidth.toFixed(1);

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
        if (shipData.floorLength !== options[closestIndex].length) {
            shipData.floorLength = options[closestIndex].length;
            elements.floorLength.value = shipData.floorLength;
            const width = calculateFloorWidth(floorArea, shipData.floorLength);
            elements.floorWidth.textContent = width.toFixed(1);
        }
    }
}

/**
 * Render floor list with canvas visualizations
 */
function renderFloors() {
    const { floorWidth, floorLength } = getCurrentFloorDimensions();

    elements.floorList.innerHTML = '';

    for (let i = 1; i <= shipData.numFloors; i++) {
        const floorItem = document.createElement('div');
        floorItem.className = 'floor-item';

        // Create floor info section
        const floorInfo = document.createElement('div');
        floorInfo.className = 'floor-info';
        floorInfo.innerHTML = `
            <div class="floor-number">${i}</div>
            <div class="floor-details">
                <div class="floor-name">Floor ${i}</div>
                <div class="floor-dimensions">${floorLength} × ${floorWidth.toFixed(1)} meters, ${shipData.ceilingHeight} meters tall</div>
            </div>
        `;
        floorItem.appendChild(floorInfo);

        // Create canvas container and canvas with correct proportions
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'floor-canvas-container';

        const canvas = document.createElement('canvas');
        canvas.className = 'floor-canvas';
        canvas.id = `floor-canvas-${i}`;

        // Calculate canvas dimensions maintaining aspect ratio
        const aspectRatio = floorWidth / floorLength;

        canvas.style.width = '100%';
        canvas.style.aspectRatio = `${floorLength} / ${floorWidth}`;

        // Set actual canvas resolution for drawing
        canvas.width = 800;
        canvas.height = Math.round(800 * aspectRatio);

        // Add click handler for placement
        const floorIndex = i;
        canvas.addEventListener('click', (e) => handleCanvasPlacement(e, floorIndex));

        canvasContainer.appendChild(canvas);
        floorItem.appendChild(canvasContainer);

        elements.floorList.appendChild(floorItem);

        // Draw floor with any placed components
        drawFloorWithComponents(canvas, i, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }

    // Setup drag preview handlers on all canvases
    setupDragPreview();

    // Setup floor selector with updated floor count
    setupFloorSelector();
}

/**
 * Render components list with click handlers
 */
function renderComponents() {
    elements.componentsList.innerHTML = '';

    shipData.components.forEach((component, index) => {
        // Count how many of this component are placed
        const placement = shipData.componentPlacements[index];
        const placedCount = placement && placement.floors ? placement.floors.length : 0;
        const totalQuantity = component.quantity || 1;
        const remainingCount = totalQuantity - placedCount;
        const isFullyPlaced = placedCount >= totalQuantity;

        // Skip fully placed single-item components
        if (isFullyPlaced && totalQuantity === 1) {
            return; // Don't render this component
        }

        const compItem = document.createElement('div');
        compItem.className = 'component-item';

        // Check if any are placed
        if (placedCount > 0) {
            compItem.classList.add('placed');
        }

        // Mark as fully placed if all are done
        if (isFullyPlaced) {
            compItem.classList.add('fully-placed');
        }

        // Check if component has zero tons (software, etc.)
        const hasArea = component.tons > 0;
        if (!hasArea) {
            compItem.classList.add('no-area');
        }

        // Build placement info text
        let placementInfo = '';
        if (placedCount > 0) {
            if (totalQuantity > 1) {
                placementInfo = `<div class="component-placement-info">📍 Placed ${placedCount} of ${totalQuantity}</div>`;
            } else {
                const floors = placement.floors.map(f => f.floor).join(', ');
                placementInfo = `<div class="component-placement-info">📍 Placed on Floor${placement.floors.length > 1 ? 's' : ''} ${floors}</div>`;
            }
        } else if (totalQuantity > 1) {
            placementInfo = `<div class="component-quantity-info">📦 ${totalQuantity} to place</div>`;
        }

        compItem.innerHTML = `
            <div class="component-category">${component.category}</div>
            <div class="component-name">${component.item}</div>
            <div class="component-stats">
                <span>📦 ${component.tons} tons${totalQuantity > 1 ? ` (${component.tonsPerItem} each)` : ''}</span>
                <span>💰 ${component.cost.toLocaleString()} MCr</span>
            </div>
            ${placementInfo}
        `;

        // Add click handler for components with area that aren't fully placed
        if (hasArea && !isFullyPlaced) {
            compItem.addEventListener('click', () => openComponentModal(index));
            compItem.style.cursor = 'pointer';
        } else if (isFullyPlaced) {
            compItem.style.opacity = '0.6';
            compItem.style.cursor = 'default';
        }

        elements.componentsList.appendChild(compItem);
    });
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
            shipData.componentPlacements = {}; // Reset placements

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

    // Clear placements when floor count changes
    shipData.componentPlacements = {};

    refreshUI();
});

/**
 * Handle floor length changes
 */
elements.floorLength.addEventListener('input', function (event) {
    const value = parseFloat(event.target.value);
    if (value >= 5) {
        shipData.floorLength = value;
        // Clear placements when dimensions change
        shipData.componentPlacements = {};
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
        // Clear placements when dimensions change
        shipData.componentPlacements = {};
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
        const { floorWidth } = getCurrentFloorDimensions();
        elements.floorWidth.textContent = floorWidth.toFixed(1);

        // Clear placements when dimensions change
        shipData.componentPlacements = {};

        renderFloors();
        renderComponents();
    }
});

// ========================================
// Initialization
// ========================================
document.addEventListener('DOMContentLoaded', function () {
    setupComponentModalEvents();
    initializeFloorSelector();
    console.log('🚀 Starship Architect initialized');
});
