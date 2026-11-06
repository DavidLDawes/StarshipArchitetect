/**
 * Starship Architect - Ring Rooms Module
 *
 * Rooms laid out around the center of a round floor. An entry is the usual
 * { floor, x, y, length, width }, with x/y/length/width as the bounding box, plus:
 *   { roomShape: 'ring', ringOuter, ringInner, ringAngle, ringSweep }
 *
 * ringOuter and ringInner are the radii of its curved walls, ringAngle is the
 * direction (radians) from the floor's center to the middle of the room, and ringSweep
 * is how far around it goes. Its two other walls point at the center.
 *
 *   ringInner > 0                  a section of a ring
 *   ringInner > 0, full sweep      a whole ring, with a hole in it
 *   ringInner = 0                  a slice of pie, with an arc and two straight sides
 *   ringInner = 0, full sweep      a circle in the middle of the floor
 *
 * Floors fill from the outside in: a ring, then the next ring inside it, until what
 * is left is close enough to the center to be cut into slices.
 *
 * Ring sections aren't convex, so unlike circles and arcs they can't be compared as
 * one convex outline. Rooms on the same ring are compared exactly in angles, and
 * anything else is compared against the room cut into small convex pieces.
 *
 * Dependencies (globals in the browser, required in Jest via jest-setup):
 * - curved-rooms.js (isRoundHull, isRoomClear)
 * - hull-shapes.js (polygons, HULL_BAND_STEP)
 * - hull-access.js (requiresHullAccess)
 * - floor-utils.js (getFloorGeometry)
 */

const FULL_TURN = 2 * Math.PI;

/** Largest angle (radians) drawn or checked as one straight piece: 96 to a circle */
const RING_PIECE_ANGLE = Math.PI / 48;

/** Radii closer than this (meters) count as the same */
const RING_RADIUS_EPS = 1e-6;

/** Angles closer than this (radians) count as the same */
const RING_ANGLE_EPS = 1e-6;

/** Angle between the spots checked for anything that isn't on a ring: 2 degrees */
const RING_SCAN_ANGLE = Math.PI / 90;

/** A room this close (radians) to the end of a free stretch goes against it: 5 degrees */
const RING_SNAP_ANGLE = Math.PI / 36;

/** Smallest depth or width (meters) worth offering */
const RING_MIN_SIZE = 1;

/** A ring whose inner wall would be closer to the center than this share of its depth becomes slices */
const RING_CENTER_SHARE = 0.5;

/** Depth of ring offered, against the side of a square room of the same area */
const RING_DEPTH_SHARES = [0.7, 1, 1.4];

/** How far a ring may be made deeper or shallower so its rooms fill it exactly */
const RING_FIT_SLACK = 0.35;

/** Free stretches holding less than this (m²) aren't worth filling by tonnage */
const RING_MIN_FILL_AREA = 0.05;

/** Rings tried before giving up, far more than a floor can hold */
const RING_MAX_STEPS = 64;

// ========================================
// Floors
// ========================================

/**
 * Radius of the circle with a round floor's usable area. It is a hair inside the
 * corners of the floor's polygon and outside its sides, by about 0.02%, so rings that
 * fill a floor add up to exactly its usable area.
 * @param {number} floorIndex - Floor number
 * @returns {number} Radius in meters, 0 if the floor isn't round or has no usable space
 */
function getRingWallRadius(floorIndex) {
    if (!isRoundHull()) return 0;
    const floor = getFloorGeometry(floorIndex);
    return floor && floor.usableArea > 0 ? Math.sqrt(floor.usableArea / Math.PI) : 0;
}

/**
 * Radius shared by a set of floors
 * @param {number[]} floors - Floor numbers
 * @returns {number} Radius in meters, 0 if they aren't all round and the same size
 */
function getSharedRingWall(floors) {
    const wall = getRingWallRadius(floors[0]);
    return floors.every(f => Math.abs(getRingWallRadius(f) - wall) <= RING_RADIUS_EPS) ? wall : 0;
}

/**
 * Center of a floor
 * @param {number} floorIndex - Floor number
 * @returns {{x, y}|null} Null if the floor has no usable space
 */
function getRingCenter(floorIndex) {
    const floor = getFloorGeometry(floorIndex);
    if (!floor || floor.inner.length === 0) return null;
    const box = getPolygonBounds(floor.inner);
    return { x: box.x + box.length / 2, y: box.y + box.width / 2 };
}

