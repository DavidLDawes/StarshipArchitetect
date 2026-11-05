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
 * Add a polygon to the current canvas path
 */
function tracePolygon(ctx, polygon, pixelsPerMeter) {
    polygon.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x * pixelsPerMeter, y * pixelsPerMeter);
        else ctx.lineTo(x * pixelsPerMeter, y * pixelsPerMeter);
    });
    ctx.closePath();
}

/**
 * Small arrow at the canvas edge showing which way the ship points
 * @param {string} direction - 'left' or 'top'
 */
function drawBowMarker(ctx, direction, canvasWidth, canvasHeight) {
    const size = 9;
    const horizontal = direction === 'left';
    const x = horizontal ? size + 3 : canvasWidth / 2;
    const y = horizontal ? canvasHeight / 2 : size + 3;

    ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
    ctx.beginPath();
    if (horizontal) {
        ctx.moveTo(x - size, y);
        ctx.lineTo(x + size, y - size);
        ctx.lineTo(x + size, y + size);
    } else {
        ctx.moveTo(x, y - size);
        ctx.lineTo(x - size, y + size);
        ctx.lineTo(x + size, y + size);
    }
    ctx.closePath();
    ctx.fill();

    ctx.font = '12px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = horizontal ? 'left' : 'center';
    ctx.fillText('Bow', horizontal ? x + size + 4 : x, horizontal ? y : y + size + 10);
    ctx.textBaseline = 'alphabetic';
}

/**
 * Draw the grid, hull outline, and armor band of a floor with a shaped hull.
 * The canvas is the frame every floor shares, so a small floor looks small.
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} length - Frame length in meters
 * @param {number} width - Frame width in meters
 * @param {object} floor - Floor from buildFloorGeometry
 * @param {number} armorThickness - Armor thickness in meters
 * @param {string} shape - Hull shape
 */
