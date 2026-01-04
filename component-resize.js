/**
 * Starship Architect - Component Resize Module
 * Handles resizing components while maintaining constant area
 */

// ========================================
// Resize State Management
// ========================================

/**
 * State tracking for resize operations
 */
let resizeState = {
    isResizing: false,
    edge: null, // 'top', 'bottom', 'left', 'right'
    componentIndex: null,
    placementIndex: null,
    floorIndex: null,
    originalX: null,
    originalY: null,
    originalLength: null,
    originalWidth: null,
    componentArea: null,
    startMouseX: null,
    startMouseY: null,
    currentLength: null,
    currentWidth: null,
    currentX: null,
    currentY: null,
    animationFrameId: null
};

// Edge detection threshold in pixels
const EDGE_THRESHOLD = 10;

// ========================================
// Edge Detection
// ========================================

/**
 * Detect which edge (if any) the mouse is near
 * @param {number} mouseX - Mouse X in pixels
 * @param {number} mouseY - Mouse Y in pixels
 * @param {Object} placement - Component placement {x, y, length, width}
 * @param {number} pixelsPerMeter - Canvas scale factor
 * @returns {string|null} Edge name or null
 */
function detectEdge(mouseX, mouseY, placement, pixelsPerMeter) {
    const x1 = placement.x * pixelsPerMeter;
    const y1 = placement.y * pixelsPerMeter;
    const x2 = (placement.x + placement.length) * pixelsPerMeter;
    const y2 = (placement.y + placement.width) * pixelsPerMeter;

    // Check if mouse is inside the component bounds (with some padding)
    const PADDING = 5;
    if (mouseX < x1 - PADDING || mouseX > x2 + PADDING ||
        mouseY < y1 - PADDING || mouseY > y2 + PADDING) {
        return null;
    }

    // Check each edge (priority order: top, bottom, left, right)
    if (Math.abs(mouseY - y1) < EDGE_THRESHOLD && mouseX >= x1 && mouseX <= x2) return 'top';
    if (Math.abs(mouseY - y2) < EDGE_THRESHOLD && mouseX >= x1 && mouseX <= x2) return 'bottom';
    if (Math.abs(mouseX - x1) < EDGE_THRESHOLD && mouseY >= y1 && mouseY <= y2) return 'left';
    if (Math.abs(mouseX - x2) < EDGE_THRESHOLD && mouseY >= y1 && mouseY <= y2) return 'right';

    return null;
}

/**
 * Get appropriate cursor for edge
 * @param {string|null} edge - Edge name or null
 * @returns {string} CSS cursor value
 */
function getCursorForEdge(edge) {
    if (!edge) return 'default';
    if (edge === 'top' || edge === 'bottom') return 'ns-resize';
    if (edge === 'left' || edge === 'right') return 'ew-resize';
    return 'default';
}

// ========================================
// Resize Calculations
// ========================================

/**
 * Calculate new dimensions while maintaining constant area
 * @param {string} edge - Which edge is being dragged
 * @param {number} deltaMeters - Change in position in meters
 * @param {number} originalLength - Original component length
 * @param {number} originalWidth - Original component width
 * @param {number} componentArea - Component area (must remain constant)
 * @param {number} floorLength - Floor length for bounds checking
 * @param {number} floorWidth - Floor width for bounds checking
 * @returns {Object} {length, width, x, y} - New dimensions and position
 */
