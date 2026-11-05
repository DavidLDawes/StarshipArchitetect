/**
 * Starship Architect - Curved Rooms Module
 *
 * Rooms that aren't rectangles. Their placement entries are the usual
 * { floor, x, y, length, width }, with x/y/length/width as the bounding box, plus:
 *   { roomShape: 'circle' }                     length and width are the diameter
 *   { roomShape: 'arc', arcAngle, arcArea }     the part of a round floor cut off by a
 *                                               straight line, so its curved side is
 *                                               the floor's own wall. arcAngle is the
 *                                               direction (radians) from the floor's
 *                                               center to the middle of that side.
 *
 * Every shape is convex, so the room's outline is a convex polygon and all the exact
 * fit and overlap checks work on that (getRoomOutline). Anything built on rectangles,
 * such as free-space analysis, gets the room as thin bands instead (getRoomRects). As
 * with a curved hull, those bands can poke slightly past the true outline, so a free
 * region can poke slightly into a room. Rooms are drawn on top of regions to hide it,
 * and placementsOverlap() allows it.
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - hull-shapes.js (polygons, walls, HULL_SHAPES, bands)
 * - hull-access.js (getShapedInner)
 * - floor-utils.js (getCurrentFloorDimensions, getShipGeometry)
 * - placement-geometry.js (getPlacementRects)
 * - component-dimensions.js (calculateComponentArea)
 */

/** Radii closer than this (meters) count as the same */
const ROOM_RADIUS_EPS = 1e-6;

/** Tolerance for rooms touching each other or the hull (meters) */
const ROOM_FIT_EPS = 1e-6;

/** Distance between the spots tried when sliding a circle to a free position (meters) */
const ROOM_SEARCH_STEP = 0.25;

/** Angle between the spots tried when sliding an arc around the wall */
const ARC_SEARCH_STEP = Math.PI / 36;

/** Refinements once a free spot is found, to end up close to what's in the way */
const ROOM_SEARCH_REFINEMENTS = 10;

/** Keeps a circle that exactly fits the floor from leaving nowhere for its center */
const CIRCLE_FIT_SLACK = 1e-9;

// ========================================
// Floors
// ========================================

/**
 * Usable space of a floor as a polygon, on a rectangular ship too
 * @param {number|number[]} floors - Floor number, or the floors a room spans
 * @returns {Array<[number, number]>} Convex polygon, empty if there is no usable space
 */
function getFloorInnerPolygon(floors) {
    const shaped = getShapedInner(floors);
    if (shaped) return shaped;
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    const armor = shipData.armorThickness || 0;
    const length = floorLength - 2 * armor;
    const width = floorWidth - 2 * armor;
    return length > 0 && width > 0 ? rectanglePolygon(armor, armor, length, width) : [];
}

/**
 * Whether the current ship's floors are circles
 * @returns {boolean}
 */
function isRoundHull() {
    return !!HULL_SHAPES[resolveHullShape(shipData.hullShape)].isRound;
}

/**
 * Radius of a round floor's wall, inside the armor
 * @param {number} floorIndex - Floor number
 * @returns {number} Radius in meters, 0 if the floor isn't round or has no usable space
 */
function getArcRadius(floorIndex) {
    if (!isRoundHull()) return 0;
    const floor = getFloorGeometry(floorIndex);
    if (!floor || floor.inner.length === 0) return 0;
    return getPolygonBounds(floor.inner).length / 2;
}

/**
 * Floors whose wall has a given radius
 * @param {number} radius - Radius in meters
 * @returns {number[]} Floor numbers
 */
function getFloorsWithRadius(radius) {
    const floors = [];
    for (let f = 1; f <= shipData.numFloors; f++) {
        const own = getArcRadius(f);
        if (own > 0 && Math.abs(own - radius) <= ROOM_RADIUS_EPS) floors.push(f);
    }
    return floors;
}

/**
 * Floors a room of this shape can go on, given a floor it is already on
 * @param {object} room - Room or placement data
 * @param {number} floorIndex - Floor it was just placed on
 * @returns {number[]} Floor numbers
 */
