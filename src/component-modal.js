/**
 * Starship Architect - Component Modal Module
 * Handles component modal UI (showing/hiding, populating dropdowns, form handling)
 *
 * Dependencies:
 * - component-dimensions.js (dimension calculation)
 * - floor-utils.js (getCurrentFloorDimensions)
 * - placement-controller.js (placement orchestration happens there)
 * - undo-redo.js (history management)
 * - bulk-allocation.js (block / fill-floor / fill-region / fill-exposed allocation modes)
 * - hull-access.js (requiresHullAccess: weapons, vehicles, launch bays go on the hull)
 */

// ========================================
// Modal Management
// ========================================

/**
 * Update dimension options and area display based on selected floors
 */
function updateDimensionOptions() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex);
    const component = shipData.components[componentIndex];

    if (!component) return;

    // Get selected floors
    let selectedFloors;
    if (modal.dataset.isMultiFloor === 'true') {
        selectedFloors = Array.from(document.querySelectorAll('input[name="component-floors"]:checked'))
            .map(cb => parseInt(cb.value, 10));
    } else {
        selectedFloors = [parseInt(document.getElementById('component-floor-select').value, 10)];
    }

    // Need at least 1 floor selected
    if (selectedFloors.length === 0 || selectedFloors.some(isNaN)) {
        selectedFloors = getSuggestedFloors(1);
    }
    const numSelectedFloors = selectedFloors.length;

    // Recalculate dimensions with selected floors
    const dimInfo = getDeckDimensionOptions(
        getPlacementTarget(component, shipData.componentPlacements[componentIndex]),
        selectedFloors,
        numSelectedFloors
    );

    // Update dimension dropdown
    const dimSelect = document.getElementById('component-dimensions');
    dimSelect.innerHTML = '';
    for (const opt of dimInfo.options) {
        const option = document.createElement('option');
        option.value = `${opt.length},${opt.width}`;
        option.textContent = opt.label;
        dimSelect.appendChild(option);
    }

    // Say why there is nothing to choose, rather than offering nothing
    const note = document.getElementById('dimensions-note');
    if (dimInfo.options.length === 0) {
        const floorText = numSelectedFloors === 1
            ? `Floor ${selectedFloors[0]}`
            : `the space shared by floors ${selectedFloors.join(', ')}`;
        note.textContent = `No rectangle of ${dimInfo.areaPerFloor.toFixed(1)} m² fits ${floorText}. ` +
            (modal.dataset.isMultiFloor === 'true' ? 'Try other floors, or span more floors.' : 'Try a larger floor.') +
            (canTakeIrregularSpace(component) ? ' Or fill free space instead, which can take any shape.' : '');
        note.classList.remove('hidden');
        setPlaceButton('Place Component', false);
    } else {
        note.textContent = '';
        note.classList.add('hidden');
        setPlaceButton('Place Component', true);
    }

    // Update area display
    updateAreaDisplay(dimInfo.componentArea, numSelectedFloors, dimInfo.areaPerFloor);
}

/**
 * Text for a floor in the floor dropdown: a shaped hull's floors differ, so show their size
 */
function getFloorOptionLabel(floorIndex) {
    if (!getShapedInner(floorIndex)) return `Floor ${floorIndex}`;
    return `Floor ${floorIndex} (${getUsableFloorArea(floorIndex).toFixed(0)} m²)`;
}

/**
 * Update the area display section
 */
function updateAreaDisplay(totalArea, numFloors, areaPerFloor) {
    const display = document.getElementById('modal-area-display');
    if (numFloors > 1) {
        display.innerHTML = `
            <div class="area-info">
                Total: ${totalArea.toFixed(1)} m² across ${numFloors} floors
                (${areaPerFloor.toFixed(1)} m² per floor)
            </div>
        `;
        display.classList.remove('hidden');
    } else {
        display.innerHTML = '';
        display.classList.add('hidden');
    }
}

/**
 * Open the component dimension modal
 * @param {number} componentIndex - Index of the component in shipData.components
 */
