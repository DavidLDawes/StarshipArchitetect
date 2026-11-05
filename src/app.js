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
    shipName: '',
    totalTons: 0,
    totalCost: 0,
    components: [],
    configuration: { general: 'standard', shape: 'rectangular', text: '' }, // From the design file (csv-parser.js)
    hullShape: 'rectangular', // Shape floors are built with (hull-shapes.js); starts from the design file, the user can change it
    armorTons: 0,           // Total armor tonnage
    armorThickness: 0,      // Armor thickness in meters (calculated per floor)
    numFloors: 4,
    floorLength: 30,
    ceilingHeight: DEFAULT_CEILING_HEIGHT,
    combineRecHealth: false, // Rec/health items ride along with staterooms (rec-health.js)
    componentPlacements: {} // { componentIndex: { length, width, floors: [{floor, x, y}] } }
};

let uiState = {
    selectedComponent: null,
    isPlacingComponent: false,
    placementData: null,
    placementHistory: [], // Stack of placements for undo
    redoHistory: [],      // Stack of undone placements for redo
    selectedPlacement: null, // { componentIndex, floorIndex, placementIndex } - currently selected for moving
    regionFill: null         // { componentIndex, ... } while picking free regions to fill (bulk-allocation.js)
};

// ========================================
// DOM References
// ========================================
const elements = {
    csvInput: document.getElementById('csv-input'),
    fileName: document.getElementById('file-name'),

    statsSection: document.getElementById('stats-section'),
    shipName: document.getElementById('ship-name'),
    totalTons: document.getElementById('total-tons'),
    totalSqm: document.getElementById('total-sqm'),
    totalCost: document.getElementById('total-cost'),

    floorConfigSection: document.getElementById('floor-config-section'),
    hullShape: document.getElementById('hull-shape'),
    hullShapeNote: document.getElementById('hull-shape-note'),
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

    // Update ship name if available
    if (shipData.shipName) {
        elements.shipName.textContent = shipData.shipName;
        elements.shipName.style.display = 'block';
    } else {
        elements.shipName.style.display = 'none';
    }

    elements.totalTons.textContent = shipData.totalTons.toLocaleString();
    elements.totalSqm.textContent = Math.round(totalArea).toLocaleString();
    elements.totalCost.textContent = shipData.totalCost.toLocaleString();
}

/**
 * Fill the hull shape dropdown, grouped by general class
 */
function populateHullShapes() {
    const groups = { standard: 'Standard', streamlined: 'Streamlined' };
    elements.hullShape.innerHTML = '';
    for (const [general, label] of Object.entries(groups)) {
        const group = document.createElement('optgroup');
        group.label = label;
        for (const [shape, definition] of Object.entries(HULL_SHAPES)) {
            if (definition.general !== general) continue;
            const option = document.createElement('option');
            option.value = shape;
            option.textContent = definition.label;
            group.appendChild(option);
        }
        elements.hullShape.appendChild(group);
    }
}

/**
 * Text beside the hull shape dropdown, relating it to the design file
 */
function getHullShapeNote() {
    const { shape, text } = shipData.configuration;
    if (shape === 'distributed') return 'This design is Distributed, which isn\'t available yet';
    if (!text) return '';
    return shape === shipData.hullShape ? 'From the design file' : `Design file: ${text}`;
}

/**
 * Update floor configuration display
 */
function updateFloorConfig() {
    const { floorArea, floorWidth } = getCurrentFloorDimensions();
    const { freeLength } = HULL_SHAPES[resolveHullShape(shipData.hullShape)];
    const areas = getFloorAreaRange();
    const smallest = Math.round(areas.min);
    const largest = Math.round(areas.max);

    elements.hullShape.value = resolveHullShape(shipData.hullShape);
    elements.hullShapeNote.textContent = getHullShapeNote();
    elements.floorCount.textContent = shipData.numFloors;
    if (shipData.numFloors > parseInt(elements.floorSlider.max, 10)) elements.floorSlider.max = shipData.numFloors;
    elements.floorSlider.value = shipData.numFloors;
    elements.floorLength.value = freeLength ? shipData.floorLength : shipData.floorLength.toFixed(1);
    elements.floorLength.disabled = !freeLength;
    elements.floorDimensions.disabled = !freeLength;
    elements.ceilingHeight.value = shipData.ceilingHeight;
    elements.sqmPerFloor.textContent = smallest === largest
        ? largest.toLocaleString()
        : `${smallest.toLocaleString()} to ${largest.toLocaleString()}`;
    elements.floorWidth.textContent = floorWidth.toFixed(1);

    // Update dimension dropdown
    updateDimensionDropdown(floorArea);
}