function getFloorsForRoom(room, floorIndex) {
    if (room.roomShape === 'arc') return getFloorsWithRadius(getArcRadius(floorIndex));
    return Array.from({ length: shipData.numFloors }, (_, i) => i + 1);
}

// ========================================
// Outlines
// ========================================

/**
 * The part of a convex floor cut off by a straight line, with a given area. The
 * line is at right angles to the direction, so the piece is centered on it.
 * @param {Array<[number, number]>} inner - Usable space of the floor
 * @param {number} angle - Direction from the floor's center to the middle of the piece
 * @param {number} area - Area in m²
 * @returns {Array<[number, number]>} Convex polygon, empty if the floor has no space
 */
function arcRoomPolygon(inner, angle, area) {
    if (inner.length < 3) return [];
    if (area >= polygonArea(inner)) return inner.slice();

    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const reach = inner.map(([x, y]) => x * nx + y * ny);
    let low = Math.min(...reach);
    let high = Math.max(...reach);
    for (let i = 0; i < 50; i++) {
        const middle = (low + high) / 2;
        if (polygonArea(clipPolygonToHalfPlane(inner, nx, ny, middle)) > area) low = middle;
        else high = middle;
    }
    return clipPolygonToHalfPlane(inner, nx, ny, (low + high) / 2);
}

const roomShapeCache = new WeakMap();

/**
 * Outline and bands of a room. These are looked up constantly during a drag, so
 * they are kept until the room or the ship changes.
 * @param {object} pos - Room entry
 * @returns {{outline: Array<[number, number]>, bands: Array<object>}}
 */
function getRoomShape(pos) {
    const geometry = pos.roomShape === 'arc' ? getShipGeometry() : null;
    const cached = roomShapeCache.get(pos);
    if (cached && cached.geometry === geometry && cached.floor === pos.floor &&
        cached.x === pos.x && cached.y === pos.y && cached.length === pos.length &&
        cached.arcAngle === pos.arcAngle && cached.arcArea === pos.arcArea) {
        return cached;
    }

    const outline = pos.roomShape === 'arc'
        ? arcRoomPolygon(getFloorInnerPolygon(pos.floor), pos.arcAngle, pos.arcArea)
        : circlePolygon(pos.x + pos.length / 2, pos.y + pos.length / 2, pos.length / 2);
    const box = getPolygonBounds(outline);
    const step = box ? Math.min(HULL_BAND_STEP, box.width / 8) : HULL_BAND_STEP;
    const bands = outline.length > 0
        ? getHullBands(outline, step).map(b => ({ x: b.x0, y: b.y, length: b.x1 - b.x0, width: b.height }))
        : [];

    const shape = {
        geometry, floor: pos.floor, x: pos.x, y: pos.y, length: pos.length,
        arcAngle: pos.arcAngle, arcArea: pos.arcArea, outline, bands
    };
    roomShapeCache.set(pos, shape);
    return shape;
}

/**
 * Exact outline of a room
 * @param {object} pos - Room entry
 * @returns {Array<[number, number]>} Convex polygon
 */
function getRoomOutline(pos) {
    return getRoomShape(pos).outline;
}

/**
 * A room as rectangles, for anything that works with rectangles
 * @param {object} pos - Room entry
 * @returns {Array<{x, y, length, width}>}
 */
function getRoomRects(pos) {
    return getRoomShape(pos).bands;
}

/**
 * Floor area of a room
 * @param {object} pos - Room entry
 * @returns {number} Area in m²
 */
function getRoomArea(pos) {
    if (pos.roomShape === 'arc') return pos.arcArea;
    return Math.PI * (pos.length / 2) ** 2;
}

/**
 * The fields that make an entry a curved room
 * @param {object} room - Room entry or placement data
 * @returns {object} Fields to copy onto a placement entry
 */
function getRoomFields(room) {
    if (room.roomShape === 'arc') {
        return { roomShape: 'arc', arcAngle: room.arcAngle, arcArea: room.arcArea };
    }
    return { roomShape: room.roomShape };
}

// ========================================
// Overlap and Fit
// ========================================

const boxesOverlap = (a, b, eps) =>
    a.x + a.length > b.x + eps && b.x + b.length > a.x + eps &&
    a.y + a.width > b.y + eps && b.y + b.width > a.y + eps;