function openComponentModal(componentIndex) {
    const component = shipData.components[componentIndex];
    if (!component) return;

    // Opening a new component ends any region picking in progress
    cancelRegionFill();

    uiState.selectedComponent = componentIndex;

    const dimInfo = getDeckDimensionOptions(
        getPlacementTarget(component, shipData.componentPlacements[componentIndex]),
        getSuggestedFloors(1)[0]
    );

    // Populate modal
    const modal = document.getElementById('component-modal');
    const modalTitle = document.getElementById('modal-component-name');
    const modalStats = document.getElementById('modal-component-stats');
    const dimSelect = document.getElementById('component-dimensions');
    const floorSelect = document.getElementById('component-floor-select');
    const multiFloorSection = document.getElementById('multi-floor-section');

    modalTitle.textContent = component.item;
    modalStats.innerHTML = `
        <span>${formatComponentTons(component)}</span>
        <span>📐 ${dimInfo.componentArea.toFixed(1)} m²${(component.quantity || 1) > 1 ? ' each' : ''}</span>
        <span>💰 ${component.cost.toLocaleString()} MCr</span>
        ${requiresHullAccess(component) ? '<span class="hull-badge" title="Needs access to space: must touch the outer hull">🛰️ Outer hull</span>' : ''}
    `;

    // The dimension dropdown is filled once the floors are chosen, below
    dimSelect.innerHTML = '';

    // Calculate size category for better user guidance
    const areaRatio = dimInfo.componentArea / dimInfo.floorArea;
    const isMultiFloorRequired = areaRatio > 1.0;
    const isLargeItem = areaRatio > 0.25 && areaRatio <= 1.0;

    // Show multi-floor section for either required multi-floor OR large items
    if (dimInfo.isMultiFloor || isLargeItem) {
        multiFloorSection.classList.remove('hidden');
        document.getElementById('floors-needed').textContent = dimInfo.floorsNeeded;

        // Show appropriate hint message
        const floorHint = document.getElementById('floor-selection-hint');
        const multiFloorNotice = document.querySelector('.multi-floor-notice');

        if (isMultiFloorRequired) {
            // Component MUST span multiple floors
            floorHint.textContent = `This component requires ${dimInfo.floorsNeeded} floors.`;
            floorHint.classList.remove('hidden');
            multiFloorNotice.classList.remove('hidden');
        } else if (isLargeItem) {
            // Large component that COULD span multiple floors
            floorHint.textContent = 'Large items may fit better if split across multiple floors; choose one or more floors for this item.';
            floorHint.classList.remove('hidden');
            multiFloorNotice.classList.add('hidden');
        } else {
            // Normal multi-floor handling
            floorHint.classList.add('hidden');
            multiFloorNotice.classList.remove('hidden');
        }

        // Create floor checkboxes
        const floorCheckboxes = document.getElementById('floor-checkboxes');
        floorCheckboxes.innerHTML = '';
        for (let i = 1; i <= shipData.numFloors; i++) {
            const label = document.createElement('label');
            label.className = 'floor-checkbox-label';
            label.innerHTML = `
                <input type="checkbox" name="component-floors" value="${i}">
                ${getFloorOptionLabel(i)}
            `;
            floorCheckboxes.appendChild(label);
        }

        // Add change listeners to floor checkboxes
        document.querySelectorAll('input[name="component-floors"]').forEach(checkbox => {
            checkbox.addEventListener('change', updateDimensionOptions);
        });

        // Auto-select floors based on component type
        if (isMultiFloorRequired) {
            // Auto-check the minimum required floors
            for (const i of getSuggestedFloors(dimInfo.floorsNeeded)) {
                const checkbox = document.querySelector(`input[name="component-floors"][value="${i}"]`);
                if (checkbox) checkbox.checked = true;
            }
            // Initialize area display with minimum floors needed
            updateAreaDisplay(dimInfo.componentArea, dimInfo.floorsNeeded, dimInfo.areaPerFloor);
        } else {
            // For large items, only check one floor by default (user can add more)
            const firstCheckbox = document.querySelector(`input[name="component-floors"][value="${getSuggestedFloors(1)[0]}"]`);
            if (firstCheckbox) firstCheckbox.checked = true;
            updateAreaDisplay(dimInfo.componentArea, 1, dimInfo.componentArea);
        }

        floorSelect.classList.add('hidden');
    } else {
        multiFloorSection.classList.add('hidden');
        floorSelect.classList.remove('hidden');

        // Populate single floor select
        floorSelect.innerHTML = '';
        for (let i = 1; i <= shipData.numFloors; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = getFloorOptionLabel(i);
            floorSelect.appendChild(option);
        }
        floorSelect.value = getSuggestedFloors(1)[0];

        // Hide area display for single-floor components
        document.getElementById('modal-area-display').classList.add('hidden');
    }

    // Store metadata for placement
    modal.dataset.isMultiFloor = dimInfo.isMultiFloor || isLargeItem;
    modal.dataset.floorsNeeded = isMultiFloorRequired ? dimInfo.floorsNeeded : 1;
    modal.dataset.isLargeItem = isLargeItem;
    modal.dataset.componentIndex = componentIndex;

    // Allocation options for multi-quantity components (blocks, fill floor, fill region)
    setupAllocationSection(componentIndex);

    // Show modal
    modal.classList.remove('hidden');
}