// ========================================
// Sizes
// ========================================

/**
 * How far around a ring a room of some area goes
 * @param {number} area - Area in m²
 * @param {number} outer - Outer radius
 * @param {number} inner - Inner radius
 * @returns {number} Radians, exactly a full turn when it takes the whole ring, 0 if it can't fit
 */
function getRingSweep(area, outer, inner) {
    const band = outer * outer - inner * inner;
    if (!(band > 0) || !(area > 0)) return 0;
    const sweep = (2 * area) / band;
    if (sweep >= FULL_TURN * (1 - RING_ANGLE_EPS)) return sweep <= FULL_TURN * (1 + RING_ANGLE_EPS) ? FULL_TURN : 0;
    return sweep;
}

/**
 * Floor area of a ring room
 * @param {object} room - Ring room
 * @returns {number} Area in m²
 */
function getRingRoomArea(room) {
    return (room.ringSweep / 2) * (room.ringOuter ** 2 - room.ringInner ** 2);
}

/**
 * Inner radius of a ring holding a given area all the way around
 * @returns {number|null} Radius, 0 for the whole disc, null if the area is too big
 */
function getRingInnerForArea(outer, area) {
    const left = outer * outer - area / Math.PI;
    if (left < -RING_RADIUS_EPS) return null;
    return left <= RING_RADIUS_EPS ? 0 : Math.sqrt(left);
}

const isFullTurn = sweep => sweep >= FULL_TURN - RING_ANGLE_EPS;

/**
 * Whether a ring's inner wall is too close to the center to be worth having: the
 * hole would be small next to the ring, or too small to hold a room like these. What
 * is left should be cut into slices instead.
 * @param {number} inner - Inner radius
 * @param {number} depth - Depth of the ring
 * @param {number} area - Area of a room, or 0 when placed by tonnage
 * @returns {boolean}
 */
function isTooCloseToCenter(inner, depth, area = 0) {
    return inner < depth * RING_CENTER_SHARE || Math.PI * inner * inner < area;
}

/**
 * Smallest difference between two angles
 * @returns {number} Radians between -PI and PI
 */
function wrapAngle(angle) {
    const wrapped = angle % FULL_TURN;
    if (wrapped > Math.PI) return wrapped - FULL_TURN;
    if (wrapped < -Math.PI) return wrapped + FULL_TURN;
    return wrapped;
}

// ========================================
// Outlines
// ========================================

const ringPoint = (center, radius, angle) =>
    [center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle)];

/**
 * Points along a curved wall, evenly spaced
 */
function ringWallPoints(center, radius, start, sweep) {
    const parts = Math.max(1, Math.ceil(sweep / RING_PIECE_ANGLE));
    const points = [];
    for (let i = 0; i <= parts; i++) points.push(ringPoint(center, radius, start + (sweep * i) / parts));
    return points;
}

/**
 * Outlines of a ring room: one, or two for a whole ring, whose second is its hole
 * @param {object} room - Ring room
 * @returns {Array<Array<[number, number]>>} Polygons, none if the floor has no usable space
 */
function getRingContours(room) {
    const center = getRingCenter(room.floor);
    if (!center) return [];
    const { ringOuter: outer, ringInner: inner, ringAngle: angle, ringSweep: sweep } = room;

    if (isFullTurn(sweep)) {
        const circle = radius => ringWallPoints(center, radius, 0, FULL_TURN).slice(0, -1);
        return inner > 0 ? [circle(outer), circle(inner)] : [circle(outer)];
    }

    const start = angle - sweep / 2;
    const near = inner > 0 ? ringWallPoints(center, inner, start, sweep).reverse() : [[center.x, center.y]];
    return [ringWallPoints(center, outer, start, sweep).concat(near)];
}

/**
 * A ring room cut into convex pieces, for comparing against other shapes
 * @param {object} room - Ring room
 * @returns {Array<Array<[number, number]>>} Convex polygons in standard direction
 */
function getRingPieces(room) {
    const center = getRingCenter(room.floor);
    if (!center) return [];
    const { ringOuter: outer, ringInner: inner, ringSweep: sweep } = room;
    const start = room.ringAngle - sweep / 2;
    const parts = Math.max(1, Math.ceil(sweep / RING_PIECE_ANGLE));
    const pieces = [];
    for (let i = 0; i < parts; i++) {
        const a = start + (sweep * i) / parts;
        const b = start + (sweep * (i + 1)) / parts;
        const near = inner > 0 ? [ringPoint(center, inner, b), ringPoint(center, inner, a)] : [[center.x, center.y]];
        pieces.push(orientPolygon([ringPoint(center, outer, a), ringPoint(center, outer, b), ...near]));
    }
    return pieces;
}

