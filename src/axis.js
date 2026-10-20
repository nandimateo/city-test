// A Haussmann-style axis: a straight boulevard between two buildings, and the
// buildings in its way pushed aside.
// Local metres, x to the east, y to the north, as in reach.js. Buildings only
// ever move by an offset (dx, dy); they never rotate. Collisions use their
// axis-aligned bounding boxes [minX, minY, maxX, maxY].

export const AXIS_WIDTH_M = 32 // the boulevard, kerb to kerb
export const CORRIDOR_MARGIN_M = 6 // kept clear on each side of the boulevard
export const PLACE_RADIUS_M = 40 // the round place around the triumphal arch, in the middle of the axis
export const MIN_SPACING_M = 2 // smallest gap between two buildings that have met anew
export const MAX_ITERATIONS = 400 // rounds of pushing before giving up
export const ANIMATION_S = 0.8 // how long the buildings take to slide

const HALF = AXIS_WIDTH_M / 2 + CORRIDOR_MARGIN_M
const PLACE_CLEAR = PLACE_RADIUS_M + CORRIDOR_MARGIN_M
const EPS = 0.01
const GRID_M = 40

// --- the axis and its corridor -----------------------------------------

export function makeAxis(a, b, anchors) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
  const n = [-u[1], u[0]]
  const corners = [a, b].flatMap((p) => [-1, 1].map((s) => [p[0] + n[0] * HALF * s, p[1] + n[1] * HALF * s]))
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return { a, b, mid, length, u, n, anchors, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
}

// A box's extent along the axis and across it.
function project(axis, box) {
  let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity
  for (const x of [box[0], box[2]]) {
    for (const y of [box[1], box[3]]) {
      const dx = x - axis.a[0]
      const dy = y - axis.a[1]
      const along = dx * axis.u[0] + dy * axis.u[1]
      const across = dx * axis.n[0] + dy * axis.n[1]
      a0 = Math.min(a0, along); a1 = Math.max(a1, along)
      c0 = Math.min(c0, across); c1 = Math.max(c1, across)
    }
  }
  return [a0, a1, c0, c1]
}

// Does the box reach into the corridor: the boulevard, or the round place in
// its middle, plus the margin?
export function inCorridor(axis, box) {
  return inStrip(axis, box) || inPlace(axis, box)
}

// The boulevard and the box are both rectangles, so they overlap unless one of
// the four directions (along, across, x, y) separates them.
function inStrip(axis, box) {
  const [a0, a1, c0, c1] = project(axis, box)
  if (a1 <= 0 || a0 >= axis.length || c1 <= -HALF || c0 >= HALF) return false
  const [x0, y0, x1, y1] = axis.bbox
  return !(box[2] <= x0 || box[0] >= x1 || box[3] <= y0 || box[1] >= y1)
}

// The place is a circle: the box reaches into it when its nearest point does.
function inPlace(axis, box) {
  const [mx, my] = axis.mid
  const dx = Math.max(box[0] - mx, 0, mx - box[2])
  const dy = Math.max(box[1] - my, 0, my - box[3])
  return Math.hypot(dx, dy) < PLACE_CLEAR
}

// --- boxes ---------------------------------------------------------------

// Gap between two boxes in x and in y: positive when apart, negative when they overlap.
function gaps(p, q) {
  return [Math.max(q[0] - p[2], p[0] - q[2]), Math.max(q[1] - p[3], p[1] - q[3])]
}
function gapOf(p, q) {
  return Math.max(...gaps(p, q))
}

function cellsOf(b, visit) {
  for (let cx = Math.floor((b[0] - MIN_SPACING_M) / GRID_M); cx <= Math.floor((b[2] + MIN_SPACING_M) / GRID_M); cx++) {
    for (let cy = Math.floor((b[1] - MIN_SPACING_M) / GRID_M); cy <= Math.floor((b[3] + MIN_SPACING_M) / GRID_M); cy++) {
      visit(`${cx},${cy}`)
    }
  }
}

function buildGrid(boxes) {
  const grid = new Map()
  boxes.forEach((b, i) => cellsOf(b, (key) => (grid.get(key) ?? grid.set(key, []).get(key)).push(i)))
  return grid
}

function neighbours(grid, b) {
  const found = new Set()
  cellsOf(b, (key) => grid.get(key)?.forEach((j) => found.add(j)))
  return found
}

// --- pushing the buildings aside -----------------------------------------

