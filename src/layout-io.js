/**
 * Starship Architect - Layout Save/Load Module
 *
 * A layout file (*.starship.json) holds everything needed to rebuild a floor
 * plan: the ship design (the original CSV, embedded so the file stands alone),
 * the floor settings, options, and every placement.
 *
 * Placements are stored by a stable component key, not by component index, so
 * a layout can be applied to a revised CSV ("tolerant" loading): components
 * that still match keep their places, and everything that can't be restored is
 * reported rather than silently dropped.
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - placement-geometry.js (getPlacementRects, getPlacementCount)
 * - hull-access.js (getHullBounds, requiresHullAccess, getShapedInner, touchesFloorHull)
 * - hull-shapes.js (HULL_BAND_STEP, isRectInConvexPolygon, resolveHullShape)
 * - floor-utils.js (getFloorGeometry)
 * - component-dimensions.js (canTakeIrregularSpace)
 */

// ========================================
// Constants
// ========================================

const LAYOUT_FORMAT = 'starship-architect-layout';
const LAYOUT_VERSION = 5;

/** Tons over a component's total that count as rounding when restoring */
const LAYOUT_TONS_EPS = 0.01;

/** Tolerance (meters) for bounds and overlap checks */
const LAYOUT_EPS = 1e-6;

// ========================================
// Component Keys
// ========================================

/**
 * Item name without a quantity suffix ("Staterooms (x140)" -> "Staterooms")
 */
function baseItemName(component) {
    return (component.itemName || component.item || '')
        .replace(/\s*(\(\s*[xX×]\s*\d+\s*\)|[xX×]\s*\d+)$/, '')
        .trim();
}

/**
 * Stable keys for components: "category|item|n", where n counts earlier
 * components with the same category and item (designs can repeat a row, e.g.
 * two identical turrets)
 * @param {Array<object>} components
 * @returns {string[]} Key per component index
 */
function buildComponentKeys(components) {
    const seen = {};
    return components.map(c => {
        const base = `${c.category || ''}|${c.item || ''}`;
        const n = seen[base] || 0;
        seen[base] = n + 1;
        return `${base}|${n}`;
    });
}

/**
 * Looser identities used when exact keys don't match, most specific first:
 * same item text in another category, then same item name with a different
 * quantity ("Staterooms (x140)" in the layout, "Staterooms (x120)" now)
 * @returns {string[][]} Per component: [itemKey, nameKey]
 */
function buildFallbackKeys(components) {
    const seenItem = {};
    const seenName = {};
    return components.map(c => {
        const item = (c.item || '').toLowerCase();
        const name = baseItemName(c).toLowerCase();
        const ni = seenItem[item] || 0;
        const nn = seenName[name] || 0;
        seenItem[item] = ni + 1;
        seenName[name] = nn + 1;
        return [`item:${item}|${ni}`, `name:${name}|${nn}`];
    });
}

// ========================================
// Saving
// ========================================

/**
 * Copy a placement entry with only the fields a layout stores
 */
function serializeEntry(pos, placement) {
    const rects = getPlacementRects(pos, placement);
    const out = {
        floor: pos.floor,
        x: pos.x,
        y: pos.y,
        length: pos.length || (placement && placement.length),
        width: pos.width || (placement && placement.width)
    };
    if (getPlacementCount(pos) > 1) out.count = getPlacementCount(pos);
    if (pos.tons > 0) out.tons = pos.tons;
    if (pos.roomShape) Object.assign(out, getRoomFields(pos));
    if (pos.rects && pos.rects.length > 0) {
        out.rects = rects.map(r => ({ x: r.x, y: r.y, length: r.length, width: r.width }));
    }
    return out;
}

/**
 * Build a layout object from ship state
 * @param {object} ship - shipData (plus floorWidth from getCurrentFloorDimensions)
 * @param {Date} now - Save time (injectable for tests)
 * @returns {object} Layout ready for JSON.stringify
 */