/**
 * Where a level line crosses a ring room. It can cross twice, either side of the hole
 * in the middle of a ring.
 * @param {Array<Array<[number, number]>>} pieces - From getRingPieces
 * @param {number} y - Height of the line in meters
 * @returns {Array<[number, number]>} Spans from left to right
 */
function getRingRoomSpans(pieces, y) {
    const spans = pieces.map(piece => getPolygonSpan(piece, y)).filter(Boolean).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [from, to] of spans) {
        const last = merged[merged.length - 1];
        if (last && from <= last[1] + RING_RADIUS_EPS) last[1] = Math.max(last[1], to);
        else merged.push([from, to]);
    }
    return merged;
}

/**
 * A ring room as thin rectangles, for anything that works with rectangles. Each row
 * can have a gap in it, where it crosses the hole in the middle of a ring.
 * @param {Array<Array<[number, number]>>} pieces - From getRingPieces
 * @returns {Array<{x, y, length, width}>}
 */
function getRingRoomRects(pieces) {
    if (pieces.length === 0) return [];
    const box = getPolygonBounds(pieces.flat());
    const rows = Math.max(1, Math.ceil(box.width / Math.min(HULL_BAND_STEP, box.width / 8)));
    const height = box.width / rows;
    const rects = [];
    for (let row = 0; row < rows; row++) {
        const y = box.y + row * height;
        for (const [from, to] of getRingRoomSpans(pieces, y + height / 2)) {
            rects.push({ x: from, y, length: to - from, width: height });
        }
    }
    return rects.filter(r => r.length > 0);
}

/**
 * Whether a point is inside a ring room
 * @param {object} room - Ring room
 * @returns {boolean}
 */
function isPointInRingRoom(room, x, y) {
    const center = getRingCenter(room.floor);
    if (!center) return false;
    const radius = Math.hypot(x - center.x, y - center.y);
    if (radius > room.ringOuter || radius < room.ringInner) return false;
    if (isFullTurn(room.ringSweep)) return true;
    return Math.abs(wrapAngle(Math.atan2(y - center.y, x - center.x) - room.ringAngle)) <= room.ringSweep / 2;
}

/**
 * Whether two ring rooms on the same floor overlap. Rooms that only touch don't count.
 * @param {object} a - Ring room
 * @param {object} b - Ring room
 * @param {number} eps - Overlap smaller than this is ignored (meters)
 * @returns {boolean}
 */
function ringRoomsOverlap(a, b, eps = RING_RADIUS_EPS) {
    if (a.ringOuter <= b.ringInner + eps || b.ringOuter <= a.ringInner + eps) return false;
    if (isFullTurn(a.ringSweep) || isFullTurn(b.ringSweep)) return true;
    return Math.abs(wrapAngle(a.ringAngle - b.ringAngle)) < (a.ringSweep + b.ringSweep) / 2 - RING_ANGLE_EPS;
}

/**
 * Where a ring room's label goes: on the level line through the middle of the room,
 * or at the bottom of a whole ring, where there's the most room for it
 * @param {object} room - Ring room
 * @param {Array<Array<[number, number]>>} pieces - From getRingPieces
 * @returns {{x, y, width}|null} Position, and how much width the line has there (meters)
 */
function getRingLabelSpot(room, pieces) {
    const center = getRingCenter(room.floor);
    if (!center) return null;
    const { ringOuter: outer, ringInner: inner, ringSweep: sweep } = room;
    if (inner === 0 && isFullTurn(sweep)) return { x: center.x, y: center.y, width: 2 * outer };

    const radius = inner > 0 ? (outer + inner) / 2 : outer * 0.65;
    const [x, y] = ringPoint(center, radius, isFullTurn(sweep) ? Math.PI / 2 : room.ringAngle);
    const span = getRingRoomSpans(pieces, y).find(([from, to]) => from <= x && x <= to);
    return span ? { x: (span[0] + span[1]) / 2, y, width: span[1] - span[0] } : { x, y, width: outer - inner };
}

// ========================================
// Fit and Position
// ========================================

/**
 * Whether a ring room fits the floors it spans
 * @param {object} room - Ring room
 * @param {number[]} floors - Floors it spans
 * @returns {boolean}
 */