// `original` holds every building's box as loaded. Returns how far each
// building moves (dx, dy per building, in one array).
//
// Every building moves only straight across the axis, away from it, to the
// side its centre is on; all it has is a distance. Buildings in the corridor
// first move just far enough to leave it. Then any two buildings that have
// come too close are fixed by moving one of them farther out. Two buildings
// must stay MIN_SPACING_M apart, unless they were already closer before
// (terraced houses): then they may stay as close as they were, but no closer.
//
// Two buildings on the same side that move the same distance keep exactly
// their old spacing, so a building never has to move farther than the one
// pushing it, and none moves farther than the deepest push out of the
// corridor. Nor can any building move back into the corridor.
export function planAxis({ original, axis }) {
  const count = original.length
  const fixed = new Set(axis.anchors)
  const side = new Int8Array(count) // 1 or -1: which way across the axis
  const dist = new Float64Array(count) // how far out it moves
  const centre = original.map((b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
  const half = original.map((b) => [(b[2] - b[0]) / 2, (b[3] - b[1]) / 2])

  // How far out a building in the corridor must move to leave it: first just
  // out of the boulevard, then on in 2 m steps until it is also out of the
  // place, and finally to the nearest centimetre between the last two steps.
  const clearDistance = (b, i) => {
    const [, , c0, c1] = project(axis, b)
    const [wx, wy] = [axis.n[0] * side[i], axis.n[1] * side[i]]
    const outside = (t) => !inCorridor(axis, [b[0] + wx * t, b[1] + wy * t, b[2] + wx * t, b[3] + wy * t])
    let hi = inStrip(axis, b) ? (side[i] > 0 ? HALF - c0 : HALF + c1) : 0
    let lo = 0
    while (!outside(hi)) {
      lo = hi
      hi += 2
    }
    while (hi - lo > 0.01) {
      const t = (lo + hi) / 2
      if (outside(t)) hi = t
      else lo = t
    }
    return hi + EPS
  }

  original.forEach((b, i) => {
    const [, , c0, c1] = project(axis, b)
    side[i] = c0 + c1 >= 0 ? 1 : -1
    if (!fixed.has(i) && inCorridor(axis, b)) dist[i] = clearDistance(b, i)
  })

  const move = (i) => [axis.n[0] * side[i] * dist[i], axis.n[1] * side[i] * dist[i]]
  const box = (i) => {
    const [dx, dy] = move(i)
    const o = original[i]
    return [o[0] + dx, o[1] + dy, o[2] + dx, o[3] + dy]
  }

  // The distance building m must move out to clear building o by `req`, with
  // o staying where it is now. Relative to o, m has moved `t` along its own
  // outward direction (t = 0 is where the two started, which was clear).
  // In x and in y, the gap is |centre difference| minus both half-widths;
  // each becomes wide enough beyond some t. Take the nearest.
  const distanceToClear = (m, o, req) => {
    const w = [axis.n[0] * side[m], axis.n[1] * side[m]]
    let t = Infinity
    for (const d of [0, 1]) {
      if (Math.abs(w[d]) < 1e-9) continue
      const r = centre[m][d] - centre[o][d]
      const need = req + EPS + half[m][d] + half[o][d]
      t = Math.min(t, w[d] > 0 ? (need - r) / w[d] : (-need - r) / w[d])
    }
    return t + side[m] * side[o] * dist[o]
  }

  // Does m lie outward of o, seen from m's side of the axis?
  const isOutward = (m, o) =>
    (centre[m][0] - centre[o][0]) * axis.n[0] * side[m] + (centre[m][1] - centre[o][1]) * axis.n[1] * side[m] > 0

  // One round: visit the buildings that have moved, from the axis outward, and
  // fix every pair that is too close by moving one of them farther out: the
  // one lying outward of the other, so a building never jumps past the one
  // pushing it. Anchors never move. If both or neither lie outward, the one
  // needing the shorter extra move goes.
  const round = (apply) => {
    const boxes = Array.from({ length: count }, (_, i) => box(i))
    const grid = buildGrid(boxes)
    const order = Array.from({ length: count }, (_, i) => i).sort((p, q) => dist[p] - dist[q])
    let found = 0
    for (const i of order) {
      if (!dist[i]) continue
      for (const j of neighbours(grid, box(i))) {
        if (j === i || (dist[j] && j < i)) continue // each pair once
        const req = Math.min(MIN_SPACING_M, gapOf(original[i], original[j]))
        if (gapOf(box(i), box(j)) >= req - EPS) continue
        found++
        if (!apply) continue
        const options = [
          [i, j],
          [j, i],
        ]
          .filter(([m]) => !fixed.has(m))
          .map(([m, o]) => [m, distanceToClear(m, o, req)])
          .filter(([m, t]) => t > dist[m])
          .sort((p, q) => p[1] - dist[p[0]] - (q[1] - dist[q[0]]))
        const pick = options.find(([m]) => isOutward(m, m === i ? j : i)) ?? options[0]
        if (pick) dist[pick[0]] = pick[1]
      }
    }
    return found
  }

  let iterations = 0
  while (iterations < MAX_ITERATIONS) {
    iterations++
    if (!round(true)) break
  }

  const offsets = new Float64Array(2 * count)
  let moved = 0
  for (let i = 0; i < count; i++) {
    ;[offsets[2 * i], offsets[2 * i + 1]] = move(i)
    if (dist[i]) moved++
  }
  const inCorridorCount = original.filter((_, i) => !fixed.has(i) && inCorridor(axis, box(i))).length
  return { offsets, moved, iterations, inCorridor: inCorridorCount, tooClose: round(false) }
}

// --- the streets -----------------------------------------------------------

// Cut the street network at a new axis. A street that crosses the axis is
// split where it crosses, and both halves meet the boulevard at a new
// junction. A junction inside the boulevard slides onto its centre line, so
// its streets end at the boulevard. A street lying wholly inside it is dropped.
// The axis itself becomes a walkable chain through all these junctions.
// Returns new nodes (without `adj`; see linkNetwork in reach.js) and edges.
export function cutStreets(nodes, edges, axis, key) {
  const half = AXIS_WIDTH_M / 2
  const local = ([x, y]) => {
    const dx = x - axis.a[0]
    const dy = y - axis.a[1]
    return [dx * axis.u[0] + dy * axis.u[1], dx * axis.n[0] + dy * axis.n[1]]
  }
  const at = (t) => [axis.a[0] + axis.u[0] * t, axis.a[1] + axis.u[1] * t]

  const out = new Map()
  const inside = new Set()
  const junctions = [] // [t along the axis, node id]
  for (const node of nodes.values()) {
    const [t, s] = local(node.xy)
    if (t >= 0 && t <= axis.length && Math.abs(s) < half) {
      out.set(node.id, { id: node.id, xy: at(t) })
      inside.add(node.id)
      junctions.push([t, node.id])
    } else {
      out.set(node.id, { id: node.id, xy: node.xy })
    }
  }

  const newEdges = []
  let k = 0
  for (const e of edges) {
    const ia = inside.has(e.from)
    const ib = inside.has(e.to)
    if (ia && ib) continue
    if (ia || ib) {
      const a = out.get(e.from).xy
      const b = out.get(e.to).xy
      newEdges.push({ ...e, a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) })
      continue
    }
    const [ta, sa] = local(e.a)
    const [tb, sb] = local(e.b)
    if (sa * sb < 0) {
      const f = sa / (sa - sb)
      const t = ta + (tb - ta) * f
      if (t > 0 && t < axis.length) {
        const id = `${key}:${k++}`
        const p = at(t)
        out.set(id, { id, xy: p })
        junctions.push([t, id])
        newEdges.push(
          { id: `${e.id}/${id}a`, from: e.from, to: id, length: e.length * f, a: e.a, b: p },
          { id: `${e.id}/${id}b`, from: id, to: e.to, length: e.length * (1 - f), a: p, b: e.b },
        )
        continue
      }
    }
    newEdges.push(e)
  }

  // The boulevard, from the first anchor's centre to the second's.
  out.set(`${key}:A`, { id: `${key}:A`, xy: axis.a })
  out.set(`${key}:B`, { id: `${key}:B`, xy: axis.b })
  junctions.push([0, `${key}:A`], [axis.length, `${key}:B`])
  junctions.sort((p, q) => p[0] - q[0])
  for (let i = 1; i < junctions.length; i++) {
    const [t0, from] = junctions[i - 1]
    const [t1, to] = junctions[i]
    newEdges.push({ id: `${key}/${i}`, from, to, length: t1 - t0, a: out.get(from).xy, b: out.get(to).xy, axis: true })
  }

  return { nodes: out, edges: newEdges }
}