function calculateNewDimensions(edge, deltaMeters, originalLength, originalWidth, componentArea, originalX, originalY, floorLength, floorWidth) {
    let newLength = originalLength;
    let newWidth = originalWidth;
    let newX = originalX;
    let newY = originalY;

    // Minimum dimension (1 meter)
    const MIN_DIM = 1;

    if (edge === 'right') {
        // Horizontal resize: change length, adjust width to maintain area
        newLength = originalLength + deltaMeters;
        newLength = Math.max(MIN_DIM, Math.min(newLength, floorLength - originalX));
        newWidth = componentArea / newLength;

        // Check if width would fit
        if (newY + newWidth > floorWidth) {
            // Constrain by width
            newWidth = floorWidth - newY;
            newLength = componentArea / newWidth;
        }
    } else if (edge === 'left') {
        // Dragging left edge: change length and position
        newLength = originalLength - deltaMeters;
        newLength = Math.max(MIN_DIM, newLength);

        // Calculate new X position
        newX = originalX + deltaMeters;
        newX = Math.max(0, Math.min(newX, originalX + originalLength - MIN_DIM));

        // Recalculate length based on actual X change
        newLength = (originalX + originalLength) - newX;
        newWidth = componentArea / newLength;

        // Check if width would fit
        if (newY + newWidth > floorWidth) {
            // Constrain by width
            newWidth = floorWidth - newY;
            newLength = componentArea / newWidth;
            newX = (originalX + originalLength) - newLength;
        }
    } else if (edge === 'bottom') {
        // Vertical resize: change width, adjust length to maintain area
        newWidth = originalWidth + deltaMeters;
        newWidth = Math.max(MIN_DIM, Math.min(newWidth, floorWidth - originalY));
        newLength = componentArea / newWidth;

        // Check if length would fit
        if (newX + newLength > floorLength) {
            // Constrain by length
            newLength = floorLength - newX;
            newWidth = componentArea / newLength;
        }
    } else if (edge === 'top') {
        // Dragging top edge: change width and position
        newWidth = originalWidth - deltaMeters;
        newWidth = Math.max(MIN_DIM, newWidth);

        // Calculate new Y position
        newY = originalY + deltaMeters;
        newY = Math.max(0, Math.min(newY, originalY + originalWidth - MIN_DIM));

        // Recalculate width based on actual Y change
        newWidth = (originalY + originalWidth) - newY;
        newLength = componentArea / newWidth;

        // Check if length would fit
        if (newX + newLength > floorLength) {
            // Constrain by length
            newLength = floorLength - newX;
            newWidth = componentArea / newLength;
            newY = (originalY + originalWidth) - newWidth;
        }
    }

    // Final bounds check
    newLength = Math.max(MIN_DIM, Math.min(newLength, floorLength - newX));
    newWidth = Math.max(MIN_DIM, Math.min(newWidth, floorWidth - newY));

    // Recalculate to maintain exact area
    if (edge === 'left' || edge === 'right') {
        newWidth = componentArea / newLength;
    } else {
        newLength = componentArea / newWidth;
    }

    return { length: newLength, width: newWidth, x: newX, y: newY };
}

// ========================================
// Resize Operations
// ========================================

/**
 * Start resize operation
 * @param {string} edge - Which edge was clicked
 * @param {number} componentIndex - Component index
 * @param {number} placementIndex - Placement index within component
 * @param {number} floorIndex - Floor index
 * @param {number} mouseX - Starting mouse X in pixels
 * @param {number} mouseY - Starting mouse Y in pixels
 */
function startResize(edge, componentIndex, placementIndex, floorIndex, mouseX, mouseY) {
    const placement = shipData.componentPlacements[componentIndex];
    if (!placement || !placement.floors || !placement.floors[placementIndex]) return;

    const pos = placement.floors[placementIndex];
    const length = pos.length || placement.length;
    const width = pos.width || placement.width;

    console.log(`Starting resize: edge=${edge}, component=${componentIndex}, area=${length * width}m²`);

    resizeState.isResizing = true;
    resizeState.edge = edge;
    resizeState.componentIndex = componentIndex;
    resizeState.placementIndex = placementIndex;
    resizeState.floorIndex = floorIndex;
    resizeState.originalX = pos.x;
    resizeState.originalY = pos.y;
    resizeState.originalLength = length;
    resizeState.originalWidth = width;
    resizeState.componentArea = length * width;
    resizeState.startMouseX = mouseX;
    resizeState.startMouseY = mouseY;
    resizeState.currentLength = length;
    resizeState.currentWidth = width;
    resizeState.currentX = pos.x;
    resizeState.currentY = pos.y;

    // Update cursor
    document.body.style.cursor = getCursorForEdge(edge);

    // Update instruction text
    showResizeInstructions();
}

/**
 * Update resize during drag
 * @param {number} mouseX - Current mouse X in pixels
 * @param {number} mouseY - Current mouse Y in pixels
 * @param {HTMLCanvasElement} canvas - Canvas element
 */