function isRingRoomFitting(room, floors) {
    const wall = getSharedRingWall(floors);
    return wall > 0 && room.ringOuter <= wall + RING_RADIUS_EPS;
}

/**
 * Whether a ring room lies against the hull of the floors it spans
 * @param {object} room - Ring room
 * @param {number[]} floors - Floors it spans
 * @returns {boolean}
 */
function ringRoomTouchesHull(room, floors) {
    return room.ringOuter >= getSharedRingWall(floors) - RING_RADIUS_EPS;
}

/**
 * A ring room facing a direction, with its bounding box
 * @param {object} ring - Radii and sweep ({ringOuter, ringInner, ringSweep})
 * @param {number[]} floors - Floors it spans
 * @param {number} angle - Direction from the floor's center to its middle
 * @returns {object|null} Room entry, or null if the floor has no usable space
 */
function buildRingRoom(ring, floors, angle) {
    const room = {
        floor: floors[0],
        roomShape: 'ring',
        ringOuter: ring.ringOuter,
        ringInner: ring.ringInner,
        ringAngle: wrapAngle(angle),
        ringSweep: ring.ringSweep
    };
    const [outline] = getRingContours(room);
    if (!outline) return null;
    const box = getPolygonBounds(outline);
    return { ...room, x: box.x, y: box.y, length: box.length, width: box.width };
}

/**
 * Put a ring room facing the pointer, without looking at what else is there
 * @param {object} ring - Radii and sweep
 * @param {number[]} floors - Floors it spans
 * @param {number} pointerX - Pointer position in meters
 * @param {number} pointerY - Pointer position in meters
 * @param {boolean} requireHull - Room must lie against the outer hull
 * @returns {object|null} Room entry, or null if it can't go on these floors
 */
function positionRingRoom(ring, floors, pointerX, pointerY, requireHull = false) {
    if (!isRingRoomFitting(ring, floors)) return null;
    if (requireHull && !ringRoomTouchesHull(ring, floors)) return null;
    const center = getRingCenter(floors[0]);
    return buildRingRoom(ring, floors, Math.atan2(pointerY - center.y, pointerX - center.x));
}

/**
 * Turn a ring room around its ring, keeping its floor and size
 * @param {object} room - Ring room
 * @param {number} turn - Radians to add
 * @returns {object|null} Room entry
 */
function turnRingRoom(room, turn) {
    return buildRingRoom(room, [room.floor], room.ringAngle + turn);
}

// ========================================
// Free Space
// ========================================

/**
 * Ring rooms on some floors
 * @param {number[]} floors - Floor numbers
 * @param {number} excludeComponentIndex - Component to ignore, or -1
 * @returns {Array<object>} Ring entries
 */
function getRingRoomsOn(floors, excludeComponentIndex = -1) {
    const rooms = [];
    for (const [compIdxStr, placement] of Object.entries(shipData.componentPlacements)) {
        if (parseInt(compIdxStr, 10) === excludeComponentIndex || !placement.floors) continue;
        for (const pos of placement.floors) {
            if (pos.roomShape === 'ring' && floors.includes(pos.floor)) rooms.push(pos);
        }
    }
    return rooms;
}

/**
 * Whether anything other than ring rooms is on some floors
 */
function hasOtherRooms(floors, excludeComponentIndex) {
    return Object.entries(shipData.componentPlacements).some(([compIdxStr, placement]) =>
        parseInt(compIdxStr, 10) !== excludeComponentIndex && placement.floors &&
        placement.floors.some(pos => floors.includes(pos.floor) && pos.roomShape !== 'ring'));
}

/**
 * Rings already started on some floors, outermost first
 * @param {number[]} floors - Floor numbers
 * @returns {Array<{ringOuter, ringInner}>}
 */
function getRingsInUse(floors) {
    const rings = [];
    for (const { ringOuter, ringInner } of getRingRoomsOn(floors)) {
        if (!rings.some(r => Math.abs(r.ringOuter - ringOuter) <= RING_RADIUS_EPS &&
            Math.abs(r.ringInner - ringInner) <= RING_RADIUS_EPS)) {
            rings.push({ ringOuter, ringInner });
        }
    }
    return rings.sort((a, b) => b.ringOuter - a.ringOuter);
}

/**
 * Outer radius of the next ring to start: inside everything already on a ring
 * @param {number[]} floors - Floor numbers
 * @returns {number} Radius in meters, 0 if the center is taken or the floors don't share a radius
 */
