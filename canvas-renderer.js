/**
 * Starship Architect - Canvas Renderer Module
 * Handles all canvas drawing operations for floor plans
 */

/**
 * Draw a grid on the floor canvas
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} length - Floor length in meters
 * @param {number} width - Floor width in meters
 * @param {number} armorThickness - Armor thickness in meters (defaults to 0)
 */
function drawFloorGrid(canvas, length, width, armorThickness = 0) {
    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Clear canvas with a subtle background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Calculate grid spacing (1 meter = X pixels)
    const pixelsPerMeter = canvasWidth / length;

    // Draw armor boundary if present
    if (armorThickness > 0) {
        const armorPixels = armorThickness * pixelsPerMeter;

        // Draw armor as a darker border
        ctx.fillStyle = 'rgba(150, 150, 150, 0.3)';

        // Top armor
        ctx.fillRect(0, 0, canvasWidth, armorPixels);

        // Bottom armor
        ctx.fillRect(0, canvasHeight - armorPixels, canvasWidth, armorPixels);

        // Left armor
        ctx.fillRect(0, 0, armorPixels, canvasHeight);

        // Right armor
        ctx.fillRect(canvasWidth - armorPixels, 0, armorPixels, canvasHeight);

        // Draw armor boundary line
        ctx.strokeStyle = 'rgba(180, 180, 180, 0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(armorPixels, armorPixels, canvasWidth - 2 * armorPixels, canvasHeight - 2 * armorPixels);
    }

    // Draw grid lines (only in usable area if armor present)
    ctx.strokeStyle = 'rgba(100, 149, 237, 0.3)';
    ctx.lineWidth = 1;

    // Vertical lines (every meter)
    for (let x = 0; x <= length; x++) {
        const px = x * pixelsPerMeter;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, canvasHeight);
        ctx.stroke();
    }

    // Horizontal lines (every meter)
    for (let y = 0; y <= width; y++) {
        const py = y * pixelsPerMeter;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(canvasWidth, py);
        ctx.stroke();
    }

    // Draw outer border
    ctx.strokeStyle = 'rgba(100, 149, 237, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvasWidth - 2, canvasHeight - 2);

    // Draw dimension labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';

    // Length label (bottom)
    ctx.fillText(`${length}m`, canvasWidth / 2, canvasHeight - 8);

    // Width label (right side, rotated)
    ctx.save();
    ctx.translate(canvasWidth - 8, canvasHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${width.toFixed(1)}m`, 0, 0);
    ctx.restore();

    // Armor thickness label (if armor present)
    if (armorThickness > 0) {
        ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Armor: ${armorThickness.toFixed(2)}m`, 10, 20);
    }
}

/**
 * Draw a floor with all placed components
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} floorIndex - Floor number (1-based)
 * @param {number} length - Floor length in meters
 * @param {number} width - Floor width in meters
 * @param {Object} placements - Component placements data (defaults to global shipData.componentPlacements)
 * @param {Array} components - Components array (defaults to global shipData.components)
 * @param {Object} selectedPlacement - Currently selected placement for highlighting (defaults to global uiState.selectedPlacement)
 * @param {number} armorThickness - Armor thickness in meters (defaults to global shipData.armorThickness)
 */
function drawFloorWithComponents(canvas, floorIndex, length, width, placements = shipData.componentPlacements, components = shipData.components, selectedPlacement = uiState.selectedPlacement, armorThickness = shipData.armorThickness) {
    // First draw the base grid with armor
    drawFloorGrid(canvas, length, width, armorThickness);

    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const pixelsPerMeter = canvasWidth / length;

    // Draw each component placed on this floor
    for (const [compIdxStr, placement] of Object.entries(placements)) {
        const compIdx = parseInt(compIdxStr);
        const component = components[compIdx];

        if (!placement.floors) continue;

        // Count placements to get individual numbering
        let placementNum = 0;
        for (const pos of placement.floors) {
            placementNum++;
            if (pos.floor === floorIndex) {
                // Use per-placement dimensions (fallback to component-level for backwards compatibility)
                const pLength = pos.length || placement.length;
                const pWidth = pos.width || placement.width;
                drawPlacedComponent(ctx, pos.x, pos.y, pLength, pWidth,
                    component, pixelsPerMeter, compIdx, placementNum);
            }
        }
    }
}

/**
 * Draw a placed component on the canvas
 * @param {number} placementNum - The individual placement number (1, 2, 3, etc.)
 */
function drawPlacedComponent(ctx, x, y, compLength, compWidth, component, pixelsPerMeter, compIdx, placementNum = 1) {
    const px = x * pixelsPerMeter;
    const py = y * pixelsPerMeter;
    const pw = compLength * pixelsPerMeter;
    const ph = compWidth * pixelsPerMeter;

    // Generate a color based on component index - fully opaque
    const hue = (compIdx * 47) % 360;
    const fillColor = `hsl(${hue}, 50%, 35%)`;
    const strokeColor = `hsl(${hue}, 60%, 55%)`;

    // Fill - solid/opaque to cover grid
    ctx.fillStyle = fillColor;
    ctx.fillRect(px, py, pw, ph);

    // Border
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    // Label - with text shadow for better readability
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Get component name - use itemName for multi-quantity, add individual number
    let baseName = component.itemName || component.item;
    // Remove any "xN" suffix if present
    baseName = baseName.replace(/\s*x\d+$/, '');

    // Add individual number for multi-quantity components
    let name = baseName;
    if (component.quantity && component.quantity > 1) {
        name = `${baseName} ${placementNum}`;
    }

    // Calculate max chars that fit in the width
    const maxChars = Math.floor(pw / 7);
    if (name.length > maxChars && maxChars > 3) {
        name = name.substring(0, maxChars - 2) + '..';
    } else if (maxChars <= 3) {
        name = name.substring(0, 3);
    }

    // Draw text with shadow for visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(name, px + pw / 2, py + ph / 2);
    ctx.shadowBlur = 0;
}

/**
 * Draw placement preview on canvas
 */
function drawPlacementPreview(canvas, x, y, compLength, compWidth, length, width, isValid) {
    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const pixelsPerMeter = canvasWidth / length;

    const px = x * pixelsPerMeter;
    const py = y * pixelsPerMeter;
    const pw = compLength * pixelsPerMeter;
    const ph = compWidth * pixelsPerMeter;

    // Preview color based on validity
    const fillColor = isValid ? 'rgba(0, 255, 100, 0.3)' : 'rgba(255, 0, 0, 0.3)';
    const strokeColor = isValid ? 'rgba(0, 255, 100, 0.8)' : 'rgba(255, 0, 0, 0.8)';

    ctx.fillStyle = fillColor;
    ctx.fillRect(px, py, pw, ph);

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.setLineDash([]);
}
