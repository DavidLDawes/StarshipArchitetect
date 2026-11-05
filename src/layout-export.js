/**
 * Starship Architect - Layout Export Module
 *
 * Exports the floor plan as SVG, which opens as editable vector shapes in
 * Inkscape, Illustrator, Figma, Affinity, diagrams.net, and browsers.
 *
 * The drawing is true to scale: coordinates are meters (viewBox) and the
 * document size is set in millimeters at a chosen scale (default 1:100, so
 * 1 m = 10 mm when printed). Each floor is a group (an Inkscape layer); each
 * placement is a rectangle (or a group of rectangles for odd-shaped regions)
 * carrying data-* attributes and a <title> tooltip.
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - placement-geometry.js (getPlacementRects, getPlacementCount)
 * - layout-io.js (buildComponentKeys, baseItemName)
 * - hull-shapes.js (describeFloorSize)
 */

// ========================================
// Helpers
// ========================================

/**
 * Escape text for XML content and attribute values
 */
function escapeXml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Round a coordinate for output (millimeter precision is plenty)
 */
function svgNum(v) {
    return String(Math.round(v * 1000) / 1000);
}

/**
 * Component colors; the same formula the canvas uses (canvas-renderer.js
 * getComponentColors) so exports match the screen
 */
function exportColors(componentIndex) {
    const hue = (componentIndex * 47) % 360;
    return { fill: `hsl(${hue}, 50%, 35%)`, stroke: `hsl(${hue}, 60%, 55%)` };
}

/**
 * SVG path data for a polygon
 */