function getNextRingOuter(floors) {
    return getRingRoomsOn(floors).reduce((outer, room) => Math.min(outer, room.ringInner), getSharedRingWall(floors));
}

/**
 * Stretches of a ring not taken by other ring rooms
 */
function getArcsBetweenRingRooms(ring, floors, excludeComponentIndex) {
    const taken = getRingRoomsOn(floors, excludeComponentIndex)
        .filter(room => room.ringOuter > ring.ringInner + RING_RADIUS_EPS && ring.ringOuter > room.ringInner + RING_RADIUS_EPS);
    if (taken.length === 0) return [{ start: -Math.PI / 2, sweep: FULL_TURN }];
    if (taken.some(room => isFullTurn(room.ringSweep))) return [];

    const stretches = taken
        .map(room => ({
            start: (((room.ringAngle - room.ringSweep / 2) % FULL_TURN) + FULL_TURN) % FULL_TURN,
            sweep: room.ringSweep
        }))
        .sort((a, b) => a.start - b.start);

    const arcs = [];
    let end = stretches[0].start + stretches[0].sweep;
    for (const { start, sweep } of stretches.slice(1)) {
        if (start > end + RING_ANGLE_EPS) arcs.push({ start: end, sweep: start - end });
        end = Math.max(end, start + sweep);
    }
    const last = stretches[0].start + FULL_TURN - end;
    if (last > RING_ANGLE_EPS) arcs.push({ start: end, sweep: last });
    return arcs;
}

/**
 * Stretches of a ring that nothing is in the way of. Other ring rooms give exact ends.
 * Anything else is found by checking spots around the ring.
 * @param {object} ring - Radii ({ringOuter, ringInner})
 * @param {number[]} floors - Floors it spans
 * @param {number} excludeComponentIndex - Component to ignore, or -1
 * @returns {Array<{start, sweep}>} Radians
 */
function getFreeRingArcs(ring, floors, excludeComponentIndex = -1) {
    const arcs = getArcsBetweenRingRooms(ring, floors, excludeComponentIndex);
    if (!hasOtherRooms(floors, excludeComponentIndex)) return arcs;

    const free = [];
    for (const arc of arcs) {
        const parts = Math.max(1, Math.ceil(arc.sweep / RING_SCAN_ANGLE));
        const part = arc.sweep / parts;
        const pieces = [];
        for (let i = 0; i < parts; i++) {
            const start = arc.start + i * part;
            const piece = buildRingRoom({ ...ring, ringSweep: part }, floors, start + part / 2);
            if (!piece || !isRoomClear(piece, floors, excludeComponentIndex)) continue;
            const previous = pieces[pieces.length - 1];
            if (previous && Math.abs(previous.start + previous.sweep - start) <= RING_ANGLE_EPS) previous.sweep += part;
            else pieces.push({ start, sweep: part });
        }
        // Around a whole ring, the last stretch and the first are one
        if (isFullTurn(arc.sweep) && pieces.length > 1 &&
            Math.abs(pieces[pieces.length - 1].start + pieces[pieces.length - 1].sweep - (pieces[0].start + FULL_TURN)) <= RING_ANGLE_EPS) {
            const last = pieces.pop();
            pieces[0] = { start: last.start, sweep: last.sweep + pieces[0].sweep };
        }
        free.push(...pieces);
    }
    return free;
}

// ========================================
// Finding a Spot
// ========================================

/**
 * The ring after this one, going in, for a room of the same area. A ring already
 * started there keeps its radii, and a room too big to fit around makes the ring deeper.
 * @param {object} ring - Radii and sweep
 * @param {number[]} floors - Floors it spans
 * @returns {object|null} Radii and sweep, null if nothing is left inside it
 */
function getNextRing(ring, floors) {
    const outer = ring.ringInner;
    if (outer <= RING_RADIUS_EPS) return null;

    const depth = ring.ringOuter - ring.ringInner;
    const area = getRingRoomArea(ring);
    const started = getRingsInUse(floors).find(r => Math.abs(r.ringOuter - outer) <= RING_RADIUS_EPS);
    let inner = started ? started.ringInner : outer - depth;
    if (!started && isTooCloseToCenter(inner, depth, area)) inner = 0;

    let sweep = getRingSweep(area, outer, inner);
    if (sweep === 0) {
        inner = getRingInnerForArea(outer, area);
        if (inner === null) return null;
        sweep = getRingSweep(area, outer, inner);
    }
    return { ringOuter: outer, ringInner: inner, ringSweep: sweep };
}