/**
 * Whether two placement entries overlap, any shape against any shape. Entries that
 * only touch don't count.
 *
 * A free region is built around a room's bands, or the room is placed against a
 * region using its true outline, so either can leave them slightly overlapping
 * without it being a real problem. They only count as overlapping when both agree.
 *
 * @param {object} a - Placement entry
 * @param {object} b - Placement entry
 * @param {object} placementB - Parent placement of b (for legacy component-level dimensions)
 * @param {number} eps - Overlap smaller than this is ignored (meters)
 * @returns {boolean}
 */
function placementsOverlap(a, b, placementB, eps = ROOM_FIT_EPS) {
    const rectsA = a.roomShape ? null : getPlacementRects(a);
    const rectsB = b.roomShape ? null : getPlacementRects(b, placementB);

    if (rectsA && rectsB) return rectsA.some(r => rectsB.some(s => boxesOverlap(r, s, eps)));
    if (!rectsA && !rectsB) {
        return boxesOverlap(a, b, eps) && doConvexPolygonsOverlap(getRoomOutline(a), getRoomOutline(b), eps);
    }

    const room = rectsA ? b : a;
    const rects = rectsA || rectsB;
    const other = rectsA ? a : b;
    const outline = getRoomOutline(room);
    const hits = rects.filter(r => boxesOverlap(room, r, eps) &&
        doConvexPolygonsOverlap(outline, rectanglePolygon(r.x, r.y, r.length, r.width), eps));
    if (!(other.rects && other.rects.length > 0)) return hits.length > 0;
    const bands = getRoomRects(room);
    return hits.some(r => bands.some(band => boxesOverlap(band, r, eps)));
}

/**
 * Whether a room is clear of everything else on the floors it spans
 * @param {object} room - Room entry
 * @param {number[]} floors - Floors it spans
 * @param {number} excludeComponentIndex - Component to ignore, or -1
 * @returns {boolean}
 */
function isRoomClear(room, floors, excludeComponentIndex = -1) {
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        if (parseInt(compIdxStr, 10) === excludeComponentIndex || !placement.floors) continue;
        for (const pos of placement.floors) {
            if (floors.includes(pos.floor) && placementsOverlap(room, pos, placement)) return false;
        }
    }
    return true;
}

/**
 * Every position of a circle's center that keeps it inside a floor
 * @param {number|number[]} floors - Floor number, or the floors it spans
 * @param {number} diameter - Diameter in meters
 * @returns {Array<[number, number]>} Convex polygon, empty if the circle can't fit
 */
function getCircleCenterRegion(floors, diameter) {
    const inner = getFloorInnerPolygon(floors);
    if (inner.length < 3) return [];
    return insetConvexPolygon(inner, diameter / 2 - CIRCLE_FIT_SLACK);
}

/**
 * Closest any wall of a floor comes to a circle's center, less the circle's radius:
 * negative when the circle pokes through a wall, and zero when it touches one
 */
function getCircleWallGap(pos, floors) {
    const inner = getFloorInnerPolygon(floors);
    if (inner.length < 3) return -Infinity;
    const r = pos.length / 2;
    const cx = pos.x + r;
    const cy = pos.y + r;
    return Math.min(...getPolygonWalls(inner).map(w => cx * w.nx + cy * w.ny - w.offset)) - r;
}

/**
 * Whether a room fits inside the floors it spans
 * @param {object} room - Room entry
 * @param {number[]} floors - Floors it spans
 * @returns {boolean}
 */
function isRoomFitting(room, floors) {
    if (room.roomShape === 'arc') {
        const radius = getArcRadius(floors[0]);
        return radius > 0 &&
            floors.every(f => Math.abs(getArcRadius(f) - radius) <= ROOM_RADIUS_EPS) &&
            room.arcArea <= getFloorGeometry(floors[0]).usableArea + ROOM_FIT_EPS;
    }
    return getCircleWallGap(room, floors) >= -ROOM_FIT_EPS;
}

