/**
 * Starship Architect - Component Modal Module
 * Handles component modal UI and canvas click coordination
 * 
 * Dependencies:
 * - component-dimensions.js (dimension calculation)
 * - placement-logic.js (overlap, positioning)
 * - component-selection.js (selection, move, rotate, delete)
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

    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);

    const dimInfo = generateComponentDimensionOptions(
        component, floorArea, shipData.floorLength, floorWidth
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
// Canvas Click Handler
// ========================================

/**
 * Handle canvas click during placement or selection
 */
function handleCanvasPlacement(event, floorIndex) {
    // If we're moving a selected component
    if (uiState.selectedPlacement) {
        handleComponentMove(event, floorIndex);
        return;
    }

    // If not in placement mode, try to select a component
    if (!uiState.isPlacingComponent) {
        handleComponentSelection(event, floorIndex);
        return;
    }

    const data = uiState.placementData;
    if (!data.floors.includes(floorIndex)) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate floor dimensions
    const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
    const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
    const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);
    const floorLength = shipData.floorLength;
    const pixelsPerMeter = canvas.width / floorLength;

    // Get click position in pixels
    const clickPxX = (event.clientX - rect.left) * scaleX;
    const clickPxY = (event.clientY - rect.top) * scaleY;

    // Convert to meters
    const clickX = clickPxX / pixelsPerMeter;
    const clickY = clickPxY / pixelsPerMeter;

    // Component dimensions
    const compLength = data.length;
    const compWidth = data.width;

    // Calculate initial position (center component on click)
    let x = clickX - compLength / 2;
    let y = clickY - compWidth / 2;

    // Snap to edges
    if (clickX <= compLength) {
        x = 0;
    } else if (clickX >= floorLength - compLength) {
        x = floorLength - compLength;
    }

    if (clickY <= compWidth) {
        y = 0;
    } else if (clickY >= floorWidth - compWidth) {
        y = floorWidth - compWidth;
    }

    // Ensure component fits within floor bounds
    x = Math.max(0, Math.min(x, floorLength - compLength));
    y = Math.max(0, Math.min(y, floorWidth - compWidth));

    // Round to nearest meter for clean grid alignment
    x = Math.round(x);
    y = Math.round(y);

    // Try to find a valid position, adjusting if there's overlap
    const position = findValidPosition(
        floorIndex, x, y, compLength, compWidth,
        floorLength, floorWidth, -1
    );

    if (!position) {
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => { canvas.style.boxShadow = ''; }, 300);
        return;
    }

    x = position.x;
    y = position.y;

    // For multi-floor components, place on ALL selected floors at once
    if (data.isMultiFloor) {
        // Check overlap on ALL selected floors first
        let allValid = true;
        for (const f of data.floors) {
            if (!findValidPosition(f, x, y, compLength, compWidth, floorLength, floorWidth, -1)) {
                allValid = false;
                break;
            }
        }

        if (!allValid) {
            canvas.style.boxShadow = '0 0 20px red';
            setTimeout(() => { canvas.style.boxShadow = ''; }, 300);
            return;
        }

        // Place on all selected floors at the same position
        if (!shipData.componentPlacements[data.componentIndex]) {
            shipData.componentPlacements[data.componentIndex] = { floors: [] };
        }

        for (const f of data.floors) {
            shipData.componentPlacements[data.componentIndex].floors.push({
                floor: f, x: x, y: y, length: compLength, width: compWidth
            });

            // Record in history for undo
            uiState.placementHistory.push({
                componentIndex: data.componentIndex, floor: f,
                x: x, y: y, length: compLength, width: compWidth
            });

            // Redraw each floor
            const c = document.getElementById(`floor-canvas-${f}`);
            if (c) {
                drawFloorWithComponents(c, f, shipData.floorLength, floorWidth);
                c.classList.remove('placement-mode');
            }
        }

        uiState.redoHistory = [];
        finishPlacement();
        return;
    }

    // Store placement with individual dimensions (for single-floor components)
    if (!shipData.componentPlacements[data.componentIndex]) {
        shipData.componentPlacements[data.componentIndex] = { floors: [] };
    }

    shipData.componentPlacements[data.componentIndex].floors.push({
        floor: floorIndex, x: x, y: y, length: compLength, width: compWidth
    });

    // Record in history for undo
    uiState.placementHistory.push({
        componentIndex: data.componentIndex, floor: floorIndex,
        x: x, y: y, length: compLength, width: compWidth
    });
    uiState.redoHistory = [];

    // Check if more items to place (multi-quantity single-floor components)
    const component = shipData.components[data.componentIndex];
    const totalQuantity = component.quantity || 1;
    const placement = shipData.componentPlacements[data.componentIndex];
    const placedCount = placement ? placement.floors.length : 0;

    if (placedCount < totalQuantity) {
        renderComponents();
        data.floors = [];
        for (let i = 1; i <= shipData.numFloors; i++) {
            data.floors.push(i);
        }
        for (const floor of data.floors) {
            const c = document.getElementById(`floor-canvas-${floor}`);
            if (c) {
                drawFloorWithComponents(c, floor, shipData.floorLength, floorWidth);
                c.classList.add('placement-mode');
            }
        }
        const remaining = totalQuantity - placedCount;
        showPlacementInstructionsMulti(data.floors, component.itemName || component.item, remaining, totalQuantity);
    } else {
        const canvasEl = document.getElementById(`floor-canvas-${floorIndex}`);
        if (canvasEl) {
            drawFloorWithComponents(canvasEl, floorIndex, shipData.floorLength, floorWidth);
            canvasEl.classList.remove('placement-mode');
        }
        finishPlacement();
    }
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
