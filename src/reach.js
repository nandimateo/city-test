import ClipperLib from 'clipper-lib'

// Walking reach on the street graph, and who lives inside it.
// Everything works in local metres: x to the east, y to the north, around the kit centre.

export const SPEED_M_PER_MIN = 80 // 4.8 km/h
export const MINUTES = [5, 10, 15]
export const BAND_M = 25 // band on each side of a reached street segment
export const MAX_SNAP_M = 100 // farthest a click may be from a walkable street

const SCALE = 100 // Clipper works in integers: 1 unit = 1 cm

// --- projection ---------------------------------------------------------

const R = 6371008.8
export function makeProjection([lon0, lat0]) {
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180)
  const ky = (Math.PI / 180) * R
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]
}

// --- small geometry helpers --------------------------------------------

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const L2 = dx * dx + dy * dy
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a)
  const d2 = o(c, d, b)
  const d3 = o(a, b, c)
  const d4 = o(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function pointInRings(x, y, rings) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

// Shortest distance between a footprint (rings) and a straight segment a–b.
function distFootprintToSegment(rings, a, b) {
  if (pointInRings(a[0], a[1], rings)) return 0
  let best = Infinity
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % ring.length]
      if (segmentsCross(p, q, a, b)) return 0
      best = Math.min(
        best,
        distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]),
        distToSegment(a[0], a[1], p[0], p[1], q[0], q[1]),
        distToSegment(b[0], b[1], p[0], p[1], q[0], q[1]),
      )
    }
  }
  return best
}

function bboxOf(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return [minX, minY, maxX, maxY]
}

function ringArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return Math.abs(a) / 2
}

// Drop the repeated closing point of a GeoJSON ring.
function openRing(ring) {
  const f = ring[0]
  const l = ring[ring.length - 1]
  return f[0] === l[0] && f[1] === l[1] ? ring.slice(0, -1) : ring
}

// --- preparing the kit --------------------------------------------------

export function prepareKit({ kit, buildings, graph, zensus }) {
  const project = makeProjection(kit.center)

  const nodes = new Map()
  for (const n of graph.nodes) nodes.set(n.id, { id: n.id, xy: project([n.lon, n.lat]) })

  const edges = []
  for (const e of graph.edges) {
    if (!e.walkable) continue
    // Each edge is one straight line from `from` to `to`.
    edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      length: e.length,
      a: project(e.coords[0]),
      b: project(e.coords[e.coords.length - 1]),
    })
  }
  const walkableNodes = linkNetwork(nodes, edges)

  const footprints = buildings.features.map((f) => {
    const rings = f.geometry.coordinates.map((r) => openRing(r).map(project))
    return {
      id: f.properties.id,
      use: f.properties.use ?? 'none',
      height: f.properties.height,
      rings,
      bbox: bboxOf(rings),
    }
  })

  const cells = zensus.features.map((f) => {
    const rings = f.geometry.coordinates.map((r) => openRing(r).map(project))
    return {
      id: f.properties.id,
      population: f.properties.population,
      rings,
      bbox: bboxOf(rings),
      area: ringArea(rings[0]),
    }
  })

  return { project, nodes, edges, walkableNodes, footprints, cells }
}

// Give every node the list of edges that meet it; returns the nodes that have any.
export function linkNetwork(nodes, edges) {
  for (const n of nodes.values()) n.adj = []
  for (const e of edges) {
    nodes.get(e.from).adj.push(e)
    nodes.get(e.to).adj.push(e)
  }
  return [...nodes.values()].filter((n) => n.adj.length > 0)
}

// The footprints moved by their offsets (dx, dy per building), without turning them.
export function moveFootprints(footprints, offsets) {
  return footprints.map((f, i) => {
    const dx = offsets[2 * i]
    const dy = offsets[2 * i + 1]
    if (!dx && !dy) return f
    const [x0, y0, x1, y1] = f.bbox
    return {
      ...f,
      rings: f.rings.map((r) => r.map(([x, y]) => [x + dx, y + dy])),
      bbox: [x0 + dx, y0 + dy, x1 + dx, y1 + dy],
    }
  })
}

// --- starting point -----------------------------------------------------

export function findStart(prep, [x, y]) {
  let nearestStreet = Infinity
  for (const e of prep.edges) {
    nearestStreet = Math.min(nearestStreet, distToSegment(x, y, e.a[0], e.a[1], e.b[0], e.b[1]))
  }
  if (nearestStreet > MAX_SNAP_M) return { ok: false, nearestStreet }

  let best = null
  let bestD = Infinity
  for (const n of prep.walkableNodes) {
    const d = Math.hypot(n.xy[0] - x, n.xy[1] - y)
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return { ok: true, node: best, nodeDistance: bestD, nearestStreet }
}

// --- walking: Dijkstra over edge lengths --------------------------------

function walk(prep, startId, maxDist) {
  const dist = new Map([[startId, 0]])
  const heap = [[0, startId]]
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, id] = pop()
    if (d > dist.get(id) || d > maxDist) continue
    for (const e of prep.nodes.get(id).adj) {
      const other = e.from === id ? e.to : e.from
      const nd = d + e.length
      if (nd < (dist.get(other) ?? Infinity)) {
        dist.set(other, nd)
        push([nd, other])
      }
    }
  }
  return dist
}