/**
 * Whether a room lies against the hull of the floors it spans. The curved side of an
 * arc is the wall itself.
 * @param {object} room - Room entry
 * @param {number[]} floors - Floors it spans
 * @returns {boolean}
 */
function roomTouchesHull(room, floors) {
    if (room.roomShape === 'arc') return true;
    return getCircleWallGap(room, floors) <= ROOM_FIT_EPS;
}

// ========================================
// Positioning
// ========================================

/**
 * Arc against a floor's wall, facing a direction
 * @param {object} room - Room or placement data (arcArea)
 * @param {number[]} floors - Floors it spans, which must have the same radius
 * @param {number} angle - Direction from the floor's center to the middle of its curved side
 * @returns {object|null} Room entry, or null if there is no usable space
 */
function buildArcRoom(room, floors, angle) {
    const inner = getFloorInnerPolygon(floors[0]);
    const outline = arcRoomPolygon(inner, angle, room.arcArea);
    if (outline.length < 3) return null;
    const box = getPolygonBounds(outline);
    return {
        floor: floors[0], x: box.x, y: box.y, length: box.length, width: box.width,
        roomShape: 'arc', arcAngle: angle, arcArea: room.arcArea
    };
}

/**
 * Circle with its center at a point
 */
function buildCircleRoom(room, floors, cx, cy) {
    const r = room.length / 2;
    return { floor: floors[0], x: cx - r, y: cy - r, length: room.length, width: room.length, roomShape: 'circle' };
}

/**
 * Put a room at the spot nearest the pointer on the given floors, without looking at
 * what else is there. A circle centers on the pointer and an arc faces it.
 * @param {object} room - Room or placement data ({roomShape, length, arcArea, radius})
 * @param {number[]} floors - Floors it spans
 * @param {number} pointerX - Pointer position in meters
 * @param {number} pointerY - Pointer position in meters
 * @param {boolean} requireHull - Room must lie against the outer hull
 * @returns {object|null} Room entry, or null if it can't go on these floors
 */
function positionRoom(room, floors, pointerX, pointerY, requireHull = false) {
    if (room.roomShape === 'arc') {
        const radius = room.radius || getArcRadius(floors[0]);
        if (!floors.every(f => Math.abs(getArcRadius(f) - radius) <= ROOM_RADIUS_EPS)) return null;
        if (radius <= 0 || room.arcArea > getFloorGeometry(floors[0]).usableArea + ROOM_FIT_EPS) return null;
        const box = getPolygonBounds(getFloorInnerPolygon(floors[0]));
        const angle = Math.atan2(pointerY - (box.y + box.width / 2), pointerX - (box.x + box.length / 2));
        return buildArcRoom(room, floors, angle);
    }

    const region = getCircleCenterRegion(floors, room.length);
    const center = requireHull
        ? closestPointOnPolygonBoundary(region, pointerX, pointerY)
        : closestPointInConvexPolygon(region, pointerX, pointerY);
    return center ? buildCircleRoom(room, floors, center.x, center.y) : null;
}

/**
 * Slide an arc around the wall to the nearest free spot
 */
function findArcSpot(start, room, floors, excludeComponentIndex) {
    const isFree = angle => {
        const arc = buildArcRoom(room, floors, angle);
        return arc && isRoomClear(arc, floors, excludeComponentIndex) ? arc : null;
    };
    const steps = Math.round(Math.PI / ARC_SEARCH_STEP);
    for (let k = 1; k <= steps; k++) {
        for (const sign of [1, -1]) {
            let free = start.arcAngle + sign * k * ARC_SEARCH_STEP;
            let best = isFree(free);
            if (!best) continue;
            let blocked = free - sign * ARC_SEARCH_STEP;
            for (let i = 0; i < ROOM_SEARCH_REFINEMENTS; i++) {
                const middle = (free + blocked) / 2;
                const arc = isFree(middle);
                if (arc) {
                    free = middle;
                    best = arc;
                } else {
                    blocked = middle;
                }
            }
            return best;
        }
    }
    return null;
}

/**
 * Slide a circle along the hull to the nearest free spot
 */