function serializeLayout(ship, now = new Date()) {
    const keys = buildComponentKeys(ship.components);
    const placements = [];
    ship.components.forEach((c, i) => {
        const placement = ship.componentPlacements[i];
        if (!placement || !placement.floors || placement.floors.length === 0) return;
        placements.push({
            component: keys[i],
            item: c.item,
            entries: placement.floors.map(pos => serializeEntry(pos, placement))
        });
    });

    return {
        format: LAYOUT_FORMAT,
        version: LAYOUT_VERSION,
        savedAt: now.toISOString(),
        ship: {
            name: ship.shipName || '',
            totalTons: ship.totalTons,
            totalCost: ship.totalCost,
            csv: ship.originalCsv || ''
        },
        floors: {
            shape: ship.hullShape || 'rectangular',
            count: ship.numFloors,
            length: ship.floorLength,
            ceilingHeight: ship.ceilingHeight,
            width: ship.floorWidth,
            armorTons: ship.armorTons || 0,
            armorThickness: ship.armorThickness || 0
        },
        options: {
            combineRecHealth: !!ship.combineRecHealth
        },
        placements
    };
}

// ========================================
// Parsing and Validation
// ========================================

const isNum = v => typeof v === 'number' && isFinite(v);

/**
 * Upgrade older layouts to the current version.
 * Version 1 didn't record a hull shape, and its rooms were laid out on rectangular
 * floors, so it stays rectangular even if its design file now names a shape.
 * Version 3 adds `tons` to entries placed by tonnage. An entry without it is worked
 * out from its floor area, so version 2 needs no changes.
 * @param {object} layout
 * @returns {object}
 */
function migrateLayout(layout) {
    if (layout.version >= LAYOUT_VERSION) return layout;
    let floors = layout.floors;
    if (layout.version < 2 && floors && typeof floors === 'object') {
        floors = { ...floors, shape: 'rectangular' };
    }
    return { ...layout, version: LAYOUT_VERSION, floors };
}

/**
 * Hull shape a layout should open with
 * @param {object} layout - Parsed layout
 * @returns {{shape: string, problem: string|null}} A shape that can be built, and a
 *   message for the user if that isn't the one the file asks for
 */
function getLayoutHullShape(layout) {
    const saved = layout.floors.shape;
    const shape = resolveHullShape(saved);
    return {
        shape,
        problem: shape === saved ? null : `The layout asks for a "${saved}" hull, which isn't available, so it opened as ${shape}.`
    };
}

/**
 * Parse and validate layout file text
 * @param {string} text - File contents
 * @returns {object} Layout (migrated to the current version)
 * @throws {Error} With a message suitable for the user
 */
function parseLayout(text) {
    let layout;
    try {
        layout = JSON.parse(text);
    } catch (e) {
        throw new Error('This file is not a Starship Architect layout (it is not valid JSON).');
    }
    if (!layout || typeof layout !== 'object' || layout.format !== LAYOUT_FORMAT) {
        throw new Error('This file is not a Starship Architect layout.');
    }
    if (!Number.isInteger(layout.version) || layout.version < 1) {
        throw new Error('This layout file has no valid version number.');
    }
    if (layout.version > LAYOUT_VERSION) {
        throw new Error(`This layout was saved by a newer version of Starship Architect (format ${layout.version}); ` +
            `this version reads format ${LAYOUT_VERSION}.`);
    }
    layout = migrateLayout(layout);

    const { ship, floors } = layout;
    if (!ship || typeof ship.csv !== 'string' || ship.csv.trim() === '') {
        throw new Error('This layout does not contain its ship design.');
    }
    if (!floors || !Number.isInteger(floors.count) || floors.count < 1 ||
        !isNum(floors.length) || floors.length <= 0 ||
        !isNum(floors.ceilingHeight) || floors.ceilingHeight <= 0) {
        throw new Error('This layout has invalid floor settings.');
    }
    if (!Array.isArray(layout.placements)) layout.placements = [];
    if (!layout.options || typeof layout.options !== 'object') layout.options = {};
    return layout;
}

/**
 * Compare two CSV texts ignoring line endings and trailing whitespace
 */