function updateResize(mouseX, mouseY, canvas) {
    if (!resizeState.isResizing) return;

    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    const pixelsPerMeter = canvas.width / floorLength;

    // Calculate delta in meters
    const deltaPixelsX = mouseX - resizeState.startMouseX;
    const deltaPixelsY = mouseY - resizeState.startMouseY;
    const deltaMetersX = deltaPixelsX / pixelsPerMeter;
    const deltaMetersY = deltaPixelsY / pixelsPerMeter;

    // Choose appropriate delta based on edge
    const deltaMeters = (resizeState.edge === 'left' || resizeState.edge === 'right')
        ? deltaMetersX
        : deltaMetersY;

    // Calculate new dimensions
    const newDims = calculateNewDimensions(
        resizeState.edge,
        deltaMeters,
        resizeState.originalLength,
        resizeState.originalWidth,
        resizeState.componentArea,
        resizeState.originalX,
        resizeState.originalY,
        floorLength,
        floorWidth
    );

    // Update current state
    resizeState.currentLength = newDims.length;
    resizeState.currentWidth = newDims.width;
    resizeState.currentX = newDims.x;
    resizeState.currentY = newDims.y;

    // Throttle redraws using requestAnimationFrame
    if (resizeState.animationFrameId === null) {
        resizeState.animationFrameId = requestAnimationFrame(() => {
            drawResizePreview(canvas, resizeState.floorIndex, floorLength, floorWidth);
            resizeState.animationFrameId = null;
        });
    }
}

/**
 * Commit resize operation
 */
function commitResize() {
    console.log('commitResize called, isResizing:', resizeState.isResizing);
    if (!resizeState.isResizing) return;

    const { floorLength, floorWidth } = getCurrentFloorDimensions();

    // Check for overlap at new position/dimensions (excluding self)
    const hasOverlap = checkOverlap(
        resizeState.floorIndex,
        resizeState.currentX,
        resizeState.currentY,
        resizeState.currentLength,
        resizeState.currentWidth,
        resizeState.componentIndex
    );

    if (hasOverlap) {
        // Show error feedback
        const canvas = document.getElementById(`floor-canvas-${resizeState.floorIndex}`);
        if (canvas) {
            canvas.style.boxShadow = '0 0 20px red';
            setTimeout(() => {
                canvas.style.boxShadow = '';
            }, 300);
        }
        cancelResize();
        return;
    }

    // Apply the resize
    const placement = shipData.componentPlacements[resizeState.componentIndex];
    if (placement && placement.floors && placement.floors[resizeState.placementIndex]) {
        const pos = placement.floors[resizeState.placementIndex];
        pos.x = Math.round(resizeState.currentX * 10) / 10; // Round to 0.1m
        pos.y = Math.round(resizeState.currentY * 10) / 10;
        pos.length = Math.round(resizeState.currentLength * 10) / 10;
        pos.width = Math.round(resizeState.currentWidth * 10) / 10;

        const newArea = pos.length * pos.width;
        console.log(`Resize committed: ${resizeState.originalLength}×${resizeState.originalWidth} -> ${pos.length}×${pos.width} (area: ${resizeState.componentArea.toFixed(2)}m² -> ${newArea.toFixed(2)}m²)`);
        console.log('Updated placement:', JSON.stringify(pos));

        // Update the selection state with new dimensions if component is selected
        if (uiState.selectedPlacement &&
            uiState.selectedPlacement.componentIndex === resizeState.componentIndex &&
            uiState.selectedPlacement.placementIndex === resizeState.placementIndex) {
            console.log('Updating selection state with new dimensions');
            uiState.selectedPlacement.length = pos.length;
            uiState.selectedPlacement.width = pos.width;
            uiState.selectedPlacement.originalX = pos.x;
            uiState.selectedPlacement.originalY = pos.y;
        }
    }

    // Redraw floor with selection highlight (keep component selected)
    const canvas = document.getElementById(`floor-canvas-${resizeState.floorIndex}`);
    if (canvas) {
        drawFloorWithComponents(canvas, resizeState.floorIndex, floorLength, floorWidth,
            shipData.componentPlacements, shipData.components, uiState.selectedPlacement);

        // Draw selection highlight if component is still selected
        if (uiState.selectedPlacement &&
            uiState.selectedPlacement.componentIndex === resizeState.componentIndex &&
            uiState.selectedPlacement.placementIndex === resizeState.placementIndex) {
            const pixelsPerMeter = canvas.width / floorLength;
            const pos = shipData.componentPlacements[resizeState.componentIndex].floors[resizeState.placementIndex];
            drawSelectionHighlight(canvas, pos.x, pos.y, pos.length, pos.width, pixelsPerMeter);
        }
    }

    // Clean up resize state
    resetResizeState();
}