function polygonPath(polygon) {
    return polygon.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${svgNum(x)} ${svgNum(y)}`).join('') + 'Z';
}

/**
 * Text shown on a placement: "Staterooms ×140", "Bridge"
 */
function exportLabel(component, count) {
    let name = baseItemName(component);
    if (component.overheadPerItem > 0) name += ' + rec';
    return count > 1 ? `${name} ×${count}` : name;
}

// ========================================
// SVG Export
// ========================================

/**
 * Build an SVG document of the floor plan
 * @param {object} ship - shipData plus floorWidth, and geometry from
 *   getShipGeometry() for a shaped hull (without it, floors are plain rectangles)
 * @param {object} options
 * @param {number[]} options.floors - Floors to include (default: all)
 * @param {number} options.mmPerMeter - Print scale (default 10, i.e. 1:100)
 * @param {number} options.gap - Space between floors in meters (default 6)
 * @returns {string} SVG markup
 */
function exportLayoutSvg(ship, options = {}) {
    const floorLength = ship.floorLength;
    const floorWidth = ship.floorWidth;
    const armor = ship.armorThickness || 0;
    const mmPerMeter = options.mmPerMeter || 10;
    const gap = options.gap !== undefined ? options.gap : 6;
    const floors = options.floors || Array.from({ length: ship.numFloors }, (_, i) => i + 1);
    const keys = buildComponentKeys(ship.components);
    const shaped = ship.geometry && ship.geometry.shape !== 'rectangular' ? ship.geometry : null;

    // Text sizes in meters, scaled to the floor so labels stay readable
    const titleSize = Math.max(1, Math.min(4, floorLength / 25));
    const margin = titleSize * 2;
    const headerHeight = titleSize * 2.5;
    const blockHeight = headerHeight + floorWidth;
    const totalWidth = floorLength + margin * 2;
    const totalHeight = margin + headerHeight + floors.length * blockHeight + (floors.length - 1) * gap + margin;

    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
        `width="${svgNum(totalWidth * mmPerMeter)}mm" height="${svgNum(totalHeight * mmPerMeter)}mm" ` +
        `viewBox="0 0 ${svgNum(totalWidth)} ${svgNum(totalHeight)}" font-family="Arial, Helvetica, sans-serif">`);
    const title = ship.shipName ? `${ship.shipName} — deck plan` : 'Deck plan';
    const sizeText = `${Number(floorLength.toFixed(1))} × ${Number(floorWidth.toFixed(1))} m`;
    out.push(`  <title>${escapeXml(title)}</title>`);
    const floorsText = shaped ? `${ship.numFloors} floors, ${shaped.shape} hull` : `${ship.numFloors} floors of ${sizeText}`;
    out.push(`  <desc>${escapeXml(`Starship Architect export. ${ship.totalTons} tons, ${floorsText}, ` +
        `ceiling ${ship.ceilingHeight} m, armor ${Number(armor.toFixed(3))} m. ` +
        `Units: meters; printed scale 1:${Math.round(1000 / mmPerMeter)}.`)}</desc>`);
    out.push(`  <rect x="0" y="0" width="${svgNum(totalWidth)}" height="${svgNum(totalHeight)}" fill="#ffffff"/>`);
    out.push(`  <text x="${svgNum(margin)}" y="${svgNum(margin + titleSize)}" font-size="${svgNum(titleSize * 1.2)}" ` +
        `font-weight="bold" fill="#111111">${escapeXml(title)}</text>`);

    floors.forEach((f, n) => {
        const top = margin + headerHeight + n * (blockHeight + gap);
        const fy = top + headerHeight; // floor rectangle origin
        const floorShape = shaped ? shaped.floors[f - 1] : null;
        const floorSize = floorShape ? describeFloorSize(floorShape, shaped.shape) : sizeText;
        out.push(`  <g id="floor-${f}" inkscape:groupmode="layer" inkscape:label="Floor ${f}" data-floor="${f}">`);
        out.push(`    <text x="${svgNum(margin)}" y="${svgNum(top + titleSize * 1.5)}" font-size="${svgNum(titleSize)}" fill="#111111">` +
            `${escapeXml(`Floor ${f} — ${floorSize}`)}</text>`);

        // Hull outline with the armor band
        out.push(`    <g transform="translate(${svgNum(margin)} ${svgNum(fy)})">`);
        if (floorShape) {
            if (armor > 0) {
                out.push(`      <path class="armor" fill="#9e9e9e" fill-rule="evenodd" d="${polygonPath(floorShape.outline)} ` +
                    `${floorShape.inner.length > 0 ? polygonPath(floorShape.inner) : ''}"/>`);
            }
            out.push(`      <path class="hull" d="${polygonPath(floorShape.outline)}" ` +
                'fill="none" stroke="#222222" stroke-width="0.15"/>');
        } else {
            if (armor > 0) {
                out.push(`      <path class="armor" fill="#9e9e9e" fill-rule="evenodd" d="M0 0H${svgNum(floorLength)}V${svgNum(floorWidth)}H0Z ` +
                    `M${svgNum(armor)} ${svgNum(armor)}V${svgNum(floorWidth - armor)}H${svgNum(floorLength - armor)}V${svgNum(armor)}Z"/>`);
            }
            out.push(`      <rect class="hull" x="0" y="0" width="${svgNum(floorLength)}" height="${svgNum(floorWidth)}" ` +
                'fill="none" stroke="#222222" stroke-width="0.15"/>');
        }

        // Free regions on a curved or sloping floor are built from bands that can
        // poke slightly past the wall, so they are clipped to the usable space
        const clipId = `floor-${f}-usable`;
        const clipRegions = floorShape && !floorShape.isRectangle && floorShape.inner.length > 0;
        if (clipRegions) {
            out.push(`      <clipPath id="${clipId}"><path d="${polygonPath(floorShape.inner)}"/></clipPath>`);
        }

        // Placements on this floor
        ship.components.forEach((component, ci) => {
            const placement = ship.componentPlacements[ci];
            if (!placement || !placement.floors) return;
            placement.floors.forEach(pos => {
                if (pos.floor !== f) return;
                const rects = getPlacementRects(pos, placement);
                const count = getPlacementCount(pos);
                const colors = exportColors(ci);
                const label = exportLabel(component, count);
                const tons = (component.tonsPerItem || component.tons) * count;
                const attrs = `data-component="${escapeXml(keys[ci])}" data-category="${escapeXml(component.category || '')}" ` +
                    `data-count="${count}"`;
                const tip = `${label} — ${svgNum(tons)} t, ${svgNum(rects.reduce((s, r) => s + r.length * r.width, 0))} m²`;

                const clip = clipRegions && pos.rects && pos.rects.length > 0 ? ` clip-path="url(#${clipId})"` : '';
                out.push(`      <g class="placement" ${attrs}${clip}>`);
                out.push(`        <title>${escapeXml(tip)}</title>`);
                for (const r of rects) {
                    out.push(`        <rect x="${svgNum(r.x)}" y="${svgNum(r.y)}" width="${svgNum(r.length)}" height="${svgNum(r.width)}" ` +
                        `fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="0.08"/>`);
                }

                // Label in the largest rectangle, sized to fit; tall narrow
                // shapes get the label turned to run along them
                const box = rects.reduce((a, b) => (b.length * b.width > a.length * a.width ? b : a));
                const vertical = box.width > box.length * 1.5;
                const along = vertical ? box.width : box.length;
                const across = vertical ? box.length : box.width;
                const size = Math.min(across * 0.45, (along * 1.8) / Math.max(4, label.length), titleSize);
                if (size >= 0.15) {
                    const cx = svgNum(box.x + box.length / 2);
                    const cy = svgNum(box.y + box.width / 2);
                    const rotate = vertical ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
                    out.push(`        <text x="${cx}" y="${cy}"${rotate} ` +
                        `font-size="${svgNum(size)}" fill="#ffffff" text-anchor="middle" dominant-baseline="central">` +
                        `${escapeXml(label)}</text>`);
                }
                out.push('      </g>');
            });
        });
        out.push('    </g>');
        out.push('  </g>');
    });

    out.push('</svg>');
    return out.join('\n') + '\n';
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = { escapeXml, exportColors, exportLabel, exportLayoutSvg };
}
