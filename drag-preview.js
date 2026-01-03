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
    x: null,
    y: null,
    length: null,
    width: null,
    excludeComponentIndex: -1, // For move operations, which component to exclude from overlap check
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

    const px = previewState.x * pixelsPerMeter;
    const py = previewState.y * pixelsPerMeter;
    const pw = previewState.length * pixelsPerMeter;
    const ph = previewState.width * pixelsPerMeter;

    // Check if this position would be valid (no overlap, within bounds)
    const isValid = !checkOverlap(
        floorIndex,
        previewState.x,
        previewState.y,
        previewState.length,
        previewState.width,
        previewState.excludeComponentIndex
    );

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

// ========================================
// Mouse Event Handlers
// ========================================

/**
 * Handle mousemove on canvas during placement or move mode
 * @param {MouseEvent} event - The mouse event
 * @param {number} floorIndex - Floor number (1-based)
 */
function handleCanvasMouseMove(event, floorIndex) {
    // Only show preview during placement or move mode
    if (!uiState.isPlacingComponent && !uiState.selectedPlacement) {
        clearPreview();
        return;
    }

    // Get component dimensions for preview
    let compLength, compWidth, excludeIndex;

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
    } else if (uiState.selectedPlacement) {
        // Move mode
        const sel = uiState.selectedPlacement;
        compLength = sel.length;
        compWidth = sel.width;
        excludeIndex = sel.componentIndex;
    } else {
        clearPreview();
        return;
    }

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

    // Get mouse position in pixels
    const mousePxX = (event.clientX - rect.left) * scaleX;
    const mousePxY = (event.clientY - rect.top) * scaleY;

    // Convert to meters
    const mouseX = mousePxX / pixelsPerMeter;
    const mouseY = mousePxY / pixelsPerMeter;

    // Calculate preview position (center component on mouse)
    let previewX = mouseX - compLength / 2;
    let previewY = mouseY - compWidth / 2;

    // Clamp to floor bounds
    previewX = Math.max(0, Math.min(previewX, floorLength - compLength));
    previewY = Math.max(0, Math.min(previewY, floorWidth - compWidth));

    // Round to nearest meter for grid alignment
    previewX = Math.round(previewX);
    previewY = Math.round(previewY);

    // Update preview state
    previewState.isActive = true;
    previewState.floorIndex = floorIndex;
    previewState.x = previewX;
    previewState.y = previewY;
    previewState.length = compLength;
    previewState.width = compWidth;
    previewState.excludeComponentIndex = excludeIndex;

    // Throttle redraws using requestAnimationFrame
    if (previewState.animationFrameId === null) {
        previewState.animationFrameId = requestAnimationFrame(() => {
            // Redraw floor with components and preview
            drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth);
            drawPreview(canvas, floorIndex, floorLength, floorWidth);
            previewState.animationFrameId = null;
        });
    }
}

/**
 * Handle mouseleave on canvas - clear preview
 */
function handleCanvasMouseLeave(event, floorIndex) {
    if (previewState.isActive && previewState.floorIndex === floorIndex) {
        clearPreview();

        // Redraw floor without preview
        const canvas = event.target;
        const totalArea = calculateTotalFloorArea(shipData.totalTons, shipData.ceilingHeight);
        const floorArea = calculateFloorArea(totalArea, shipData.numFloors);
        const floorWidth = calculateFloorWidth(floorArea, shipData.floorLength);
        drawFloorWithComponents(canvas, floorIndex, shipData.floorLength, floorWidth);
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
    previewState.x = null;
    previewState.y = null;
    previewState.length = null;
    previewState.width = null;
    previewState.excludeComponentIndex = -1;
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