/**
 * Cancel resize operation
 */
function cancelResize() {
    if (!resizeState.isResizing) return;

    // Redraw floor without preview
    const canvas = document.getElementById(`floor-canvas-${resizeState.floorIndex}`);
    if (canvas) {
        const { floorLength, floorWidth } = getCurrentFloorDimensions();
        drawFloorWithComponents(canvas, resizeState.floorIndex, floorLength, floorWidth,
            shipData.componentPlacements, shipData.components, uiState.selectedPlacement);
    }

    resetResizeState();
}

/**
 * Reset resize state
 */
function resetResizeState() {
    if (resizeState.animationFrameId !== null) {
        cancelAnimationFrame(resizeState.animationFrameId);
        resizeState.animationFrameId = null;
    }

    resizeState.isResizing = false;
    resizeState.edge = null;
    resizeState.componentIndex = null;
    resizeState.placementIndex = null;
    resizeState.floorIndex = null;
    resizeState.originalX = null;
    resizeState.originalY = null;
    resizeState.originalLength = null;
    resizeState.originalWidth = null;
    resizeState.componentArea = null;
    resizeState.startMouseX = null;
    resizeState.startMouseY = null;
    resizeState.currentLength = null;
    resizeState.currentWidth = null;
    resizeState.currentX = null;
    resizeState.currentY = null;

    document.body.style.cursor = 'default';
    hideResizeInstructions();
}

// ========================================
// Preview Rendering
// ========================================

/**
 * Draw resize preview on canvas
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {number} floorIndex - Floor index
 * @param {number} floorLength - Floor length
 * @param {number} floorWidth - Floor width
 */
function drawResizePreview(canvas, floorIndex, floorLength, floorWidth) {
    // First redraw floor with all components
    drawFloorWithComponents(canvas, floorIndex, floorLength, floorWidth,
        shipData.componentPlacements, shipData.components, null);

    if (!resizeState.isResizing) {
        console.log('drawResizePreview called but not resizing - returning');
        return;
    }

    const ctx = canvas.getContext('2d');
    const pixelsPerMeter = canvas.width / floorLength;

    // Check if new dimensions would be valid
    const isValid = !checkOverlap(
        floorIndex,
        resizeState.currentX,
        resizeState.currentY,
        resizeState.currentLength,
        resizeState.currentWidth,
        resizeState.componentIndex
    );

    const px = resizeState.currentX * pixelsPerMeter;
    const py = resizeState.currentY * pixelsPerMeter;
    const pw = resizeState.currentLength * pixelsPerMeter;
    const ph = resizeState.currentWidth * pixelsPerMeter;

    // Preview colors based on validity
    const fillColor = isValid ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 0, 0, 0.3)';
    const strokeColor = isValid ? 'rgba(0, 255, 100, 0.8)' : 'rgba(255, 0, 0, 0.8)';

    // Fill with translucent color
    ctx.fillStyle = fillColor;
    ctx.fillRect(px, py, pw, ph);

    // Dashed border
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.setLineDash([]);

    // Draw dimension text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;

    const dimensionText = `${resizeState.currentLength.toFixed(1)}m × ${resizeState.currentWidth.toFixed(1)}m`;
    const areaText = `(${(resizeState.currentLength * resizeState.currentWidth).toFixed(1)}m²)`;

    ctx.fillText(dimensionText, px + pw / 2, py + ph / 2 - 10);
    ctx.fillText(areaText, px + pw / 2, py + ph / 2 + 10);

    ctx.shadowBlur = 0;
}

// ========================================
// Mouse Event Handlers
// ========================================

/**
 * Handle mouse move over canvas for edge detection and resize
 * @param {MouseEvent} event - Mouse event
 * @param {number} floorIndex - Floor index
 */