// The street pieces reachable within `budget` metres, including the reachable
// part of the last segment, walked in from either end.
function reachedPieces(prep, dist, budget) {
  const pieces = []
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  for (const e of prep.edges) {
    const fromLeft = Math.max(0, budget - (dist.get(e.from) ?? Infinity))
    const toLeft = Math.max(0, budget - (dist.get(e.to) ?? Infinity))
    if (fromLeft <= 0 && toLeft <= 0) continue
    if (fromLeft + toLeft >= e.length) {
      pieces.push([e.a, e.b])
    } else {
      if (fromLeft > 0) pieces.push([e.a, lerp(e.a, e.b, fromLeft / e.length)])
      if (toLeft > 0) pieces.push([lerp(e.b, e.a, toLeft / e.length), e.b])
    }
  }
  return pieces
}

// --- the 25 m band, joined into one shape -------------------------------

function toClipperPath(points) {
  return points.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
}

function bufferPieces(pieces) {
  const co = new ClipperLib.ClipperOffset(2, 0.2 * SCALE) // round ends, arcs within 20 cm
  for (const [a, b] of pieces) {
    co.AddPath(toClipperPath([a, b]), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  }
  const tree = new ClipperLib.PolyTree()
  co.Execute(tree, BAND_M * SCALE)
  const paths = ClipperLib.Clipper.PolyTreeToPaths(tree)
  return { tree, paths }
}

function bandPolygons(pieces) {
  const { tree } = bufferPieces(pieces)
  // For drawing: polygons with their holes, back in metres.
  const polygons = ClipperLib.JS.PolyTreeToExPolygons(tree).map((ex) => ({
    outer: ex.outer.map((p) => [p.X / SCALE, p.Y / SCALE]),
    holes: ex.holes.map((h) => h.map((p) => [p.X / SCALE, p.Y / SCALE])),
  }))
  return polygons
}

// Area in m² of a census cell that lies inside the band shape.
// Only the pieces near the cell can reach into it, so the band is rebuilt
// from those alone: the same shape inside the cell, and much faster.
function overlapArea(cell, pieces) {
  const [x0, y0, x1, y1] = cell.bbox
  const nearby = pieces.filter(
    ([a, b]) =>
      Math.max(a[0], b[0]) + BAND_M >= x0 && Math.min(a[0], b[0]) - BAND_M <= x1 &&
      Math.max(a[1], b[1]) + BAND_M >= y0 && Math.min(a[1], b[1]) - BAND_M <= y1,
  )
  if (!nearby.length) return 0
  const areaPaths = bufferPieces(nearby).paths
  const c = new ClipperLib.Clipper()
  c.AddPaths(areaPaths, ClipperLib.PolyType.ptSubject, true)
  c.AddPaths(cell.rings.map(toClipperPath), ClipperLib.PolyType.ptClip, true)
  const out = new ClipperLib.Paths()
  c.Execute(
    ClipperLib.ClipType.ctIntersection,
    out,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  let a = 0
  for (const p of out) a += ClipperLib.Clipper.Area(p) // holes count negative
  return a / (SCALE * SCALE)
}

// --- the whole analysis for one click -----------------------------------

export function computeReach(prep, startId) {
  const maxBudget = Math.max(...MINUTES) * SPEED_M_PER_MIN
  const dist = walk(prep, startId, maxBudget)

  const areas = MINUTES.map((minutes) => {
    const budget = minutes * SPEED_M_PER_MIN
    const pieces = reachedPieces(prep, dist, budget)
    const polygons = bandPolygons(pieces)

    // Bounding box of the band shape, to skip far-away buildings and cells.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [a, b] of pieces) {
      minX = Math.min(minX, a[0], b[0]); maxX = Math.max(maxX, a[0], b[0])
      minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1])
    }
    minX -= BAND_M; minY -= BAND_M; maxX += BAND_M; maxY += BAND_M
    const near = (bb) => bb[2] >= minX && bb[0] <= maxX && bb[3] >= minY && bb[1] <= maxY

    // A building touches the area when it comes within 25 m of a reached piece.
    const buildings = new Set()
    prep.footprints.forEach((f, i) => {
      if (!near(f.bbox)) return
      for (const [a, b] of pieces) {
        // quick reject on the piece's own box
        if (
          Math.max(a[0], b[0]) + BAND_M < f.bbox[0] || Math.min(a[0], b[0]) - BAND_M > f.bbox[2] ||
          Math.max(a[1], b[1]) + BAND_M < f.bbox[1] || Math.min(a[1], b[1]) - BAND_M > f.bbox[3]
        ) continue
        if (distFootprintToSegment(f.rings, a, b) <= BAND_M) {
          buildings.add(i)
          return
        }
      }
    })

    // Residents: population × share of the cell inside the area.
    let residents = 0
    let cellsWithoutFigure = 0
    let cellsOverlapping = 0
    for (const cell of prep.cells) {
      if (!near(cell.bbox)) continue
      const inside = overlapArea(cell, pieces)
      if (inside <= 0.01) continue
      cellsOverlapping++
      if (cell.population == null) {
        cellsWithoutFigure++
        continue
      }
      residents += cell.population * Math.min(1, inside / cell.area)
    }

    return {
      minutes,
      budget,
      polygons,
      buildings,
      residentsExact: residents,
      residents: Math.round(residents / 10) * 10,
      cellsOverlapping,
      cellsWithoutFigure,
    }
  })

  return { dist, areas }
}
