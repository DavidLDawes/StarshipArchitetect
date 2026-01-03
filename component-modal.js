/**
 * Starship Architect - Component Modal Module
 * Handles component modal UI (showing/hiding, populating dropdowns, form handling)
 *
 * Dependencies:
 * - component-dimensions.js (dimension calculation)
 * - floor-utils.js (getCurrentFloorDimensions)
 * - placement-controller.js (placement orchestration happens there)
 * - undo-redo.js (history management)
 */

// ========================================
// Modal Management
// ========================================

/**
 * Open the component dimension modal
 * @param {number} componentIndex - Index of the component in shipData.components
 */
function openComponentModal(componentIndex) {
    const component = shipData.components[componentIndex];
    if (!component) return;

    uiState.selectedComponent = componentIndex;

    const { floorArea, floorWidth, floorLength } = getCurrentFloorDimensions();

    const dimInfo = generateComponentDimensionOptions(
        component, floorArea, floorLength, floorWidth
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
        <span>📦 ${component.tons} tons</span>
        <span>📐 ${dimInfo.componentArea.toFixed(1)} m²</span>
        <span>💰 ${component.cost.toLocaleString()} MCr</span>
    `;

    // Populate dimension dropdown
    dimSelect.innerHTML = '';
    for (const opt of dimInfo.options) {
        const option = document.createElement('option');
        option.value = `${opt.length},${opt.width}`;
        option.textContent = opt.label;
        dimSelect.appendChild(option);
    }

    // Handle multi-floor components
    if (dimInfo.isMultiFloor) {
        multiFloorSection.classList.remove('hidden');
        document.getElementById('floors-needed').textContent = dimInfo.floorsNeeded;

        // Create floor checkboxes
        const floorCheckboxes = document.getElementById('floor-checkboxes');
        floorCheckboxes.innerHTML = '';
        for (let i = 1; i <= shipData.numFloors; i++) {
            const label = document.createElement('label');
            label.className = 'floor-checkbox-label';
            label.innerHTML = `
                <input type="checkbox" name="component-floors" value="${i}">
                Floor ${i}
            `;
            floorCheckboxes.appendChild(label);
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
            option.textContent = `Floor ${i}`;
            floorSelect.appendChild(option);
        }
    }

    // Store metadata for placement
    modal.dataset.isMultiFloor = dimInfo.isMultiFloor;
    modal.dataset.floorsNeeded = dimInfo.floorsNeeded;
    modal.dataset.componentIndex = componentIndex;

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
    const dimSelect = document.getElementById('component-dimensions');
    const dimValue = dimSelect.value;
    const parts = dimValue.split(',');
    const length = parseFloat(parts[0]);
    const width = parseFloat(parts[1]);

    if (isNaN(length) || isNaN(width) || length <= 0 || width <= 0) {
        alert('Invalid dimensions selected. Please select valid dimensions.');
        return;
    }

    // Determine which floors
    let selectedFloors = [];
    if (modal.dataset.isMultiFloor === 'true') {
        const checkboxes = document.querySelectorAll('input[name="component-floors"]:checked');
        selectedFloors = Array.from(checkboxes).map(cb => parseInt(cb.value));

        const floorsNeeded = parseInt(modal.dataset.floorsNeeded);
        if (selectedFloors.length < floorsNeeded) {
            alert(`Please select at least ${floorsNeeded} floors for this component.`);
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
        floors: selectedFloors,
        currentFloorIndex: 0,
        isMultiFloor: modal.dataset.isMultiFloor === 'true'
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
    if (totalQuantity > 1) {
        showPlacementInstructionsMulti(selectedFloors, component.itemName || component.item, totalQuantity, totalQuantity);
    } else {
        showPlacementInstructions(selectedFloors);
    }
}

// ========================================
// Placement Instructions UI
// ========================================

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

    instructions.textContent = `Click on ${floorText} to place the component. Press Escape to cancel.`;
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
    instructions.textContent = `Placing ${itemName} (${placed + 1} of ${total}). Click any floor to place. Press Escape to cancel.`;
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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape to cancel selection, placement, or close modal
        if (e.key === 'Escape') {
            if (uiState.selectedPlacement) {
                cancelSelection();
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
