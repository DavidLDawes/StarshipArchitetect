/**
 * Starship Architect - Component Selection Module
 * Handles component selection, moving, rotating, and deleting on the canvas
 */

// ========================================
// Component Selection
// ========================================

/**
 * Handle clicking on the canvas to select a component
 */
function handleComponentSelection(event, floorIndex) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate click position in meters
    const { floorWidth, floorLength } = getCurrentFloorDimensions();
    const pixelsPerMeter = canvas.width / floorLength;

    const clickPxX = (event.clientX - rect.left) * scaleX;
    const clickPxY = (event.clientY - rect.top) * scaleY;
    const clickX = clickPxX / pixelsPerMeter;
    const clickY = clickPxY / pixelsPerMeter;

    // Find component at click position
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        const compIdx = parseInt(compIdxStr);
        if (!placement.floors) continue;

        for (let i = 0; i < placement.floors.length; i++) {
            const pos = placement.floors[i];
            if (pos.floor !== floorIndex) continue;

            // Use per-placement dimensions (fallback to component-level)
            const pLength = pos.length || placement.length;
            const pWidth = pos.width || placement.width;

            // Check if click is inside this component
            if (clickX >= pos.x && clickX <= pos.x + pLength &&
                clickY >= pos.y && clickY <= pos.y + pWidth) {

                // Select this component
                uiState.selectedPlacement = {
                    componentIndex: compIdx,
                    floorIndex: floorIndex,
                    placementIndex: i,
                    length: pLength,
                    width: pWidth,
                    originalX: pos.x,
                    originalY: pos.y
                };

                // Add visual feedback
                canvas.classList.add('selection-mode');

                // Redraw with selection highlight
                drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
                drawSelectionHighlight(canvas, pos.x, pos.y, pLength, pWidth, pixelsPerMeter);

                // Show instructions
                showSelectionInstructions();

                return;
            }
        }
    }
}

/**
 * Draw selection highlight on a component
 */
function drawSelectionHighlight(canvas, x, y, length, width, pixelsPerMeter) {
    const ctx = canvas.getContext('2d');
    const px = x * pixelsPerMeter;
    const py = y * pixelsPerMeter;
    const pw = length * pixelsPerMeter;
    const ph = width * pixelsPerMeter;

    // Draw dashed selection border
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
    ctx.setLineDash([]);
}

/**
 * Show selection mode instructions
 */
function showSelectionInstructions() {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }
    instructions.textContent = 'Click to move | R/L to rotate | Delete to remove | Escape to cancel';
    instructions.classList.remove('hidden');
}

/**
 * Hide selection instructions
 */
function hideSelectionInstructions() {
    const instructions = document.getElementById('placement-instructions');
    if (instructions) {
        instructions.classList.add('hidden');
    }
}

/**
 * Cancel component selection
 */