/**
 * Spot on one ring closest to the pointer. A room that ends up close to the end of a
 * free stretch goes against it, so going around a ring by hand doesn't leave slivers.
 */
function findSpotOnRing(ring, floors, angle, excludeComponentIndex) {
    const sweep = ring.ringSweep;
    let best = null;
    for (const arc of getFreeRingArcs(ring, floors, excludeComponentIndex)) {
        if (arc.sweep < sweep - RING_ANGLE_EPS) continue;

        let spot = angle;
        if (!isFullTurn(arc.sweep)) {
            const middle = arc.start + arc.sweep / 2;
            const reach = Math.max(0, (arc.sweep - sweep) / 2);
            const offset = Math.max(-reach, Math.min(reach, wrapAngle(angle - middle)));
            spot = middle + offset;
            if (reach - Math.abs(offset) <= RING_SNAP_ANGLE) spot = middle + (offset < 0 ? -reach : reach);
        }

        const distance = Math.abs(wrapAngle(spot - angle));
        if (!best || distance < best.distance) best = { spot, distance };
    }
    if (!best) return null;

    const room = buildRingRoom(ring, floors, best.spot);
    return room && isRoomClear(room, floors, excludeComponentIndex) ? room : null;
}

/**
 * Find a spot for a ring room near the pointer. When its ring is full it can go on
 * to the next one in, so a floor fills from the outside in.
 * @param {object} ring - Radii and sweep
 * @param {number[]} floors - Floors it spans
 * @param {number} pointerX - Pointer position in meters
 * @param {number} pointerY - Pointer position in meters
 * @param {number} excludeComponentIndex - Component to ignore, or -1
 * @param {boolean} requireHull - Room must lie against the outer hull
 * @param {boolean} canChangeRing - Whether it can go on to the next ring in
 * @returns {object|null} Room entry, or null if there is no room for it
 */
function findRingSpot(ring, floors, pointerX, pointerY, excludeComponentIndex = -1, requireHull = false, canChangeRing = true) {
    const start = positionRingRoom(ring, floors, pointerX, pointerY, requireHull);
    if (!start) return null;

    let current = ring;
    for (let step = 0; current && step < RING_MAX_STEPS; step++) {
        const spot = findSpotOnRing(current, floors, start.ringAngle, excludeComponentIndex);
        if (spot) return spot;
        current = canChangeRing && !requireHull ? getNextRing(current, floors) : null;
    }
    return null;
}

// ========================================
// Size Options
// ========================================

/**
 * Inner radius and sweep of a new ring, sized so its rooms fill it exactly if they
 * can do that without changing its depth too much
 * @param {number} outer - Outer radius
 * @param {number} depth - Depth wanted
 * @param {number} area - Area of a room
 * @param {number} rooms - Rooms there are to go in it
 * @returns {{inner, sweep, perRing}|null} Null if it needs no ring: what's left should be slices
 */
function fitRing(outer, depth, area, rooms = Infinity) {
    const nominal = outer - depth;
    // With no more rooms to come, a small hole doesn't strand anything
    if (isTooCloseToCenter(nominal, depth, rooms > 1 ? area : 0)) return null;

    const sweep = getRingSweep(area, outer, nominal);
    if (sweep === 0) return null;
    const perRing = Math.max(1, Math.round(FULL_TURN / sweep));
    if (rooms >= perRing) {
        const inner = getRingInnerForArea(outer, perRing * area);
        if (inner !== null && Math.abs(outer - inner - depth) <= depth * RING_FIT_SLACK &&
            !isTooCloseToCenter(inner, outer - inner, area)) {
            return { inner, sweep: getRingSweep(area, outer, inner), perRing };
        }
    }
    return { inner: nominal, sweep, perRing: Math.floor((FULL_TURN + RING_ANGLE_EPS) / sweep) };
}

const toDegrees = radians => `${Math.round((radians * 180) / Math.PI)}°`;

/**
 * Ring room options for the chosen floors: more of a ring already started, a new
 * ring inside those, and slices of what's left in the middle. All the chosen floors
 * have to be round and the same size.
 * @param {object} component - Component, to tell if it has to touch the hull or comes in quantity
 * @param {number[]} floors - Floors chosen
 * @param {number} area - Area of a room on each floor
 * @param {string} perFloorText - Added to the label when it spans floors
 * @returns {Array<{roomShape, value, label}>}
 */