function handleResizeMouseMove(event, floorIndex) {
    const sel = uiState.selectedPlacement;
    if (!sel || sel.floorIndex !== floorIndex) {
        document.body.style.cursor = 'default';
        return;
    }

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    if (resizeState.isResizing) {
        // Update resize
        updateResize(mouseX, mouseY, canvas);
    } else {
        // Check for edge detection
        const { floorLength } = getCurrentFloorDimensions();
        const pixelsPerMeter = canvas.width / floorLength;

        const placement = shipData.componentPlacements[sel.componentIndex];
        if (!placement || !placement.floors || !placement.floors[sel.placementIndex]) return;

        const pos = placement.floors[sel.placementIndex];
        const placementData = {
            x: pos.x,
            y: pos.y,
            length: pos.length || placement.length,
            width: pos.width || placement.width
        };

        const edge = detectEdge(mouseX, mouseY, placementData, pixelsPerMeter);
        document.body.style.cursor = getCursorForEdge(edge);
    }
}

/**
 * Handle mouse down on canvas to start resize
 * @param {MouseEvent} event - Mouse event
 * @param {number} floorIndex - Floor index
 */
function handleResizeMouseDown(event, floorIndex) {
    const sel = uiState.selectedPlacement;
    if (!sel || sel.floorIndex !== floorIndex || resizeState.isResizing) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    const { floorLength } = getCurrentFloorDimensions();
    const pixelsPerMeter = canvas.width / floorLength;

    const placement = shipData.componentPlacements[sel.componentIndex];
    if (!placement || !placement.floors || !placement.floors[sel.placementIndex]) return;

    const pos = placement.floors[sel.placementIndex];
    const placementData = {
        x: pos.x,
        y: pos.y,
        length: pos.length || placement.length,
        width: pos.width || placement.width
    };

    const edge = detectEdge(mouseX, mouseY, placementData, pixelsPerMeter);

    if (edge) {
        // Start resize
        event.preventDefault();
        event.stopPropagation();
        startResize(edge, sel.componentIndex, sel.placementIndex, floorIndex, mouseX, mouseY);
    }
}

/**
 * Handle mouse up to commit resize
 */
function handleResizeMouseUp(event) {
    if (resizeState.isResizing) {
        event.preventDefault();
        event.stopPropagation();
        commitResize();
    }
}

// ========================================
// UI Instructions
// ========================================

/**
 * Show resize mode instructions
 */
function showResizeInstructions() {
    let instructions = document.getElementById('placement-instructions');
    if (!instructions) {
        instructions = document.createElement('div');
        instructions.id = 'placement-instructions';
        instructions.className = 'placement-instructions';
        document.body.appendChild(instructions);
    }
    instructions.textContent = 'Drag edge to resize | Escape to cancel';
    instructions.classList.remove('hidden');
}

/**
 * Hide resize instructions
 */
function hideResizeInstructions() {
    const instructions = document.getElementById('placement-instructions');
    if (instructions && resizeState.isResizing === false) {
        // Only hide if we're showing resize instructions
        const isShowingResizeText = instructions.textContent.includes('resize');
        if (isShowingResizeText && uiState.selectedPlacement) {
            // Restore selection instructions
            showSelectionInstructions();
        } else if (isShowingResizeText) {
            instructions.classList.add('hidden');
        }
    }
}

// ========================================
// Setup and Integration
// ========================================

/**
 * Setup resize handlers for a canvas
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {number} floorIndex - Floor index
 */
function setupResizeHandlers(canvas, floorIndex) {
    if (!canvas) return;

    // Remove existing handlers to avoid duplicates
    if (canvas._resizeMouseMoveHandler) {
        canvas.removeEventListener('mousemove', canvas._resizeMouseMoveHandler);
    }
    if (canvas._resizeMouseDownHandler) {
        canvas.removeEventListener('mousedown', canvas._resizeMouseDownHandler);
    }

    // Create bound handlers
    const mouseMoveHandler = (e) => handleResizeMouseMove(e, floorIndex);
    const mouseDownHandler = (e) => handleResizeMouseDown(e, floorIndex);

    // Store handlers on canvas for removal later
    canvas._resizeMouseMoveHandler = mouseMoveHandler;
    canvas._resizeMouseDownHandler = mouseDownHandler;

    // Attach handlers
    canvas.addEventListener('mousemove', mouseMoveHandler);
    canvas.addEventListener('mousedown', mouseDownHandler);
}

/**
 * Setup global mouse up handler
 */
function setupGlobalResizeHandlers() {
    document.addEventListener('mouseup', handleResizeMouseUp);

    // Handle escape key to cancel
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && resizeState.isResizing) {
            cancelResize();
        }
    });
}

// Initialize global handlers
setupGlobalResizeHandlers();
