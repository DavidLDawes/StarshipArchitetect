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

            // Check if click is inside this component (its outline, or any of its rectangles)
            const hit = pos.roomShape
                ? isPointInRoom(pos, clickX, clickY)
                : rects.some(r => clickX >= r.x && clickX <= r.x + r.length &&
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
                    isShape: isShape,
                    roomShape: pos.roomShape
                };

                // Add visual feedback
                canvas.classList.add('selection-mode');

                // Redraw with selection highlight, on every floor it spans
                redrawFloors(getSelectedEntries(uiState.selectedPlacement).map(e => e.floor));

                // Show instructions
                showSelectionInstructions(isShape
                    ? (pos.tons > 0 ? `${pos.tons.toFixed(1)} tons` : `${getPlacementCount(pos)} items`)
                    : '', pos.roomShape);

                return;
            }
        }
    }
}

/**
 * Entries the selection acts on: all the floors of a component spanning floors
 * @param {object} sel - uiState.selectedPlacement
 * @returns {Array<object>} Placement entries, none if they are gone
 */
function getSelectedEntries(sel) {
    const placement = shipData.componentPlacements[sel.componentIndex];
    const pos = placement && placement.floors && placement.floors[sel.placementIndex];
    return pos ? getLinkedEntries(sel.componentIndex, pos) : [];
}

/**
 * Whether the selection has a part on a floor
 * @param {object} sel - uiState.selectedPlacement
 * @param {number} floorIndex - Floor number
 * @returns {boolean}
 */
function isSelectionOnFloor(sel, floorIndex) {
    return getSelectedEntries(sel).some(e => e.floor === floorIndex);
}

/**
 * Draw the highlight for the part of a selection on one floor
 * @param {HTMLCanvasElement} canvas - That floor's canvas
 * @param {object} sel - uiState.selectedPlacement
 * @param {number} floorIndex - Floor number
 * @param {number} pixelsPerMeter - Canvas scale
 */