/**
 * Close the component modal (without canceling placement mode)
 */
function closeComponentModal() {
    const modal = document.getElementById('component-modal');
    modal.classList.add('hidden');
    uiState.selectedComponent = null;
}

/**
 * Start placement mode
 */
function startPlacement() {
    const modal = document.getElementById('component-modal');
    const componentIndex = parseInt(modal.dataset.componentIndex);

    // Bulk modes that don't need a rectangle placed by clicking
    const mode = getAllocationMode();
    if (mode === 'fill-floor') {
        executeFloorFill();
        return;
    }
    if (mode === 'fill-region') {
        startRegionFillFromModal();
        return;
    }
    if (mode === 'fill-exposed') {
        executeExposedFill();
        return;
    }
    const isBlock = mode === 'block';
    const blockCount = isBlock ? getBlockCount(componentIndex) : 1;

    const dimSelect = document.getElementById('component-dimensions');
    const dimValue = dimSelect.value;
    const parts = dimValue.split(',');
    const length = parseFloat(parts[0]);
    const width = parseFloat(parts[1]);

    if (isNaN(length) || isNaN(width) || length <= 0 || width <= 0) {
        alert('Invalid dimensions selected. Please select valid dimensions.');
        return;
    }

    // Determine which floors (blocks always go on the single selected floor)
    let selectedFloors = [];
    const isMultiFloor = !isBlock && modal.dataset.isMultiFloor === 'true';
    if (isMultiFloor) {
        const checkboxes = document.querySelectorAll('input[name="component-floors"]:checked');
        selectedFloors = Array.from(checkboxes).map(cb => parseInt(cb.value));

        const floorsNeeded = parseInt(modal.dataset.floorsNeeded);
        const isLargeItem = modal.dataset.isLargeItem === 'true';

        // For required multi-floor components, enforce minimum floor count
        // For large items, just require at least one floor
        if (!isLargeItem && selectedFloors.length < floorsNeeded) {
            alert(`Please select at least ${floorsNeeded} floors for this component.`);
            return;
        } else if (selectedFloors.length < 1) {
            alert('Please select at least one floor for this component.');
            return;
        }
    } else {
        const floorSelect = document.getElementById('component-floor-select');
        selectedFloors = [parseInt(floorSelect.value)];
    }

    // Store placement info
    uiState.isPlacingComponent = true;
    uiState.placementData = {
        componentIndex,
        length,
        width,
        count: blockCount,
        floors: selectedFloors,
        currentFloorIndex: 0,
        isMultiFloor: isMultiFloor
    };

    // Auto-select the first floor in the floor selector dropdown
    if (selectedFloors.length > 0) {
        setFloorSelector(selectedFloors[0]);
    }

    // Close modal and enable canvas clicks
    closeComponentModal();

    // Add placement-mode class to relevant canvases
    for (const floor of selectedFloors) {
        const canvas = document.getElementById(`floor-canvas-${floor}`);
        if (canvas) {
            canvas.classList.add('placement-mode');
        }
    }

    // Show placement instructions
    const component = shipData.components[componentIndex];
    const totalQuantity = component.quantity || 1;
    if (blockCount > 1) {
        showBlockPlacementInstructions(selectedFloors, component.itemName || component.item, blockCount);
    } else if (totalQuantity > 1) {
        const remaining = totalQuantity - getPlacedCount(shipData.componentPlacements[componentIndex]);
        showPlacementInstructionsMulti(selectedFloors, component.itemName || component.item, remaining, totalQuantity);
    } else {
        showPlacementInstructions(selectedFloors);
    }
}