function drawShapedFloorGrid(canvas, length, width, floor, armorThickness, shape) {
    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const pixelsPerMeter = canvasWidth / length;

    // Space outside this floor's hull
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Deck with its grid, clipped to the hull
    ctx.save();
    ctx.beginPath();
    tracePolygon(ctx, floor.outline, pixelsPerMeter);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(100, 149, 237, 0.3)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= length; x++) {
        ctx.beginPath();
        ctx.moveTo(x * pixelsPerMeter, 0);
        ctx.lineTo(x * pixelsPerMeter, canvasHeight);
        ctx.stroke();
    }
    for (let y = 0; y <= width; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * pixelsPerMeter);
        ctx.lineTo(canvasWidth, y * pixelsPerMeter);
        ctx.stroke();
    }
    ctx.restore();

    // Armor band between the hull and its inner face
    if (armorThickness > 0) {
        ctx.beginPath();
        tracePolygon(ctx, floor.outline, pixelsPerMeter);
        if (floor.inner.length > 0) tracePolygon(ctx, floor.inner, pixelsPerMeter);
        ctx.fillStyle = 'rgba(150, 150, 150, 0.3)';
        ctx.fill('evenodd');

        if (floor.inner.length > 0) {
            ctx.beginPath();
            tracePolygon(ctx, floor.inner, pixelsPerMeter);
            ctx.strokeStyle = 'rgba(180, 180, 180, 0.6)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Hull outline
    ctx.beginPath();
    tracePolygon(ctx, floor.outline, pixelsPerMeter);
    ctx.strokeStyle = 'rgba(100, 149, 237, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Size of this floor, centered under its hull
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    const { x, y, length: floorLength, width: floorWidth } = floor.bounds;
    const labelX = (x + floorLength / 2) * pixelsPerMeter;
    const labelY = Math.min((y + floorWidth) * pixelsPerMeter - 8, canvasHeight - 8);
    ctx.fillText(describeFloorSize(floor, shape), labelX, labelY);

    if (armorThickness > 0) {
        ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Armor: ${armorThickness.toFixed(2)}m`, 10, 20);
    }

    const { bow } = HULL_SHAPES[shape];
    if (bow) drawBowMarker(ctx, bow, canvasWidth, canvasHeight);
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
    const shape = getShipGeometry().shape;
    const floorGeometry = getFloorGeometry(floorIndex);
    if (shape !== 'rectangular' && floorGeometry) {
        drawShapedFloorGrid(canvas, length, width, floorGeometry, armorThickness, shape);
    } else {
        drawFloorGrid(canvas, length, width, armorThickness);
    }

    const ctx = canvas.getContext('2d');
    const canvasWidth = canvas.width;
    const pixelsPerMeter = canvasWidth / length;

    // Draw each component placed on this floor
    for (const [compIdxStr, placement] of Object.entries(placements)) {
        const compIdx = parseInt(compIdxStr);
        const component = components[compIdx];

        if (!placement.floors) continue;

        // Running item number so single items are labelled 1, 2, 3... across blocks
        let itemNum = 0;
        for (const pos of placement.floors) {
            const count = getPlacementCount(pos);
            const firstItemNum = itemNum + 1;
            itemNum += count;
            if (pos.floor !== floorIndex) continue;

            if (pos.rects && pos.rects.length > 0) {
                drawPlacedShape(ctx, pos.rects, component, pixelsPerMeter, compIdx, count);
            } else {
                // Use per-placement dimensions (fallback to component-level for backwards compatibility)
                const pLength = pos.length || placement.length;
                const pWidth = pos.width || placement.width;
                drawPlacedComponent(ctx, pos.x, pos.y, pLength, pWidth,
                    component, pixelsPerMeter, compIdx, firstItemNum, count);
            }
        }
    }
}

/**
 * Fill/stroke colors for a component (stable per component index)
 */
function getComponentColors(compIdx) {
    const hue = (compIdx * 47) % 360;
    return {
        fill: `hsl(${hue}, 50%, 35%)`,
        stroke: `hsl(${hue}, 60%, 55%)`
    };
}

/**
 * Build the label shown on a placed component
 * @param {object} component - Component data
 * @param {number} placementNum - Item number of a single item (1, 2, 3...)
 * @param {number} count - Items held by this placement
 * @returns {string}
 */
function getPlacementLabel(component, placementNum, count) {
    // Get component name - use itemName for multi-quantity, remove any "xN" suffix
    let baseName = (component.itemName || component.item).replace(/\s*x\d+$/, '');
    // Staterooms combined with rec/health include that space
    if (component.overheadPerItem > 0) baseName += ' + rec';
    if (count > 1) {
        return `${baseName} ×${count}`;
    }
    if (component.quantity && component.quantity > 1) {
        return `${baseName} ${placementNum}`;
    }
    return baseName;
}

/**
 * Draw a label centered at (cx, cy), truncated to fit maxWidthPx
 */
function drawFittedLabel(ctx, text, cx, cy, maxWidthPx) {
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Calculate max chars that fit in the width
    let name = text;
    const maxChars = Math.floor(maxWidthPx / 7);
    if (name.length > maxChars && maxChars > 3) {
        name = name.substring(0, maxChars - 2) + '..';
    } else if (maxChars <= 3) {
        name = name.substring(0, 3);
    }

    // Draw text with shadow for visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(name, cx, cy);
    ctx.shadowBlur = 0;
}

/**
 * Draw an odd-shaped placement (a union of rectangles) on the canvas
 * The outline is drawn first and then covered by the fills, so only the outer
 * boundary remains visible and internal seams between rectangles disappear.
 */
function drawPlacedShape(ctx, rects, component, pixelsPerMeter, compIdx, count) {
    const colors = getComponentColors(compIdx);
    const toPx = r => [r.x * pixelsPerMeter, r.y * pixelsPerMeter, r.length * pixelsPerMeter, r.width * pixelsPerMeter];

    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 4;
    for (const r of rects) ctx.strokeRect(...toPx(r));

    ctx.fillStyle = colors.fill;
    for (const r of rects) ctx.fillRect(...toPx(r));

    // Diagonal hatching marks this as a region allocation rather than a single room
    ctx.save();
    ctx.beginPath();
    for (const r of rects) ctx.rect(...toPx(r));
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    const box = getBoundingBox(rects);
    const [bx, by, bw, bh] = toPx(box);
    for (let d = -bh; d < bw; d += 10) {
        ctx.beginPath();
        ctx.moveTo(bx + d, by);
        ctx.lineTo(bx + d + bh, by + bh);
        ctx.stroke();
    }
    ctx.restore();

    // Label goes in the widest rectangle tall enough for a line of text
    // (labels are horizontal, so a long thin vertical strip is a poor spot)
    const label = getPlacementLabel(component, 1, count);
    const tallEnough = rects.filter(r => r.width * pixelsPerMeter >= 16);
    const candidates = tallEnough.length > 0 ? tallEnough : rects;
    const best = candidates.reduce((a, b) => (b.length > a.length ? b : a));
    const [lx, ly, lw, lh] = toPx(best);
    drawFittedLabel(ctx, label, lx + lw / 2, ly + lh / 2, lw);
}

/**
 * Draw a placed component on the canvas
 * @param {number} placementNum - The individual item number (1, 2, 3, etc.)
 * @param {number} count - Number of items held by this rectangle
 */
function drawPlacedComponent(ctx, x, y, compLength, compWidth, component, pixelsPerMeter, compIdx, placementNum = 1, count = 1) {
    const px = x * pixelsPerMeter;
    const py = y * pixelsPerMeter;
    const pw = compLength * pixelsPerMeter;
    const ph = compWidth * pixelsPerMeter;

    // Color based on component index - fully opaque to cover grid
    const colors = getComponentColors(compIdx);

    ctx.fillStyle = colors.fill;
    ctx.fillRect(px, py, pw, ph);

    // Border
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    drawFittedLabel(ctx, getPlacementLabel(component, placementNum, count), px + pw / 2, py + ph / 2, pw);
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