/**
 * Update the dimension dropdown options
 */
function updateDimensionDropdown(floorArea) {
    const options = getHullDimensionOptions(floorArea);

    // Keep the current length even when it isn't one of the suggestions (typed
    // in, the default, or restored from a layout): show it as a custom option
    // rather than silently snapping, which would move the floor edges under
    // placed components and leave the armor thickness calculated for another length
    const current = shipData.floorLength;
    if (current > 0 && !options.some(opt => Math.abs(opt.length - current) < 0.05)) {
        const width = getFrameWidthAtLength(current);
        const isDefault = shipData.hullShape !== 'rectangular' && current === getDefaultHullLength(
            shipData.hullShape, getCurrentFloorDimensions().totalArea, shipData.numFloors);
        options.push({
            length: current,
            width,
            label: `${Number(current.toFixed(1))} × ${width.toFixed(1)} m (${isDefault ? 'default' : 'custom'})`
        });
        options.sort((a, b) => a.length - b.length);
    }

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

    // Select the option matching the current length (never change the length here)
    if (options.length > 0) {
        elements.floorDimensions.selectedIndex = closestIndex;
    }
}

/**
 * Marks the ends of the stack, since a shaped hull changes from bottom to top
 */
function getFloorPositionLabel(floor) {
    if (shipData.numFloors < 2) return '';
    if (floor === 1) return ' (bottom)';
    return floor === shipData.numFloors ? ' (top)' : '';
}

/**
 * Render floor list with canvas visualizations
 */