// ========================================
// Placement Instructions UI
// ========================================

/**
 * Extra instruction text when the component being placed must touch the hull
 */
function hullPlacementHint() {
    const data = uiState.placementData;
    const component = data && shipData.components[data.componentIndex];
    return requiresHullAccess(component) ? ' It must touch the outer hull and snaps to the nearest hull side.' : '';
}

/**
 * Show placement instructions
 */
function showPlacementInstructions(floors) {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }

    const floorText = floors.length === 1
        ? `Floor ${floors[0]}`
        : `Floors ${floors.join(', ')}`;

    instructions.textContent = `Click on ${floorText} to place the component.${hullPlacementHint()} Press Escape to cancel.`;
    instructions.classList.remove('hidden');
}

/**
 * Show placement instructions for multi-quantity components
 */
function showPlacementInstructionsMulti(floors, itemName, remaining, total) {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }

    const placed = total - remaining;
    instructions.textContent = `Placing ${itemName} (${placed + 1} of ${total}). Click any floor to place.${hullPlacementHint()} Press Escape to cancel.`;
    instructions.classList.remove('hidden');
}

/**
 * Show placement instructions for a block of several items
 */
function showBlockPlacementInstructions(floors, itemName, count) {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }

    const floorText = floors.length === 1 ? `Floor ${floors[0]}` : 'a floor';
    instructions.textContent = `Click on ${floorText} to place a block of ${count} ${itemName}.${hullPlacementHint()} Press Escape to cancel.`;
    instructions.classList.remove('hidden');
}

// ========================================
// Event Listeners Setup
// ========================================

/**
 * Set up modal event listeners
 */
function setupComponentModalEvents() {
    // Close button
    document.getElementById('modal-close-btn').addEventListener('click', closeComponentModal);

    // Cancel button
    document.getElementById('modal-cancel-btn').addEventListener('click', closeComponentModal);

    // Place button
    document.getElementById('modal-place-btn').addEventListener('click', startPlacement);

    // Allocation mode controls (multi-quantity components)
    setupAllocationEvents();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape priority: resize → selection → region fill → placement → modal
        if (e.key === 'Escape') {
            if (resizeState && resizeState.isResizing) {
                cancelResize();
            } else if (uiState.selectedPlacement) {
                cancelSelection();
            } else if (uiState.regionFill) {
                cancelRegionFill();
            } else if (uiState.isPlacingComponent) {
                cancelPlacement();
            } else {
                closeComponentModal();
            }
        }

        // Ctrl+Shift+Z to redo
        if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
            e.preventDefault();
            redoLastPlacement();
            return;
        }

        // Ctrl+Z to undo last placement
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undoLastPlacement();
            return;
        }

        // Delete or Backspace to delete selected component
        if ((e.key === 'Delete' || e.key === 'Backspace') && uiState.selectedPlacement) {
            e.preventDefault();
            deleteSelectedComponent();
            return;
        }

        // R to rotate right, L to rotate left
        if ((e.key === 'r' || e.key === 'R' || e.key === 'l' || e.key === 'L') && uiState.selectedPlacement) {
            e.preventDefault();
            rotateSelectedComponent();
        }
    });

    // Click outside modal to close
    document.getElementById('component-modal').addEventListener('click', (e) => {
        if (e.target.id === 'component-modal') {
            closeComponentModal();
        }
    });
}
