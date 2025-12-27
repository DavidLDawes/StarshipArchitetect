/**
 * Starship Architect - Canvas Renderer Module
 * Handles all canvas drawing operations for floor plans
 */

/**
 * Draw a grid on the floor canvas
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} length - Floor length in meters
 * @param {number} width - Floor width in meters
 */
function drawFloorGrid(canvas, length, width) {
    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Clear canvas with a subtle background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Calculate grid spacing (1 meter = X pixels)
    const pixelsPerMeter = canvasWidth / length;

    // Draw grid lines
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

    // Draw border
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
}

/**
 * Draw a floor with all placed components
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} floorIndex - Floor number (1-based)
 * @param {number} length - Floor length in meters
 * @param {number} width - Floor width in meters
 */
function drawFloorWithComponents(canvas, floorIndex, length, width) {
    // First draw the base grid
    drawFloorGrid(canvas, length, width);

    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const pixelsPerMeter = canvasWidth / length;

    // Debug: log placements being drawn
    console.log(`Drawing floor ${floorIndex}, placements:`, JSON.stringify(shipData.componentPlacements));

    // Draw each component placed on this floor
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        const compIdx = parseInt(compIdxStr);
        const component = shipData.components[compIdx];

        if (!placement.floors) continue;

        for (const pos of placement.floors) {
            if (pos.floor === floorIndex) {
                console.log(`Drawing component ${component.item} at (${pos.x}, ${pos.y}) size ${placement.length}x${placement.width}`);
                drawPlacedComponent(ctx, pos.x, pos.y, placement.length, placement.width,
                    component, pixelsPerMeter, compIdx);
            }
        }
    }
}

/**
 * Draw a placed component on the canvas
 */
function drawPlacedComponent(ctx, x, y, compLength, compWidth, component, pixelsPerMeter, compIdx) {
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

    // Get component name
    let name = component.item;

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
