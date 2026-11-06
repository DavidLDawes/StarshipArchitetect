/**
 * Starship Architect - Drag Preview Module
 * Handles visual feedback during component placement and movement
 */

// ========================================
// Preview State Management
// ========================================

// Add preview state to uiState (extends existing state in app.js)
// This will be initialized in setupDragPreview()
let previewState = {
    isActive: false,
    floorIndex: null,
    fitFloors: null, // Floors the component has to fit: the hovered floor, or all it spans
    x: null,
    y: null,
    length: null,
    width: null,
    excludeComponentIndex: -1, // For move operations, which component to exclude from overlap check
    requireHull: false, // Component must touch the outer hull (weapons, vehicles, launch bays)
    room: null, // The room when previewing a circle or arc
    animationFrameId: null // For throttling redraws
};

// ========================================
// Preview Rendering
// ========================================

/**
 * Draw preview rectangle on canvas with validation coloring
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} floorIndex - Floor number (1-based)
 * @param {number} length - Floor length in meters
 * @param {number} width - Floor width in meters
 */
function drawPreview(canvas, floorIndex, length, width) {
    if (!previewState.isActive || previewState.floorIndex !== floorIndex) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const pixelsPerMeter = canvasWidth / length;

    if (previewState.room) {
        drawRoomPreview(ctx, pixelsPerMeter);
        return;
    }

    const px = previewState.x * pixelsPerMeter;
    const py = previewState.y * pixelsPerMeter;
    const pw = previewState.length * pixelsPerMeter;
    const ph = previewState.width * pixelsPerMeter;

    // Check if this position would be valid: within usable area (armor) and no overlap
    const armorThickness = shipData.armorThickness || 0;
    const within = fitsFloor(
        previewState.fitFloors,
        previewState.x,
        previewState.y,
        previewState.length,
        previewState.width,
        length,
        width,
        armorThickness
    );

    const noOverlap = [].concat(previewState.fitFloors).every(f => !checkOverlap(
        f,
        previewState.x,
        previewState.y,
        previewState.length,
        previewState.width,
        previewState.excludeComponentIndex
    ));

    const onHull = !previewState.requireHull || touchesFloorHull(
        previewState.fitFloors,
        previewState.x,
        previewState.y,
        previewState.length,
        previewState.width,
        length,
        width,
        armorThickness
    );

    const isValid = within && noOverlap && onHull;

    // Preview colors based on validity
    const fillColor = isValid ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 0, 0, 0.3)';
    const strokeColor = isValid ? 'rgba(0, 255, 100, 0.8)' : 'rgba(255, 0, 0, 0.8)';

    // Fill with translucent color
    ctx.fillStyle = fillColor;
    ctx.fillRect(px, py, pw, ph);

    // Dashed border
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.setLineDash([]);
}

/**
 * Draw the preview of a circle or arc, with the same coloring as a rectangle's.
 * positionRoom() has already put it inside the hull, and against it if it has to be.
 */
function drawRoomPreview(ctx, pixelsPerMeter) {
    const isValid = isRoomClear(previewState.room, [].concat(previewState.fitFloors), previewState.excludeComponentIndex);

    ctx.beginPath();
    traceRoom(ctx, previewState.room, pixelsPerMeter);
    ctx.fillStyle = isValid ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 0, 0, 0.3)';
    ctx.fill('evenodd');
    ctx.strokeStyle = isValid ? 'rgba(0, 255, 100, 0.8)' : 'rgba(255, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
}

// ========================================
// Mouse Event Handlers
// ========================================

/**
 * Handle mousemove on canvas during placement or move mode
 * @param {MouseEvent} event - The mouse event
 * @param {number} floorIndex - Floor number (1-based)
 */