function sameDesignCsv(a, b) {
    const norm = s => String(s || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();
    return norm(a) === norm(b);
}

// ========================================
// Restoring Placements (tolerant)
// ========================================

/**
 * Check one entry's numbers; returns the cleaned entry or null
 */
function cleanEntry(raw) {
    if (!raw || !Number.isInteger(raw.floor)) return null;
    if (![raw.x, raw.y, raw.length, raw.width].every(isNum) || raw.length <= 0 || raw.width <= 0) return null;
    const entry = { floor: raw.floor, x: raw.x, y: raw.y, length: raw.length, width: raw.width };
    if (raw.count !== undefined) {
        if (!Number.isInteger(raw.count) || raw.count < 1) return null;
        if (raw.count > 1) entry.count = raw.count;
    }
    if (raw.tons !== undefined) {
        if (!isNum(raw.tons) || raw.tons <= 0) return null;
        entry.tons = raw.tons;
    }
    if (raw.roomShape === 'circle') {
        if (Math.abs(raw.length - raw.width) > LAYOUT_EPS) return null;
        entry.roomShape = 'circle';
    } else if (raw.roomShape === 'arc') {
        if (!isNum(raw.arcAngle) || !isNum(raw.arcArea) || raw.arcArea <= 0) return null;
        Object.assign(entry, { roomShape: 'arc', arcAngle: raw.arcAngle, arcArea: raw.arcArea });
    } else if (raw.roomShape === 'ring') {
        const { ringOuter, ringInner, ringAngle, ringSweep } = raw;
        if (![ringOuter, ringInner, ringAngle, ringSweep].every(isNum)) return null;
        if (ringInner < 0 || ringOuter <= ringInner || ringSweep <= 0 || ringSweep > FULL_TURN + LAYOUT_EPS) return null;
        Object.assign(entry, { roomShape: 'ring', ringOuter, ringInner, ringAngle, ringSweep });
    } else if (raw.roomShape !== undefined) {
        return null;
    }
    if (raw.rects !== undefined) {
        if (!Array.isArray(raw.rects) || raw.rects.length === 0) return null;
        const rects = raw.rects.map(r => (r && [r.x, r.y, r.length, r.width].every(isNum) && r.length > 0 && r.width > 0
            ? { x: r.x, y: r.y, length: r.length, width: r.width } : null));
        if (rects.includes(null)) return null;
        entry.rects = rects;
    }
    return entry;
}

/**
 * Whether an entry's rectangles are inside the usable space of its floor.
 * Free regions on a curved or sloping floor are built from bands that can poke
 * past the wall by up to half a band, which is less than HULL_BAND_STEP.
 */
function entryFitsFloor(entry, bounds) {
    if (entry.roomShape) return isRoomFitting(entry, [entry.floor]);
    const rects = getPlacementRects(entry);
    const inner = getShapedInner(entry.floor);
    if (!inner) {
        return rects.every(r => r.x >= bounds.x0 - LAYOUT_EPS && r.y >= bounds.y0 - LAYOUT_EPS &&
            r.x + r.length <= bounds.x1 + LAYOUT_EPS && r.y + r.width <= bounds.y1 + LAYOUT_EPS);
    }
    const isBanded = entry.rects && !getFloorGeometry(entry.floor).isRectangle;
    const slack = isBanded ? HULL_BAND_STEP : LAYOUT_EPS;
    return rects.every(r => isRectInConvexPolygon(inner, r.x, r.y, r.length, r.width, slack));
}

/**
 * Whether a hull component's entry is against the hull. A component spanning
 * floors is saved as one entry per floor, and only has to touch on one of them.
 */
function entryTouchesHull(entry, savedEntries, floor) {
    const armor = floor.armorThickness || 0;
    const spanned = savedEntries.map(cleanEntry).filter(other => other &&
        other.floor >= 1 && other.floor <= floor.count &&
        Math.abs(other.x - entry.x) <= LAYOUT_EPS && Math.abs(other.y - entry.y) <= LAYOUT_EPS &&
        Math.abs(other.length - entry.length) <= LAYOUT_EPS && Math.abs(other.width - entry.width) <= LAYOUT_EPS);
    return spanned.some(e => (e.roomShape
        ? roomTouchesHull(e, [e.floor])
        : touchesFloorHull(e.floor, e.x, e.y, e.length, e.width, floor.length, floor.width, armor)));
}

/**
 * Restore a layout's placements onto a set of components.
 *
 * Components are matched by exact key, then by item text, then by item name
 * ignoring quantity. Entries are dropped (and reported) when they are
 * malformed, on a floor that doesn't exist, outside the usable area, off the
 * hull for a hull component, overlapping something already restored, or hold
 * more items than the component now has (a block is trimmed to what is left).
 * Set shipData.hullShape first: fit and hull checks follow the current ship's shape.
 *
 * @param {object} layout - Parsed layout
 * @param {Array<object>} components - Current components
 * @param {object} floor - { count, length, width, armorThickness } of the current ship
 * @returns {{placements: object, problems: string[], restored: number, dropped: number}}
 */
function restorePlacements(layout, components, floor) {
    const keys = buildComponentKeys(components);
    const fallbacks = buildFallbackKeys(components);
    const byKey = new Map(keys.map((k, i) => [k, i]));
    const byFallback = new Map();
    fallbacks.forEach((fk, i) => fk.forEach(k => { if (!byFallback.has(k)) byFallback.set(k, i); }));

    // Fallback identities of the saved components, computed the same way
    const savedComponents = layout.placements.map(p => {
        const parts = String(p.component || '').split('|');
        const item = p.item !== undefined ? p.item : parts.slice(1, -1).join('|');
        return { category: parts[0] || '', item, itemName: item };
    });
    const savedFallbacks = buildFallbackKeys(savedComponents);

    const bounds = getHullBounds(floor.length, floor.width, floor.armorThickness || 0);
    const placements = {};
    const problems = [];
    const used = new Set();
    const restoredEntries = {}; // floor -> entries already restored
    let restored = 0;
    let dropped = 0;

    // Match saved groups to components: exact keys first for every group, then
    // the looser identities, so a loose match can't take an exact match's component
    const matched = layout.placements.map(saved => {
        const i = byKey.get(saved.component);
        if (i === undefined || used.has(i)) return undefined;
        used.add(i);
        return i;
    });
    layout.placements.forEach((saved, si) => {
        if (matched[si] !== undefined) return;
        const i = savedFallbacks[si].map(k => byFallback.get(k)).find(c => c !== undefined && !used.has(c));
        if (i !== undefined) {
            used.add(i);
            matched[si] = i;
        }
    });

    layout.placements.forEach((saved, si) => {
        const label = saved.item || saved.component || `placement group ${si + 1}`;
        const entries = Array.isArray(saved.entries) ? saved.entries : [];
        const index = matched[si];
        if (index === undefined) {
            const items = entries.reduce((sum, e) => sum + ((e && e.count) || 1), 0);
            problems.push(`"${label}" is not in this ship design; ${items} placed item${items === 1 ? '' : 's'} not restored.`);
            dropped += entries.length;
            return;
        }

        const component = components[index];
        const name = component.item;
        const quantity = component.quantity || 1;
        const hull = requiresHullAccess(component);
        const byTons = canTakeIrregularSpace(component);
        let placedItems = 0;
        let placedTons = 0;
        const kept = [];

        entries.forEach((raw, ei) => {
            const where = `"${name}" placement ${ei + 1}`;
            const entry = cleanEntry(raw);
            if (!entry) {
                problems.push(`${where} is damaged in the file and was skipped.`);
                dropped++;
                return;
            }
            if (entry.floor < 1 || entry.floor > floor.count) {
                problems.push(`${where} is on floor ${entry.floor}, but the ship has ${floor.count} floor${floor.count === 1 ? '' : 's'}.`);
                dropped++;
                return;
            }

            if (!entryFitsFloor(entry, bounds)) {
                problems.push(`${where} (floor ${entry.floor}) no longer fits inside the hull and armor.`);
                dropped++;
                return;
            }
            // An arc or ring room goes by the floor's center and wall, so its box
            // comes from the floor as it is now
            if (entry.roomShape === 'arc' || entry.roomShape === 'ring') {
                const box = getPolygonBounds(getRoomOutline(entry));
                Object.assign(entry, { x: box.x, y: box.y, length: box.length, width: box.width });
            }
            if (hull && !entryTouchesHull(entry, entries, floor)) {
                problems.push(`${where} (floor ${entry.floor}) no longer touches the outer hull.`);
                dropped++;
                return;
            }
            const others = restoredEntries[entry.floor] || [];
            if (others.some(o => placementsOverlap(entry, o, undefined, LAYOUT_EPS))) {
                problems.push(`${where} (floor ${entry.floor}) overlaps another component.`);
                dropped++;
                return;
            }

            if (byTons) {
                let tons = getEntryTons(entry);
                const tonsLeft = component.tons - placedTons;
                if (tons > tonsLeft + LAYOUT_TONS_EPS) {
                    if (tonsLeft <= LAYOUT_TONS_EPS) {
                        problems.push(`${where} was skipped: all ${component.tons} tons of ${name} are already placed.`);
                        dropped++;
                        return;
                    }
                    problems.push(`${where} held ${tons.toFixed(1)} tons; only ${tonsLeft.toFixed(1)} remain in the design, so it now holds ${tonsLeft.toFixed(1)}.`);
                    tons = tonsLeft;
                }
                entry.tons = tons;
                delete entry.count;
                placedTons += entry.tons;
                kept.push(entry);
                restoredEntries[entry.floor] = others.concat([entry]);
                restored++;
                return;
            }
            delete entry.tons;

            // One item spanning floors is saved as an entry per floor, in the same spot
            const spansFloors = quantity === 1 && kept.some(k => k.floor !== entry.floor &&
                Math.abs(k.x - entry.x) <= LAYOUT_EPS && Math.abs(k.y - entry.y) <= LAYOUT_EPS &&
                Math.abs(k.length - entry.length) <= LAYOUT_EPS && Math.abs(k.width - entry.width) <= LAYOUT_EPS);
            if (spansFloors) {
                kept.push(entry);
                restoredEntries[entry.floor] = others.concat([entry]);
                restored++;
                return;
            }

            const count = entry.count || 1;
            const left = quantity - placedItems;
            if (left <= 0) {
                problems.push(`${where} was skipped: all ${quantity} ${name} are already placed.`);
                dropped++;
                return;
            }
            if (count > left) {
                problems.push(`${where} held ${count} items; only ${left} remain in the design, so it now holds ${left}.`);
                if (left > 1) entry.count = left;
                else delete entry.count;
            }

            placedItems += entry.count || 1;
            kept.push(entry);
            restoredEntries[entry.floor] = others.concat([entry]);
            restored++;
        });

        if (kept.length > 0) placements[index] = { floors: kept };
    });

    return { placements, problems, restored, dropped };
}

/**
 * Compare saved floor dimensions with the ones the current ship produces
 * @returns {string[]} Messages for differences worth mentioning
 */
function compareFloorGeometry(layout, floor) {
    const notes = [];
    const saved = layout.floors;
    if (isNum(saved.width) && Math.abs(saved.width - floor.width) > 0.05) {
        notes.push(`Floors are now ${floor.width.toFixed(1)} m wide (the layout was saved at ${saved.width.toFixed(1)} m).`);
    }
    if (isNum(saved.armorThickness) && Math.abs(saved.armorThickness - (floor.armorThickness || 0)) > 0.005) {
        notes.push(`Armor is now ${(floor.armorThickness || 0).toFixed(2)} m thick ` +
            `(the layout was saved with ${saved.armorThickness.toFixed(2)} m).`);
    }
    return notes;
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        LAYOUT_FORMAT,
        LAYOUT_VERSION,
        baseItemName,
        buildComponentKeys,
        buildFallbackKeys,
        serializeLayout,
        parseLayout,
        migrateLayout,
        getLayoutHullShape,
        sameDesignCsv,
        restorePlacements,
        compareFloorGeometry
    };
}