function findCircleSpotOnHull(start, room, floors, excludeComponentIndex) {
    const r = room.length / 2;
    const cx = start.x + r;
    const cy = start.y + r;
    const region = getCircleCenterRegion(floors, room.length);
    const spots = [];
    region.forEach(([ax, ay], i) => {
        const [bx, by] = region[(i + 1) % region.length];
        const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / ROOM_SEARCH_STEP));
        for (let p = 0; p < parts; p++) {
            const x = ax + ((bx - ax) * p) / parts;
            const y = ay + ((by - ay) * p) / parts;
            spots.push({ x, y, distance: Math.hypot(x - cx, y - cy) });
        }
    });
    spots.sort((a, b) => a.distance - b.distance);
    for (const spot of spots) {
        const circle = buildCircleRoom(room, floors, spot.x, spot.y);
        if (isRoomClear(circle, floors, excludeComponentIndex)) return circle;
    }
    return null;
}

/**
 * Slide a circle to the nearest free spot, trying rings around where it started
 */
function findCircleSpot(start, room, floors, excludeComponentIndex) {
    const r = room.length / 2;
    const cx = start.x + r;
    const cy = start.y + r;
    const region = getCircleCenterRegion(floors, room.length);
    const box = getPolygonBounds(region);
    const reach = Math.hypot(box.length, box.width);
    const isFree = (x, y) => {
        const circle = buildCircleRoom(room, floors, x, y);
        return isRoomClear(circle, floors, excludeComponentIndex) ? circle : null;
    };

    for (let ring = ROOM_SEARCH_STEP; ring <= reach; ring += ROOM_SEARCH_STEP) {
        const count = Math.min(120, Math.max(12, Math.ceil((2 * Math.PI * ring) / (2 * ROOM_SEARCH_STEP))));
        let found = null;
        for (let i = 0; i < count && !found; i++) {
            const angle = (i * 2 * Math.PI) / count;
            const x = cx + ring * Math.cos(angle);
            const y = cy + ring * Math.sin(angle);
            if (isPointInConvexPolygon(region, x, y)) found = isFree(x, y);
        }
        if (!found) continue;

        // Move back toward the start for as long as it stays free
        let freeShare = 1;
        let blockedShare = 0;
        const fx = found.x + r - cx;
        const fy = found.y + r - cy;
        for (let i = 0; i < ROOM_SEARCH_REFINEMENTS; i++) {
            const share = (freeShare + blockedShare) / 2;
            const circle = isFree(cx + fx * share, cy + fy * share);
            if (circle) {
                freeShare = share;
                found = circle;
            } else {
                blockedShare = share;
            }
        }
        return found;
    }
    return null;
}

/**
 * Find a spot for a room near the pointer, sliding it clear of anything in the way
 * @param {object} room - Room or placement data ({roomShape, length, arcArea, radius})
 * @param {number[]} floors - Floors it spans
 * @param {number} pointerX - Pointer position in meters
 * @param {number} pointerY - Pointer position in meters
 * @param {number} excludeComponentIndex - Component to ignore, or -1
 * @param {boolean} requireHull - Room must lie against the outer hull
 * @returns {object|null} Room entry, or null if there is no room for it
 */
function findRoomSpot(room, floors, pointerX, pointerY, excludeComponentIndex = -1, requireHull = false) {
    const start = positionRoom(room, floors, pointerX, pointerY, requireHull);
    if (!start) return null;
    if (isRoomClear(start, floors, excludeComponentIndex)) return start;
    if (room.roomShape === 'arc') return findArcSpot(start, room, floors, excludeComponentIndex);
    return requireHull
        ? findCircleSpotOnHull(start, room, floors, excludeComponentIndex)
        : findCircleSpot(start, room, floors, excludeComponentIndex);
}

/**
 * Turn an arc to face a new direction, keeping its floor and size
 * @param {object} arc - Arc entry
 * @param {number} turn - Radians to add
 * @returns {object|null} Room entry
 */
function turnArcRoom(arc, turn) {
    return buildArcRoom(arc, [arc.floor], arc.arcAngle + turn);
}

// ========================================
// Size Options
// ========================================

/**
 * Arc options for the chosen floors. Several floors can only share an arc when
 * their walls have the same radius. With one floor chosen, a ship whose floors
 * differ gets one option for each radius, and choosing one moves to that floor.
 */