function handleCanvasMouseMove(event, floorIndex) {
    // Region picking draws its own hover highlight
    if (uiState.regionFill) {
        handleRegionHover(event, floorIndex);
        return;
    }

    // Only show preview during placement or move mode. A resize draws its own.
    if (resizeState.isResizing || (!uiState.isPlacingComponent && !uiState.selectedPlacement)) {
        clearPreview();
        return;
    }

    // Get component dimensions for preview
    let compLength, compWidth, excludeIndex, componentIndex;
    let fitFloors = floorIndex;
    let room = null;

    if (uiState.isPlacingComponent) {
        // Placement mode
        const data = uiState.placementData;
        if (!data || !data.floors.includes(floorIndex)) {
            clearPreview();
            return;
        }
        compLength = data.length;
        compWidth = data.width;
        excludeIndex = -1;
        componentIndex = data.componentIndex;
        if (data.isMultiFloor) fitFloors = data.floors;
        if (data.roomShape) room = data;
    } else if (uiState.selectedPlacement) {
        // Move mode (region shapes can't be moved, so no preview)
        const sel = uiState.selectedPlacement;
        if (sel.isShape) {
            clearPreview();
            return;
        }
        compLength = sel.length;
        compWidth = sel.width;
        excludeIndex = sel.componentIndex;
        componentIndex = sel.componentIndex;
        // A component spanning floors moves as a whole, so it has to fit all of them
        const pos = shipData.componentPlacements[componentIndex].floors[sel.placementIndex];
        fitFloors = getFloorsAfterMove(getLinkedEntries(componentIndex, pos), floorIndex);
        if (!fitFloors) {
            clearPreview();
            return;
        }
        if (sel.roomShape) room = getSelectedRoom(sel);
    } else {
        clearPreview();
        return;
    }

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate floor dimensions
    const { floorWidth, floorLength } = getCurrentFloorDimensions();
    const pixelsPerMeter = canvas.width / floorLength;

    // Get mouse position in pixels
    const mousePxX = (event.clientX - rect.left) * scaleX;
    const mousePxY = (event.clientY - rect.top) * scaleY;

    // Convert to meters
    const mouseX = mousePxX / pixelsPerMeter;
    const mouseY = mousePxY / pixelsPerMeter;

    // A circle or arc works out its own position. A ring room shows where it will
    // really go, as that can be further around its ring or on the next one in.
    if (room) {
        const needsHull = requiresHullAccess(shipData.components[componentIndex]);
        let spot;
        if (room.roomShape !== 'ring') spot = positionRoom(room, [].concat(fitFloors), mouseX, mouseY, needsHull);
        else if (uiState.isPlacingComponent) spot = findRoomSpot(room, [].concat(fitFloors), mouseX, mouseY, -1, needsHull);
        else spot = getMovedRingSpot(uiState.selectedPlacement, [].concat(fitFloors), mouseX, mouseY);
        if (!spot) {
            clearPreview();
            return;
        }
        compLength = spot.length;
        compWidth = spot.width;
        room = spot;
    }

    // Center the preview on the mouse, keeping it inside the hull and armor
    const armorThickness = shipData.armorThickness || 0;
    let { x: previewX, y: previewY } = room || clampToFloor(fitFloors, mouseX - compLength / 2, mouseY - compWidth / 2,
        compLength, compWidth, floorLength, floorWidth, armorThickness);

    // Hull components (weapons, vehicles, launch bays) follow the nearest part of the hull
    const requireHull = requiresHullAccess(shipData.components[componentIndex]);
    if (requireHull && !room) {
        ({ x: previewX, y: previewY } = snapToFloorHull(fitFloors, previewX, previewY, compLength, compWidth,
            floorLength, floorWidth, armorThickness));
    }

    // Do not snap to 1m grid here — allow fine-grained (sub-meter) preview movement
    // Keep previewX/previewY as floating values for pixel-precise placement

    // Update preview state
    previewState.isActive = true;
    previewState.floorIndex = floorIndex;
    previewState.fitFloors = fitFloors;
    previewState.x = previewX;
    previewState.y = previewY;
    previewState.length = compLength;
    previewState.width = compWidth;
    previewState.excludeComponentIndex = excludeIndex;
    previewState.requireHull = requireHull;
    previewState.room = room;

    // Throttle redraws using requestAnimationFrame
    if (previewState.animationFrameId === null) {
        previewState.animationFrameId = requestAnimationFrame(() => {
            // Redraw floor with components and preview
            drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
            drawPreview(canvas, floorIndex, floorLength, floorWidth);
            previewState.animationFrameId = null;
        });
    }
}

/**
 * Handle mouseleave on canvas - clear preview
 */
function handleCanvasMouseLeave(event, floorIndex) {
    if (uiState.regionFill) {
        handleRegionLeave(event, floorIndex);
        return;
    }

    if (previewState.isActive && previewState.floorIndex === floorIndex) {
        clearPreview();

        // Redraw floor without preview
        const canvas = event.target;
        const { floorWidth, floorLength } = getCurrentFloorDimensions();
        drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth, shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }
}

/**
 * Clear preview state
 */
function clearPreview() {
    if (previewState.animationFrameId !== null) {
        cancelAnimationFrame(previewState.animationFrameId);
        previewState.animationFrameId = null;
    }
    previewState.isActive = false;
    previewState.floorIndex = null;
    previewState.fitFloors = null;
    previewState.x = null;
    previewState.y = null;
    previewState.length = null;
    previewState.width = null;
    previewState.excludeComponentIndex = -1;
    previewState.requireHull = false;
    previewState.room = null;
}

// ========================================
// Setup and Integration
// ========================================

/**
 * Attach mouse event handlers to all floor canvases
 * Should be called whenever floors are rendered
 */
function setupDragPreview() {
    // Attach handlers to all existing canvases
    for (let i = 1; i <= shipData.numFloors; i++) {
        const canvas = document.getElementById(`floor-canvas-${i}`);
        if (canvas) {
            // Remove existing handlers to avoid duplicates
            canvas.removeEventListener('mousemove', canvas._mouseMoveHandler);
            canvas.removeEventListener('mouseleave', canvas._mouseLeaveHandler);

            // Create bound handlers
            const floorIndex = i;
            const mouseMoveHandler = (e) => handleCanvasMouseMove(e, floorIndex);
            const mouseLeaveHandler = (e) => handleCanvasMouseLeave(e, floorIndex);

            // Store handlers on canvas for removal later
            canvas._mouseMoveHandler = mouseMoveHandler;
            canvas._mouseLeaveHandler = mouseLeaveHandler;

            // Attach handlers
            canvas.addEventListener('mousemove', mouseMoveHandler);
            canvas.addEventListener('mouseleave', mouseLeaveHandler);
        }
    }
}