function renderFloors() {
    const { floorWidth, floorLength } = getCurrentFloorDimensions();

    // Canvases are rebuilt and placements may have been cleared
    cancelRegionFill();

    elements.floorList.innerHTML = '';

    const unusableFloors = getUnusableFloors();
    const { shape, floors } = getShipGeometry();
    const isShaped = shape !== 'rectangular';

    for (let i = 1; i <= shipData.numFloors; i++) {
        const floorItem = document.createElement('div');
        floorItem.className = 'floor-item';

        // Create floor info section
        const floorInfo = document.createElement('div');
        floorInfo.className = 'floor-info';
        floorInfo.innerHTML = `
            <div class="floor-number">${i}</div>
            <div class="floor-details">
                <div class="floor-name">Floor ${i}${isShaped ? getFloorPositionLabel(i) : ''}</div>
                <div class="floor-dimensions">${isShaped
                    ? describeFloorSize(floors[i - 1], shape)
                    : `${floorLength} × ${floorWidth.toFixed(1)} meters`}, ${shipData.ceilingHeight} meters tall</div>
                <div class="floor-free" id="floor-free-${i}"></div>
                ${unusableFloors.includes(i) ? '<div class="floor-warning">⚠️ No usable space: the armor fills this floor</div>' : ''}
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

    // Setup resize handlers on all canvases
    for (let i = 1; i <= shipData.numFloors; i++) {
        const canvas = document.getElementById(`floor-canvas-${i}`);
        if (canvas) {
            setupResizeHandlers(canvas, i);
        }
    }

    // Setup floor selector with updated floor count
    setupFloorSelector();
}

/**
 * Render components list with click handlers
 */
function renderComponents() {
    elements.componentsList.innerHTML = '';

    // Staterooms + rec/health per floor (when combined) and the combine toggle
    const accommodations = renderAccommodationsPanel();

    shipData.components.forEach((component, index) => {
        // Rec/health items combined with staterooms aren't placed by hand
        if (component.combinedWithStaterooms) {
            elements.componentsList.appendChild(createCombinedRecHealthItem(component, index, accommodations));
            return;
        }

        // Count how many of this component are placed (blocks and regions hold several)
        const placement = shipData.componentPlacements[index];
        const placedCount = getPlacedCount(placement);
        const totalQuantity = component.quantity || 1;
        const remainingCount = totalQuantity - placedCount;
        const placedByTons = canTakeIrregularSpace(component);
        const isFullyPlaced = isComponentFullyPlaced(component, placement);

        // Skip fully placed single-item components
        if (isFullyPlaced && (totalQuantity === 1 || placedByTons)) {
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
            if (placedByTons) {
                const byFloor = getPlacedTonsByFloor(placement);
                const breakdown = Object.keys(byFloor)
                    .sort((a, b) => a - b)
                    .map(f => `F${f}: ${byFloor[f].toFixed(1)}`)
                    .join(', ');
                placementInfo = `<div class="component-placement-info">📍 Placed ${getPlacedTons(placement).toFixed(1)} of ${component.tons} tons` +
                    ` <span class="component-floor-breakdown">(${breakdown})</span></div>`;
            } else if (totalQuantity > 1) {
                // Per-floor breakdown helps account for items split across floors
                const byFloor = getPlacedCountByFloor(placement);
                const breakdown = Object.keys(byFloor)
                    .sort((a, b) => a - b)
                    .map(f => `F${f}: ${byFloor[f]}`)
                    .join(', ');
                placementInfo = `<div class="component-placement-info">📍 Placed ${placedCount} of ${totalQuantity}` +
                    `${breakdown ? ` <span class="component-floor-breakdown">(${breakdown})</span>` : ''}</div>`;
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
                <span>${formatComponentTons(component)}</span>
                <span>💰 ${component.cost.toLocaleString()} MCr</span>
                ${requiresHullAccess(component) ? '<span class="hull-badge" title="Needs access to space: must touch the outer hull">🛰️ Hull</span>' : ''}
                ${placedByTons ? '<span class="hull-badge" title="Can fill irregular free space, split across areas and floors">🧩 Any shape</span>' : ''}
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
// CSV Loading Functions
// ========================================

/**
 * Set the hull shape, moving to its natural floor count if it has one
 * @param {string} shape - Shape from the design file or the dropdown
 */
function applyHullShape(shape) {
    shipData.hullShape = resolveHullShape(shape);
    const natural = getNaturalFloorCount(shipData.hullShape, shipData.totalTons, shipData.ceilingHeight);
    if (natural !== null) shipData.numFloors = natural;
}

/**
 * Load and process CSV data from a string
 * @param {string} csvString - CSV content as string
 * @param {string} source - Source description for logging (e.g., "URL", "file")
 * @param {string} filename - Optional filename (used for ship name)
 */
function loadCsvFromString(csvString, source = 'unknown', filename = '') {
    try {
        const parsed = parseCSV(csvString, filename);

        if (!parsed.components || parsed.components.length === 0) {
            throw new Error('No valid components found in CSV data');
        }

        // Extract armor tonnage and filter out items that don't need manual placement
        let armorTons = 0;
        const originalCount = parsed.components.length;
        const filteredComponents = parsed.components.filter(component => {
            // Remove Hull category - the hull IS the ship itself
            if (component.category.toLowerCase() === 'hull') {
                console.log(`Skipping Hull component (hull is the ship structure itself): ${component.item} (${component.tons} tons)`);
                return false;
            }
            // Extract and remove Armor category - armor is applied as boundary layer
            if (component.category.toLowerCase() === 'armor') {
                armorTons += component.tons;
                console.log(`Extracting Armor component (will be applied as boundary layer): ${component.item} (${component.tons} tons)`);
                return false;
            }
            // Remove items with 0 tons (or invalid/negative values)
            if (!component.tons || component.tons <= 0) {
                console.log(`Skipping zero-ton item: ${component.category} - ${component.item} (${component.tons} tons)`);
                return false;
            }
            return true;
        });

        // Log if any items were filtered out
        if (filteredComponents.length < originalCount) {
            console.log(`Filtered out ${originalCount - filteredComponents.length} items (Hull, Armor: ${armorTons} tons, and zero-ton items)`);
        }

        // Check if we have any valid components left
        if (filteredComponents.length === 0) {
            throw new Error('No valid components found after filtering (all items had 0 tons)');
        }

        // Update state
        shipData.shipName = parsed.shipName || '';
        shipData.totalTons = parsed.totalTons;
        shipData.totalCost = parsed.totalCost;
        shipData.configuration = parsed.configuration;
        shipData.components = filteredComponents;
        shipData.armorTons = armorTons;
        shipData.componentPlacements = {}; // Reset placements
        shipData.combineRecHealth = false; // New components start uncombined
        shipData.originalCsv = csvString; // Preserve raw CSV so share URL round-trips correctly

        // Shape from the design file, default floor length, and armor thickness
        applyHullShape(parsed.configuration.shape);
        recalculateFloors({ resetLength: true });

        // Show sections and refresh UI
        showSections();
        refreshUI();

        console.log(`Loaded ${filteredComponents.length} components from ${source} (${shipData.totalTons} tons)`);
        return true;
    } catch (error) {
        console.error(`Error loading CSV from ${source}:`, error);
        throw error; // Re-throw for caller to handle
    }
}

/**
 * Check for CSV data in URL parameters and load if present
 * @returns {boolean} True if CSV was loaded from URL, false otherwise
 */
function checkForUrlCsvData() {
    const urlParams = new URLSearchParams(window.location.search);
    const csvData = urlParams.get('csv');

    if (csvData) {
        try {
            // URL decode the CSV data
            const decodedCsv = decodeURIComponent(csvData);

            // Parse and load the CSV
            loadCsvFromString(decodedCsv, 'URL');

            // Hide the file upload section
            const uploadSection = document.getElementById('upload-section');
            if (uploadSection) {
                uploadSection.style.display = 'none';
            }

            return true; // CSV loaded from URL
        } catch (error) {
            console.error('Error loading CSV from URL:', error);
            alert('Error loading CSV data from URL: ' + error.message + '\n\nPlease upload a file instead.');
            return false;
        }
    }

    return false; // No CSV in URL
}

/**
 * Convert components array back to CSV string format
 * @param {Array} components - Array of component objects
 * @param {string} shipName - Optional ship name to include in CSV
 * @param {number} totalTons - Total tonnage for small craft format
 * @param {number} totalCost - Total cost for small craft format
 * @returns {string} CSV formatted string
 */
function escapeCsvField(value) {
    value = String(value);
    if (value.includes('"') || value.includes(',') || value.includes('\n')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

function generateCsvString(components, shipName = '', totalTons = 0, totalCost = 0) {
    let csv = '';

    if (shipName) {
        csv += `Name,${escapeCsvField(shipName)}\n`;
        csv += `Hull,${totalTons} tons,${totalCost} MCr\n`;
        csv += '\n';
        csv += 'Category,Item,Tons,Cost (MCr)\n';
    } else {
        csv += 'Category,Item,Tons,Cost\n';
    }

    components.forEach(c => {
        csv += `${escapeCsvField(c.category)},${escapeCsvField(c.item)},${c.tons},${c.cost}\n`;
    });
    return csv;
}

/**
 * Generate a shareable URL with current ship design
 */
function generateShareableUrl() {
    if (!shipData.components || shipData.components.length === 0) {
        alert('No ship data to share. Please load a CSV first.');
        return;
    }

    try {
        // Use the original CSV if available so hull/armor data round-trips correctly
        const csvString = shipData.originalCsv ||
            generateCsvString(shipData.components, shipData.shipName, shipData.totalTons, shipData.totalCost);

        // URL encode the CSV data
        const encodedCsv = encodeURIComponent(csvString);

        // Generate URL
        const baseUrl = window.location.href.split('?')[0]; // Remove existing params
        const shareUrl = `${baseUrl}?csv=${encodedCsv}`;

        // Check if URL is too long (browser limit ~2000 chars)
        if (shareUrl.length > 2000) {
            alert('Warning: The generated URL is very long (' + shareUrl.length + ' characters).\n\n' +
                'Some browsers may have issues with URLs longer than 2000 characters.\n' +
                'Consider uploading the CSV file instead of using a URL for very large ship designs.');
        }

        // Copy to clipboard
        navigator.clipboard.writeText(shareUrl).then(() => {
            alert('Shareable URL copied to clipboard!\n\nShare this URL to let others view this ship design.');
            console.log('Shareable URL:', shareUrl);
        }).catch((err) => {
            // Fallback: show URL in a prompt for manual copying
            console.error('Clipboard API failed:', err);
            prompt('Copy this URL to share (Ctrl+C, then press OK):', shareUrl);
        });
    } catch (error) {
        console.error('Error generating shareable URL:', error);
        alert('Error generating shareable URL: ' + error.message);
    }
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
            loadCsvFromString(e.target.result, `file: ${file.name}`, file.name);
        } catch (error) {
            alert('Error parsing CSV file: ' + error.message);
        }
    };
    reader.readAsText(file);
});

/**
 * Handle hull shape changes
 */
elements.hullShape.addEventListener('change', function (event) {
    endInteractiveModes();
    applyHullShape(event.target.value);

    // Default floor length and armor thickness for the new shape
    recalculateFloors({ resetLength: true });

    // Clear placements when the shape changes
    shipData.componentPlacements = {};

    refreshUI();
});

/**
 * Handle floor slider changes
 */
elements.floorSlider.addEventListener('input', function (event) {
    shipData.numFloors = parseInt(event.target.value, 10);

    // Default floor length and armor thickness for the new floor count
    recalculateFloors({ resetLength: true });

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
        recalculateFloors();

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
        recalculateFloors();

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
        recalculateFloors();

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
    populateHullShapes();

    // Check for CSV data in URL parameters first
    const loadedFromUrl = checkForUrlCsvData();

    if (loadedFromUrl) {
        console.log('Loaded ship design from URL parameter');
    }

    // Setup share button
    const shareButton = document.getElementById('share-button');
    if (shareButton) {
        shareButton.addEventListener('click', generateShareableUrl);
    }

    setupComponentModalEvents();
    setupCombineRecHealthEvents();
    setupLayoutEvents();
    initializeFloorSelector();
    console.log('🚀 Starship Architect initialized');
});