function getRingOptions(component, floors, area, perFloorText = '') {
    const wall = getSharedRingWall(floors);
    if (!(wall > 0) || !(area > 0)) return [];

    const requireHull = requiresHullAccess(component);
    const options = [];
    const add = (outer, inner, label) => options.push({
        roomShape: 'ring',
        value: `ring:${outer}:${inner}:${area}`,
        label: `${label}${perFloorText}`
    });

    for (const { ringOuter, ringInner } of getRingsInUse(floors)) {
        if (requireHull && ringOuter < wall - RING_RADIUS_EPS) continue;
        const sweep = getRingSweep(area, ringOuter, ringInner);
        if (sweep === 0) continue;
        const ring = { ringOuter, ringInner };
        if (!getFreeRingArcs(ring, floors).some(arc => arc.sweep >= sweep - RING_ANGLE_EPS)) continue;
        add(ringOuter, ringInner, ringInner > 0
            ? `More of the ring ${ringInner.toFixed(1)} to ${ringOuter.toFixed(1)} m out, ${toDegrees(sweep)} around`
            : `Another slice, radius ${ringOuter.toFixed(1)} m, ${toDegrees(sweep)} of the pie`);
    }

    const outer = getNextRingOuter(floors);
    if (outer <= RING_RADIUS_EPS || (requireHull && outer < wall - RING_RADIUS_EPS)) return options;
    const where = outer >= wall - RING_RADIUS_EPS ? 'at the wall' : `inside ${outer.toFixed(1)} m`;

    const rooms = (component.quantity || 1) > 1 && !canTakeIrregularSpace(component) ? Infinity : 1;
    const inners = [];
    for (const share of RING_DEPTH_SHARES) {
        const depth = Math.max(RING_MIN_SIZE, Math.round(Math.sqrt(area) * share * 10) / 10);
        const fit = fitRing(outer, depth, area, rooms);
        if (!fit || isFullTurn(fit.sweep) || (fit.sweep * (outer + fit.inner)) / 2 < RING_MIN_SIZE) continue;
        if (inners.some(inner => Math.abs(inner - fit.inner) < 0.05)) continue;
        inners.push(fit.inner);
        const count = rooms > 1 && fit.perRing > 1 ? ` (${fit.perRing} to a ring)` : '';
        add(outer, fit.inner, `Ring room ${where}, ${(outer - fit.inner).toFixed(1)} m deep, ${toDegrees(fit.sweep)} around${count}`);
    }

    const whole = getRingInnerForArea(outer, area);
    if (whole !== null && whole > 0 && outer - whole >= RING_MIN_SIZE) {
        add(outer, whole, `Whole ring ${where}, ${(outer - whole).toFixed(1)} m deep`);
    }

    const slice = getRingSweep(area, outer, 0);
    if (slice > 0 && isFullTurn(slice)) {
        add(outer, 0, `Circle filling the center, radius ${outer.toFixed(1)} m`);
    } else if (slice > 0 && slice * outer >= RING_MIN_SIZE) {
        add(outer, 0, `Slice of pie, radius ${outer.toFixed(1)} m, ${toDegrees(slice)} around`);
    }
    return options;
}

/**
 * Read a ring room from the size dropdown
 * @param {string} first - Outer radius
 * @param {string} second - Inner radius
 * @param {string} third - Area
 * @returns {object|null} Placement data. length and width are the outer wall's
 *   diameter, as its real size depends on the way it faces.
 */
function parseRingChoice(first, second, third) {
    const ringOuter = parseFloat(first);
    const ringInner = parseFloat(second);
    const ringSweep = getRingSweep(parseFloat(third), ringOuter, ringInner);
    return ringOuter > 0 && ringInner >= 0 && ringSweep > 0
        ? { roomShape: 'ring', ringOuter, ringInner, ringSweep, length: 2 * ringOuter, width: 2 * ringOuter }
        : null;
}

// ========================================
// Filling a Floor
// ========================================

/**
 * Ring depths to offer for filling a floor
 * @param {number[]} floors - Floors to fill
 * @param {number} itemArea - Area of one item, or 0 when placed by tonnage
 * @returns {number[]} Depths in meters
 */
