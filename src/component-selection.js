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
            const rects = getPlacementRects(pos, placement);

            // Check if click is inside this component (any of its rectangles)
            const hit = rects.some(r => clickX >= r.x && clickX <= r.x + r.length &&
                clickY >= r.y && clickY <= r.y + r.width);
            if (hit) {
                const isShape = !!(pos.rects && pos.rects.length > 0);

                // Select this component
                uiState.selectedPlacement = {
                    componentIndex: compIdx,
                    floorIndex: floorIndex,
                    placementIndex: i,
                    length: pLength,
                    width: pWidth,
                    originalX: pos.x,
                    originalY: pos.y,
                    isShape: isShape
                };

                // Add visual feedback
                canvas.classList.add('selection-mode');

                // Redraw with selection highlight
                drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
                if (isShape) {
                    drawShapeSelectionHighlight(canvas, rects, pixelsPerMeter);
                } else {
                    drawSelectionHighlight(canvas, pos.x, pos.y, pLength, pWidth, pixelsPerMeter);
                }

                // Show instructions
                showSelectionInstructions(isShape ? getPlacementCount(pos) : 0);

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
 * Draw selection highlight on an odd-shaped (region) placement
 */
function drawShapeSelectionHighlight(canvas, rects, pixelsPerMeter) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 255, 0, 0.15)';
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    for (const r of rects) {
        const px = r.x * pixelsPerMeter;
        const py = r.y * pixelsPerMeter;
        const pw = r.length * pixelsPerMeter;
        const ph = r.width * pixelsPerMeter;
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeRect(px, py, pw, ph);
    }
    ctx.setLineDash([]);
}

/**
 * Show selection mode instructions
 * @param {number} regionCount - Item count when a region placement is selected (0 otherwise)
 */
function showSelectionInstructions(regionCount = 0) {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }
    instructions.textContent = regionCount > 0
        ? `Region holding ${regionCount} items | Delete to remove | Click elsewhere or Escape to deselect`
        : 'Drag edges to resize | Click to move | R/L to rotate | Delete to remove | Escape to cancel';
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

    // Region placements are fitted to their remnant and can't be moved:
    // a click elsewhere just deselects (and selects whatever was clicked)
    if (sel.isShape) {
        cancelSelection();
        handleComponentSelection(event, floorIndex);
        return;
    }

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

    // Clamp to usable area (respecting armor boundary)
    const armorThickness = shipData.armorThickness || 0;
    newX = Math.max(armorThickness, Math.min(newX, floorLength - sel.length - armorThickness));
    newY = Math.max(armorThickness, Math.min(newY, floorWidth - sel.width - armorThickness));

    // Do not round here — allow fine-grained movement when dragging selected components

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

    // Re-insert the same entry at its new position (keeps item count, numbering,
    // and object identity for undo history)
    Object.assign(oldPlacement, {
        floor: floorIndex,
        x: newX,
        y: newY,
        length: sel.length,
        width: sel.width
    });
    placement.floors.splice(sel.placementIndex, 0, oldPlacement);

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
    if (!sel || sel.isShape) return;

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

    // Adjust position if rotation would push it out of bounds (respect armor boundary)
    const armorThickness = shipData.armorThickness || 0;
    if (newX + newLength > floorLength - armorThickness) {
        newX = floorLength - newLength - armorThickness;
    }
    if (newY + newWidth > floorWidth - armorThickness) {
        newY = floorWidth - newWidth - armorThickness;
    }
    newX = Math.max(armorThickness, newX);
    newY = Math.max(armorThickness, newY);

    // Temporarily remove to check overlap
    placement.floors.splice(sel.placementIndex, 1);

    // Check for overlap at new position with new dimensions
    const hasOverlap = checkOverlap(sel.floorIndex, newX, newY, newLength, newWidth, -1);

    if (hasOverlap) {
        // Restore old position and show error
        placement.floors.splice(sel.placementIndex, 0, pos);
        const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
        if (canvas) {
            canvas.style.boxShadow = '0 0 20px red';
            setTimeout(() => {
                canvas.style.boxShadow = '';
            }, 300);
        }
        return;
    }

    // Re-insert the same entry rotated (keeps item count and identity)
    Object.assign(pos, { x: newX, y: newY, length: newLength, width: newWidth });
    placement.floors.splice(sel.placementIndex, 0, pos);

    // Update selection state with new dimensions and position
    sel.length = newLength;
    sel.width = newWidth;
    sel.originalX = newX;
    sel.originalY = newY;

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
        type: 'delete',
        componentIndex: sel.componentIndex,
        floor: pos.floor,
        x: pos.x,
        y: pos.y,
        length: sel.length,
        width: sel.width,
        entry: pos // full entry, so item count and region shape are restored on undo
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