function getArcOptions(floors, area, perFloorText) {
    if (!isRoundHull()) return [];

    const groups = [];
    if (floors.length > 1) {
        const radius = getArcRadius(floors[0]);
        if (radius > 0 && floors.every(f => Math.abs(getArcRadius(f) - radius) <= ROOM_RADIUS_EPS)) {
            groups.push({ radius, floors });
        }
    } else {
        for (let f = 1; f <= shipData.numFloors; f++) {
            const radius = getArcRadius(f);
            if (radius <= 0) continue;
            const group = groups.find(g => Math.abs(g.radius - radius) <= ROOM_RADIUS_EPS);
            if (group) group.floors.push(f);
            else groups.push({ radius, floors: [f] });
        }
        // The floor already chosen comes first
        groups.sort((a, b) => b.floors.includes(floors[0]) - a.floors.includes(floors[0]));
    }

    const options = [];
    for (const { radius, floors: onFloors } of groups) {
        const floor = getFloorGeometry(onFloors[0]);
        if (area > floor.usableArea) continue;
        const depth = getPolygonBounds(arcRoomPolygon(floor.inner, 0, area)).length;
        const where = onFloors.length === shipData.numFloors
            ? ''
            : ` (Floor${onFloors.length > 1 ? 's' : ''} ${onFloors.join(', ')})`;
        options.push({
            roomShape: 'arc',
            value: `arc:${radius}:${area}`,
            label: `Arc, radius ${radius.toFixed(1)} m, ${depth.toFixed(1)} m deep${where}${perFloorText}`
        });
    }
    return options;
}

/**
 * Curved shapes to offer for a component, in addition to the rectangles: a circle of
 * the same area, and on round floors an arc of the floor's radius.
 * @param {object} component
 * @param {number|number[]} floors - Floor number, or the floors a component spans
 * @param {number} numFloorsSelected - Floors the component's area is shared between
 * @returns {Array<{roomShape, value, label}>} Options, each with the value for the dropdown
 */
function getRoomShapeOptions(component, floors, numFloorsSelected = null) {
    const list = [].concat(floors);
    const count = numFloorsSelected || list.length;
    const area = calculateComponentArea(component) / count;
    if (!(area > 0)) return [];

    const perFloorText = count > 1 ? ' (per floor)' : '';
    const options = [];
    const diameter = 2 * Math.sqrt(area / Math.PI);
    if (getCircleCenterRegion(list, diameter).length > 0) {
        options.push({
            roomShape: 'circle',
            value: `circle:${diameter}`,
            label: `Circle, radius ${(diameter / 2).toFixed(1)} m (${diameter.toFixed(1)} m across)${perFloorText}`
        });
    }
    return options.concat(getArcOptions(list, area, perFloorText));
}

/**
 * Read a value from the size dropdown
 * @param {string} value - Option value
 * @returns {object|null} Placement data for a curved shape, or null for a rectangle.
 *   length and width are the circle's diameter, or the wall's for an arc, whose real
 *   size depends on the way it faces.
 */
function parseRoomChoice(value) {
    const [kind, first, second] = String(value).split(':');
    if (kind === 'circle') {
        const diameter = parseFloat(first);
        return diameter > 0 ? { roomShape: 'circle', length: diameter, width: diameter } : null;
    }
    if (kind === 'arc') {
        const radius = parseFloat(first);
        const arcArea = parseFloat(second);
        return radius > 0 && arcArea > 0
            ? { roomShape: 'arc', radius, arcArea, length: 2 * radius, width: 2 * radius }
            : null;
    }
    return null;
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        getFloorInnerPolygon,
        isRoundHull,
        getArcRadius,
        getFloorsWithRadius,
        getFloorsForRoom,
        arcRoomPolygon,
        getRoomOutline,
        getRoomRects,
        getRoomArea,
        getRoomFields,
        placementsOverlap,
        isRoomClear,
        isRoomFitting,
        roomTouchesHull,
        positionRoom,
        findRoomSpot,
        turnArcRoom,
        getRoomShapeOptions,
        parseRoomChoice
    };
}