function drawSelectionOnFloor(canvas, sel, floorIndex, pixelsPerMeter) {
    const placement = shipData.componentPlacements[sel.componentIndex];
    for (const pos of getSelectedEntries(sel)) {
        if (pos.floor !== floorIndex) continue;
        if (pos.roomShape) {
            drawRoomSelectionHighlight(canvas, pos, pixelsPerMeter);
        } else if (pos.rects && pos.rects.length > 0) {
            drawShapeSelectionHighlight(canvas, getPlacementRects(pos, placement), pixelsPerMeter, floorIndex);
        } else {
            drawSelectionHighlight(canvas, pos.x, pos.y, pos.length || placement.length, pos.width || placement.width, pixelsPerMeter);
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
function drawShapeSelectionHighlight(canvas, rects, pixelsPerMeter, floorIndex) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    clipToFloorHull(ctx, floorIndex, pixelsPerMeter);
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
    ctx.restore();
}

/**
 * Draw selection highlight on a circle, arc or ring room
 */
function drawRoomSelectionHighlight(canvas, pos, pixelsPerMeter) {
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    traceRoom(ctx, pos, pixelsPerMeter);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
}

/**
 * The selected circle, arc or ring room, ready to position. An arc stays cut to the radius of
 * the floor it is on, so it can't move to a floor of another size.
 * @param {object} sel - uiState.selectedPlacement
 * @returns {object} Room or placement data
 */
function getSelectedRoom(sel) {
    const pos = shipData.componentPlacements[sel.componentIndex].floors[sel.placementIndex];
    return pos.roomShape === 'arc' ? { ...pos, radius: getArcRadius(pos.floor) } : pos;
}

/**
 * Show selection mode instructions
 * @param {string} regionContents - What a selected region placement holds ('' otherwise)
 * @param {string} roomShape - Shape of a selected circle or arc
 */
function showSelectionInstructions(regionContents = '', roomShape = null) {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }
    const roomText = {
        circle: 'Click to move | Delete to remove | Escape to cancel',
        arc: 'Click to move around the wall | R/L to turn a quarter of the way around | Delete to remove | Escape to cancel',
        ring: 'Click to move around its ring | R/L to turn a quarter of the way around | Delete to remove | Escape to cancel'
    };
    instructions.textContent = regionContents
        ? `Region holding ${regionContents} | Delete to remove | Click elsewhere or Escape to deselect`
        : roomText[roomShape] || 'Drag edges to resize | Click to move | R/L to rotate | Delete to remove | Escape to cancel';
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
    const floors = getSelectedEntries(sel).map(e => e.floor);
    uiState.selectedPlacement = null;

    // Clear drag preview
    clearPreview();

    // Remove visual feedback and redraw
    const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
    if (canvas) canvas.classList.remove('selection-mode');
    redrawFloors(floors.concat(sel.floorIndex));

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

    if (sel.roomShape) {
        moveSelectedRoom(sel, floorIndex, clickX, clickY, canvas);
        return;
    }

    // A component spanning floors moves as a whole, so it has to fit all of them
    const placement = shipData.componentPlacements[sel.componentIndex];
    const entries = getLinkedEntries(sel.componentIndex, placement.floors[sel.placementIndex]);
    const oldFloors = entries.map(e => e.floor);
    const floors = getFloorsAfterMove(entries, floorIndex);
    if (!floors) {
        flashBlocked(canvas);
        return;
    }

    // Center component on click
    let newX = clickX - sel.length / 2;
    let newY = clickY - sel.width / 2;

    // Clamp to usable area (respecting the hull and armor of the target floor)
    const armorThickness = shipData.armorThickness || 0;
    ({ x: newX, y: newY } = clampToFloor(floors, newX, newY, sel.length, sel.width,
        floorLength, floorWidth, armorThickness));

    // Weapons, vehicles, and launch bays stay against the outer hull
    if (requiresHullAccess(shipData.components[sel.componentIndex])) {
        ({ x: newX, y: newY } = snapToFloorHull(floors, newX, newY, sel.length, sel.width,
            floorLength, floorWidth, armorThickness));
    }

    // Do not round here — allow fine-grained movement when dragging selected components

    // Check it fits these floors and has no overlap at the new position
    if (!canPlaceOnFloors(placement, entries, floors, newX, newY, sel.length, sel.width, floorLength, floorWidth, armorThickness)) {
        flashBlocked(canvas);
        return;
    }

    updateLinkedEntries(entries, floors, { x: newX, y: newY, length: sel.length, width: sel.width });

    // Clear selection and preview
    uiState.selectedPlacement = null;
    clearPreview();
    canvas.classList.remove('selection-mode');
    hideSelectionInstructions();

    // Redraw affected floors
    redrawFloors(oldFloors.concat(floors));
}

/**
 * Show that something can't go where it was asked to
 */
function flashBlocked(canvas) {
    canvas.style.boxShadow = '0 0 20px red';
    setTimeout(() => {
        canvas.style.boxShadow = '';
    }, 300);
}

/**
 * Finish moving or turning a circle or arc
 * @param {object} room - Where it goes
 * @param {Array<object>} entries - Entries moving together
 * @param {number[]} floors - A floor for each entry
 * @returns {boolean} True if it could go there
 */
function commitRoomMove(sel, room, entries, floors, canvas) {
    const placement = shipData.componentPlacements[sel.componentIndex];
    if (!room || !withoutEntries(placement, entries, () => isRoomClear(room, floors, -1))) {
        flashBlocked(canvas);
        return false;
    }

    const { x, y, length, width } = room;
    updateLinkedEntries(entries, floors, { x, y, length, width, ...getRoomFields(room) });
    return true;
}

/**
 * Where a selected ring room would go when moved: the free spot on its ring nearest
 * the pointer. It stays on its ring, as changing rings would change its shape.
 * @param {object} sel - uiState.selectedPlacement
 * @param {number[]} floors - Floors it would go on
 * @returns {object|null} Room entry, or null if there is no room for it
 */
function getMovedRingSpot(sel, floors, pointerX, pointerY) {
    const placement = shipData.componentPlacements[sel.componentIndex];
    const pos = placement.floors[sel.placementIndex];
    return withoutEntries(placement, getLinkedEntries(sel.componentIndex, pos), () =>
        findRingSpot(pos, floors, pointerX, pointerY, -1, false, false));
}

/**
 * Move a selected circle, arc or ring room to a clicked position
 */
function moveSelectedRoom(sel, floorIndex, clickX, clickY, canvas) {
    const requireHull = requiresHullAccess(shipData.components[sel.componentIndex]);
    const pos = shipData.componentPlacements[sel.componentIndex].floors[sel.placementIndex];
    const entries = getLinkedEntries(sel.componentIndex, pos);
    const oldFloors = entries.map(e => e.floor);
    const floors = getFloorsAfterMove(entries, floorIndex);
    let room = null;
    if (floors) {
        room = pos.roomShape === 'ring'
            ? getMovedRingSpot(sel, floors, clickX, clickY)
            : positionRoom(getSelectedRoom(sel), floors, clickX, clickY, requireHull);
    }
    if (!commitRoomMove(sel, room, entries, floors, canvas)) return;

    uiState.selectedPlacement = null;
    clearPreview();
    canvas.classList.remove('selection-mode');
    hideSelectionInstructions();

    redrawFloors(oldFloors.concat(floors));
}

/**
 * Turn a selected arc or ring room a quarter of the way around. A circle or a whole
 * ring looks the same however it is turned.
 */
function rotateSelectedRoom(sel, pos) {
    if (pos.roomShape === 'circle') return;
    if (pos.roomShape === 'ring' && pos.ringSweep >= FULL_TURN) return;
    const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
    const entries = getLinkedEntries(sel.componentIndex, pos);
    const floors = entries.map(e => e.floor);
    const turned = pos.roomShape === 'ring' ? turnRingRoom(pos, Math.PI / 2) : turnArcRoom(pos, Math.PI / 2);
    if (!canvas || !commitRoomMove(sel, turned, entries, floors, canvas)) return;

    sel.length = pos.length;
    sel.width = pos.width;
    sel.originalX = pos.x;
    sel.originalY = pos.y;

    redrawFloors(floors);
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

    if (pos.roomShape) {
        rotateSelectedRoom(sel, pos);
        return;
    }

    // A component spanning floors turns as a whole, so it has to fit all of them
    const entries = getLinkedEntries(sel.componentIndex, pos);
    const floors = entries.map(e => e.floor);

    // Calculate new rotated dimensions
    const newLength = sel.width;
    const newWidth = sel.length;

    // Calculate floor dimensions for bounds checking
    const { floorWidth, floorLength } = getCurrentFloorDimensions();

    // Check if rotated component would fit at current position
    let newX = pos.x;
    let newY = pos.y;

    // Adjust position if rotation would push it out of bounds (respect hull and armor)
    const armorThickness = shipData.armorThickness || 0;
    ({ x: newX, y: newY } = clampToFloor(floors, newX, newY, newLength, newWidth,
        floorLength, floorWidth, armorThickness));

    // Hull components keep their hull side: re-anchor to the side they were on
    // (a component on the right or bottom hull would otherwise drift off it)
    if (requiresHullAccess(shipData.components[sel.componentIndex])) {
        if (!getShapedInner(sel.floorIndex)) {
            const sides = getHullSides(pos.x, pos.y, sel.length, sel.width, floorLength, floorWidth, armorThickness);
            if (sides.includes('right')) newX = floorLength - armorThickness - newLength;
            if (sides.includes('bottom')) newY = floorWidth - armorThickness - newWidth;
        }
        if (!touchesFloorHull(floors, newX, newY, newLength, newWidth, floorLength, floorWidth, armorThickness)) {
            ({ x: newX, y: newY } = snapToFloorHull(floors, newX, newY, newLength, newWidth,
                floorLength, floorWidth, armorThickness));
        }
    }

    // Check it still fits the floors and has no overlap with the new dimensions
    if (!canPlaceOnFloors(placement, entries, floors, newX, newY, newLength, newWidth, floorLength, floorWidth, armorThickness)) {
        const canvas = document.getElementById(`floor-canvas-${sel.floorIndex}`);
        if (canvas) flashBlocked(canvas);
        return;
    }

    updateLinkedEntries(entries, floors, { x: newX, y: newY, length: newLength, width: newWidth });

    // Update selection state with new dimensions and position
    sel.length = newLength;
    sel.width = newWidth;
    sel.originalX = newX;
    sel.originalY = newY;

    // Redraw the floors
    redrawFloors(floors);
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

    // A component spanning floors goes as a whole
    const entries = getLinkedEntries(sel.componentIndex, pos);

    // Add to undo history before deleting
    uiState.placementHistory.push({
        type: 'delete',
        componentIndex: sel.componentIndex,
        floor: pos.floor,
        x: pos.x,
        y: pos.y,
        length: sel.length,
        width: sel.width,
        entry: pos, // full entry, so item count and region shape are restored on undo
        entries
    });

    // Clear redo history since we made a new action
    uiState.redoHistory = [];

    // Remove the placement
    placement.floors = placement.floors.filter(e => !entries.includes(e));

    // If no more placements for this component, remove the entry
    if (placement.floors.length === 0) {
        delete shipData.componentPlacements[sel.componentIndex];
    }

    // Clear selection
    const floorIndex = sel.floorIndex;
    uiState.selectedPlacement = null;

    // Redraw the floors
    const canvas = document.getElementById(`floor-canvas-${floorIndex}`);
    if (canvas) canvas.classList.remove('selection-mode');
    redrawFloors(entries.map(e => e.floor));

    hideSelectionInstructions();

    // Update components list
    renderComponents();
}