function cancelSelection() {
    if (!uiState.selectedPlacement) return;

    const sel = uiState.selectedPlacement;
    uiState.selectedPlacement = null;

    // Clear drag preview
    clearPreview();

    // Remove visual feedback and redraw
    const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
    if (canvas) {
        canvas.classList.remove('selection-mode');
        const { floorWidth, floorLength } = getCurrentFloorDimensions();
        drawFloorWithComponents(canvas, sel.floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }

    hideSelectionInstructions();
}

// ========================================
// Component Moving
// ========================================

/**
 * Handle moving a selected component to a new position
 */
function handleComponentMove(event, floorIndex) {
    const sel = uiState.selectedPlacement;
    if (!sel) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate click position
    const { floorWidth, floorLength } = getCurrentFloorDimensions();
    const pixelsPerMeter = canvas.width / floorLength;

    const clickPxX = (event.clientX - rect.left) * scaleX;
    const clickPxY = (event.clientY - rect.top) * scaleY;
    let clickX = clickPxX / pixelsPerMeter;
    let clickY = clickPxY / pixelsPerMeter;

    // Center component on click
    let newX = clickX - sel.length / 2;
    let newY = clickY - sel.width / 2;

    // Clamp to floor bounds
    newX = Math.max(0, Math.min(newX, floorLength - sel.length));
    newY = Math.max(0, Math.min(newY, floorWidth - sel.width));

    // Round to nearest meter
    newX = Math.round(newX);
    newY = Math.round(newY);

    // Remove the old placement temporarily to check overlap
    const placement = shipData.componentPlacements[sel.componentIndex];
    const oldPlacement = placement.floors[sel.placementIndex];
    placement.floors.splice(sel.placementIndex, 1);

    // Check for overlap at new position
    const hasOverlap = checkOverlap(floorIndex, newX, newY, sel.length, sel.width, -1);

    if (hasOverlap) {
        // Restore old position and show error
        placement.floors.splice(sel.placementIndex, 0, oldPlacement);
        canvas.style.boxShadow = '0 0 20px red';
        setTimeout(() => {
            canvas.style.boxShadow = '';
        }, 300);
        return;
    }

    // Add at new position with same dimensions
    placement.floors.push({
        floor: floorIndex,
        x: newX,
        y: newY,
        length: sel.length,
        width: sel.width
    });

    // Clear selection and preview
    uiState.selectedPlacement = null;
    clearPreview();
    canvas.classList.remove('selection-mode');
    hideSelectionInstructions();

    // Redraw affected floors
    const oldCanvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
    if (oldCanvas && sel.floorIndex !== floorIndex) {
        drawFloorWithComponents(oldCanvas, sel.floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }
    drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
}

// ========================================
// Component Rotation
// ========================================

/**
 * Rotate the currently selected component (swap length and width)
 */
function rotateSelectedComponent() {
    const sel = uiState.selectedPlacement;
    if (!sel) return;

    const placement = shipData.componentPlacements[sel.componentIndex];
    if (!placement || !placement.floors) return;

    const pos = placement.floors[sel.placementIndex];
    if (!pos) return;

    // Calculate new rotated dimensions
    const newLength = sel.width;
    const newWidth = sel.length;

    // Calculate floor dimensions for bounds checking
    const { floorWidth, floorLength } = getCurrentFloorDimensions();

    // Check if rotated component would fit at current position
    let newX = pos.x;
    let newY = pos.y;

    // Adjust position if rotation would push it out of bounds
    if (newX + newLength > floorLength) {
        newX = floorLength - newLength;
    }
    if (newY + newWidth > floorWidth) {
        newY = floorWidth - newWidth;
    }
    newX = Math.max(0, newX);
    newY = Math.max(0, newY);

    // Temporarily remove to check overlap
    const oldPos = { ...pos };
    placement.floors.splice(sel.placementIndex, 1);

    // Check for overlap at new position with new dimensions
    const hasOverlap = checkOverlap(sel.floorIndex, newX, newY, newLength, newWidth, -1);

    if (hasOverlap) {
        // Restore old position and show error
        placement.floors.splice(sel.placementIndex, 0, oldPos);
        const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
        if (canvas) {
            canvas.style.boxShadow = '0 0 20px red';
            setTimeout(() => {
                canvas.style.boxShadow = '';
            }, 300);
        }
        return;
    }

    // Add rotated placement at new position with new dimensions
    placement.floors.push({
        floor: sel.floorIndex,
        x: newX,
        y: newY,
        length: newLength,
        width: newWidth
    });

    // Update selection state with new dimensions and position
    sel.length = newLength;
    sel.width = newWidth;
    sel.originalX = newX;
    sel.originalY = newY;
    sel.placementIndex = placement.floors.length - 1;

    // Redraw the floor
    const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
    if (canvas) {
        const pixelsPerMeter = canvas.width / floorLength;
        drawFloorWithComponents(canvas, sel.floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
        drawSelectionHighlight(canvas, newX, newY, newLength, newWidth, pixelsPerMeter);
    }
}

// ========================================
// Component Deletion
// ========================================

/**
 * Delete the currently selected component
 */
function deleteSelectedComponent() {
    const sel = uiState.selectedPlacement;
    if (!sel) return;

    const placement = shipData.componentPlacements[sel.componentIndex];
    if (!placement || !placement.floors) return;

    const pos = placement.floors[sel.placementIndex];
    if (!pos) return;

    // Add to undo history before deleting
    uiState.placementHistory.push({
        componentIndex: sel.componentIndex,
        floor: pos.floor,
        x: pos.x,
        y: pos.y,
        length: sel.length,
        width: sel.width
    });

    // Clear redo history since we made a new action
    uiState.redoHistory = [];

    // Remove the placement
    placement.floors.splice(sel.placementIndex, 1);

    // If no more placements for this component, remove the entry
    if (placement.floors.length === 0) {
        delete shipData.componentPlacements[sel.componentIndex];
    }

    // Clear selection
    const floorIndex = sel.floorIndex;
    uiState.selectedPlacement = null;

    // Redraw the floor
    const canvas = document.getElementById(`floor-canvas-${floorIndex}`);
    if (canvas) {
        canvas.classList.remove('selection-mode');
        const { floorWidth, floorLength } = getCurrentFloorDimensions();
        drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }

    hideSelectionInstructions();

    // Update components list
    renderComponents();
}
