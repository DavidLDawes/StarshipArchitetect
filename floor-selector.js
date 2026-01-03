/**
 * Starship Architect - Floor Selector Module
 * Manages floor filtering/visibility via dropdown selector
 */

// ========================================
// Floor Selector Setup
// ========================================

/**
 * Setup the floor selector dropdown with current floor count
 * Called when floors are rendered or floor count changes
 */
function setupFloorSelector() {
    const selector = document.getElementById('floor-selector');
    if (!selector) return;

    const currentValue = selector.value;

    // Clear existing options except "All"
    selector.innerHTML = '<option value="all">All</option>';

    // Add option for each floor
    for (let i = 1; i <= shipData.numFloors; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Floor ${i}`;
        selector.appendChild(option);
    }

    // Restore previous selection if still valid
    if (currentValue !== 'all') {
        const floorNum = parseInt(currentValue);
        if (floorNum >= 1 && floorNum <= shipData.numFloors) {
            selector.value = currentValue;
        } else {
            selector.value = 'all';
        }
    }

    // Apply current filter
    filterFloorDisplay(selector.value);
}

/**
 * Set floor selector to a specific floor
 * @param {number|string} floorNumber - Floor number to select, or 'all'
 */
function setFloorSelector(floorNumber) {
    const selector = document.getElementById('floor-selector');
    if (!selector) return;

    selector.value = String(floorNumber);
    filterFloorDisplay(String(floorNumber));
}

// ========================================
// Floor Display Filtering
// ========================================

/**
 * Show/hide floor canvases based on selected value
 * @param {string} selectedValue - 'all' or floor number as string
 */
function filterFloorDisplay(selectedValue) {
    const floorItems = document.querySelectorAll('.floor-item');

    if (selectedValue === 'all') {
        // Show all floors
        floorItems.forEach(item => {
            item.style.display = '';
        });
    } else {
        // Show only selected floor
        const selectedFloorNum = parseInt(selectedValue);
        floorItems.forEach((item, index) => {
            const floorNum = index + 1;
            if (floorNum === selectedFloorNum) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }
}

// ========================================
// Event Listeners
// ========================================

/**
 * Initialize floor selector event listener
 * Called once during app initialization
 */
function initializeFloorSelector() {
    const selector = document.getElementById('floor-selector');
    if (!selector) return;

    selector.addEventListener('change', (event) => {
        filterFloorDisplay(event.target.value);
    });
}