function getRingFillDepths(floors, itemArea) {
    const outer = getNextRingOuter(floors);
    if (outer <= RING_RADIUS_EPS) return [];
    const wanted = itemArea > 0
        ? RING_DEPTH_SHARES.map(share => Math.sqrt(itemArea) * share)
        : [outer / 4, outer / 3, outer / 2];
    const depths = [];
    for (const depth of wanted) {
        const rounded = Math.max(RING_MIN_SIZE, Math.round(depth * 10) / 10);
        if (rounded <= outer && !depths.includes(rounded)) depths.push(rounded);
    }
    return depths.length > 0 ? depths : [outer];
}

/**
 * Plan filling a floor from the outside in: what's left of the rings already started,
 * then new rings, then slices of the center. A floor with something else on it gets
 * rooms in the stretches around that.
 * @param {number[]} floors - Floors to fill, usually one
 * @param {number} depth - Depth of each new ring in meters
 * @param {object} what - { itemArea, count } for items, or { totalArea } when placed by tonnage
 * @param {boolean} requireHull - Stop at the rooms that touch the outer hull
 * @returns {Array<object>} Room entries, in filling order
 */
function planRingFill(floors, depth, { itemArea = 0, count = 0, totalArea = 0 }, requireHull = false) {
    const wall = getSharedRingWall(floors);
    const rooms = [];
    if (!(wall > 0) || !(depth > 0)) return rooms;

    let areaLeft = totalArea;
    let itemsLeft = count;
    const isDone = () => (totalArea > 0 ? areaLeft < RING_MIN_FILL_AREA : itemsLeft <= 0);

    const fillArc = (outer, inner, arc) => {
        const place = (sweep, angle) => {
            const room = buildRingRoom({ ringOuter: outer, ringInner: inner, ringSweep: sweep }, floors, angle);
            if (room) rooms.push(room);
        };
        const band = outer * outer - inner * inner;

        if (totalArea > 0) {
            const area = Math.min(areaLeft, (arc.sweep / 2) * band);
            if (area < RING_MIN_FILL_AREA) return;
            const sweep = isFullTurn(arc.sweep) && area >= (FULL_TURN / 2) * band * (1 - RING_ANGLE_EPS)
                ? FULL_TURN
                : (2 * area) / band;
            place(sweep, arc.start + sweep / 2);
            areaLeft -= area;
            return;
        }

        const sweep = getRingSweep(itemArea, outer, inner);
        if (sweep === 0) return;
        const fits = Math.floor((arc.sweep + RING_ANGLE_EPS) / sweep);
        for (let i = 0; i < fits && itemsLeft > 0; i++, itemsLeft--) {
            place(sweep, arc.start + (i + 0.5) * sweep);
        }
    };

    const fillRing = (outer, inner) => {
        for (const arc of getFreeRingArcs({ ringOuter: outer, ringInner: inner }, floors)) {
            if (isDone()) return;
            fillArc(outer, inner, arc);
        }
    };

    for (const { ringOuter, ringInner } of getRingsInUse(floors)) {
        if (isDone()) break;
        if (!requireHull || ringOuter >= wall - RING_RADIUS_EPS) fillRing(ringOuter, ringInner);
    }

    let outer = getNextRingOuter(floors);
    for (let step = 0; step < RING_MAX_STEPS && outer > RING_RADIUS_EPS && !isDone(); step++) {
        if (requireHull && outer < wall - RING_RADIUS_EPS) break;

        let inner = isTooCloseToCenter(outer - depth, depth) ? 0 : outer - depth;
        if (totalArea === 0) {
            const fit = fitRing(outer, depth, itemArea, itemsLeft);
            inner = fit ? fit.inner : 0;
            if (getRingSweep(itemArea, outer, inner) === 0) {
                inner = getRingInnerForArea(outer, itemArea);
                if (inner === null) break;
            }
        }
        fillRing(outer, inner);
        outer = inner;
    }
    return rooms;
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = {
        FULL_TURN,
        getRingWallRadius,
        getSharedRingWall,
        getRingCenter,
        getRingSweep,
        getRingRoomArea,
        getRingContours,
        getRingPieces,
        getRingRoomRects,
        isPointInRingRoom,
        ringRoomsOverlap,
        getRingLabelSpot,
        isRingRoomFitting,
        ringRoomTouchesHull,
        buildRingRoom,
        positionRingRoom,
        turnRingRoom,
        getRingsInUse,
        getNextRingOuter,
        getFreeRingArcs,
        getNextRing,
        findRingSpot,
        getRingOptions,
        parseRingChoice,
        getRingFillDepths,
        planRingFill
    };
}
