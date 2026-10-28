// The Renovation Council: the facts behind every round. The app works them
// out here; Claude only chooses between them (see server/council.js).
// Local metres, x to the east, y to the north, as in reach.js.

import { walk, findStart, linkNetwork, distFootprintToSegment, pointInRings, ringArea } from './reach.js'

export const WIDTHS_M = [12, 20, 32] // lane, avenue, boulevard
export const SPEED_KMH = { 12: 25, 20: 35, 32: 50 } // driving on a new route of that width
export const OLD_TOWN_KMH = 15 // driving through the old streets today
export const TRIP_M = [300, 1200] // how far away, in a straight line, a resident looks for a destination
export const CANDIDATES = 8 // destinations offered to the resident
export const BEND_SHARES = [-0.5, -0.35, -0.2, -0.1, 0.1, 0.2, 0.35, 0.5] // bend points tried, as a share of the trip, to either side
export const PUBLIC_USES = new Set(['culture', 'civic', 'education', 'health'])
export const ARCH_FROM_M = 20 // routes this wide get a triumphal arch; narrower ones a victory column

// Each planner owns one kind of route and only chooses its width.
export const PLANNERS = [
  { id: 'p1', name: 'The Prefect', style: 'straight', idea: 'a straight cut from door to door' },
  { id: 'p2', name: 'The Engineer', style: 'streets', idea: 'the existing streets, widened' },
  { id: 'p3', name: 'The Conservator', style: 'bent', idea: 'a bent route around what is worth keeping' },
]

export const centre = (f) => [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2]
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
export const minutes = (m, kmh) => m / ((kmh * 1000) / 60)
export const lineLength = (line) => line.slice(1).reduce((s, p, i) => s + dist(line[i], p), 0)

// --- who lives where -----------------------------------------------------

// Residents per building: each census cell's population shared over the
// residential buildings whose centre lies in it, by volume (footprint × height).
// Cells without a published figure give nobody.
export function estimateResidents(prep) {
  const volume = prep.footprints.map((f) => (f.use === 'residential' ? ringArea(f.rings[0]) * f.height : 0))
  const residents = new Float64Array(prep.footprints.length)
  for (const cell of prep.cells) {
    if (!cell.population) continue
    const [x0, y0, x1, y1] = cell.bbox
    const inside = []
    let total = 0
    prep.footprints.forEach((f, i) => {
      if (!volume[i]) return
      const [x, y] = centre(f)
      if (x < x0 || x > x1 || y < y0 || y > y1 || !pointInRings(x, y, cell.rings)) return
      inside.push(i)
      total += volume[i]
    })
    for (const i of inside) residents[i] += (cell.population * volume[i]) / total
  }
  return residents
}

// A random residential building that still stands and where someone lives
// (the data also calls sheds and garages residential).
export function pickResident(prep, residents, random = Math.random) {
  const homes = []
  prep.footprints.forEach((f, i) => {
    if (f.use === 'residential' && residents[i] >= 1 && !prep.removed.has(i)) homes.push(i)
  })
  return homes[Math.floor(random() * homes.length)]
}

// --- where the resident wants to go ---------------------------------------

// Standing non-residential buildings TRIP_M away in a straight line, with how
// far they are by street. The worst detours first, at most two of each use.
export function findDestinations(prep, home) {
  const from = centre(prep.footprints[home])
  const start = findStart(prep, from)
  if (!start.ok) return []
  const reached = walk(prep, start.node.id, TRIP_M[1] * 4)
  const found = []
  prep.footprints.forEach((f, j) => {
    if (j === home || prep.removed.has(j) || ['residential', 'undefined', 'none'].includes(f.use)) return
    const to = centre(f)
    const straight = dist(from, to)
    if (straight < TRIP_M[0] || straight > TRIP_M[1]) return
    const end = findStart(prep, to)
    if (!end.ok || end.node.id === start.node.id) return
    const onStreets = reached.get(end.node.id)
    if (onStreets == null) return
    const street = onStreets + start.nodeDistance + end.nodeDistance
    found.push({ index: j, id: f.id, use: f.use, height: f.height, straight, street, detour: street / straight, homeNode: start.node.id, destNode: end.node.id })
  })
  found.sort((p, q) => q.detour - p.detour)
  const perUse = new Map()
  const picked = []
  for (const d of found) {
    const n = perUse.get(d.use) ?? 0
    if (n >= 2) continue
    perUse.set(d.use, n + 1)
    picked.push({ ...d, oldMinutes: minutes(d.street, OLD_TOWN_KMH) })
    if (picked.length === CANDIDATES) break
  }
  return picked
}

// The street path between two junctions, read back from Dijkstra's distances.
function streetPath(prep, reached, fromId, toId) {
  const path = [prep.nodes.get(toId).xy]
  let id = toId
  for (let guard = 0; id !== fromId && guard < 10000; guard++) {
    const here = reached.get(id)
    const step = prep.nodes.get(id).adj.find((e) => {
      const other = e.from === id ? e.to : e.from
      const d = reached.get(other)
      return d != null && Math.abs(d + e.length - here) < 1e-6
    })
    if (!step) break
    id = step.from === id ? step.to : step.from
    path.push(prep.nodes.get(id).xy)
  }
  return path.reverse()
}

// A use as it reads in a sentence: "an office building", "a food and drink building".
export function aUse(use) {
  const words = String(use).replace(/_/g, ' ')
  return `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`
}

// --- the designs -----------------------------------------------------------

// Standing buildings that come within width/2 of the route, except `keep`.
export function buildingsInCorridor(prep, line, width, keep) {
  const half = width / 2
  const out = []
  prep.footprints.forEach((f, i) => {
    if (keep.has(i) || prep.removed.has(i)) return
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1]
      const b = line[k]
      if (
        Math.max(a[0], b[0]) + half < f.bbox[0] || Math.min(a[0], b[0]) - half > f.bbox[2] ||
        Math.max(a[1], b[1]) + half < f.bbox[1] || Math.min(a[1], b[1]) - half > f.bbox[3]
      ) continue
      if (distFootprintToSegment(f.rings, a, b) <= half) {
        out.push(i)
        return
      }
    }
  })
  return out
}

// Every route style in every width, with what it costs and what it saves.
// Returns { straight: [...], streets: [...], bent: [...] }, one per width.
export function designOptions(prep, residents, home, dest) {
  const keep = new Set([home, dest.index])
  const a = centre(prep.footprints[home])
  const b = centre(prep.footprints[dest.index])
  const reached = walk(prep, dest.homeNode, dest.street * 2 + 100)
  const path = streetPath(prep, reached, dest.homeNode, dest.destNode)

  const describe = (style, width, line) => {
    const removed = buildingsInCorridor(prep, line, width, keep)
    const length = lineLength(line)
    return {
      style,
      width,
      line,
      removed,
      homesLost: removed.filter((i) => prep.footprints[i].use === 'residential').length,
      publicLost: removed.filter((i) => PUBLIC_USES.has(prep.footprints[i].use)).length,
      displaced: Math.round(removed.reduce((s, i) => s + residents[i], 0)),
      length,
      oldMinutes: dest.oldMinutes,
      newMinutes: minutes(length, SPEED_KMH[width]),
    }
  }

  const u = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)]
  const n = [-u[1], u[0]]
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const options = { straight: [], streets: [], bent: [] }
  for (const width of WIDTHS_M) {
    options.straight.push(describe('straight', width, [a, b]))
    options.streets.push(describe('streets', width, [a, ...path, b]))
    // The bend goes through the point beside the midpoint that removes the fewest buildings.
    let best = null
    for (const share of BEND_SHARES) {
      const off = share * dest.straight
      const d = describe('bent', width, [a, [mid[0] + n[0] * off, mid[1] + n[1] * off], b])
      if (!best || d.removed.length < best.removed.length || (d.removed.length === best.removed.length && d.length < best.length)) best = d
    }
    options.bent.push(best)
  }
  return options
}

// The monument that marks the middle of a built route.
export const monumentFor = (width) => (width >= ARCH_FROM_M ? 'a triumphal arch' : 'a victory column')

// --- carrying it out -------------------------------------------------------

// The city after the winning design: its buildings demolished and, for a new
// route, the route added to the network from the home's junction to the
// destination's. Widened streets keep their network as it was.
export function applyDesign(prep, design, dest, round) {
  const removed = new Set(prep.removed)
  for (const i of design.removed) removed.add(i)
  if (design.style === 'streets') return { ...prep, removed }

  // Copy the junctions, so the city as it was stays untouched.
  const nodes = new Map([...prep.nodes].map(([id, n]) => [id, { id, xy: n.xy }]))
  const ids = design.line.map((xy, k) => {
    const id = `route${round}:${k}`
    nodes.set(id, { id, xy })
    return id
  })
  const edges = [...prep.edges]
  const link = (from, to) => {
    const a = nodes.get(from).xy
    const b = nodes.get(to).xy
    edges.push({ id: `${from}>${to}`, from, to, length: dist(a, b), a, b, route: true })
  }
  link(dest.homeNode, ids[0])
  for (let k = 1; k < ids.length; k++) link(ids[k - 1], ids[k])
  link(ids[ids.length - 1], dest.destNode)
  const walkableNodes = linkNetwork(nodes, edges)
  return { ...prep, nodes, edges, walkableNodes, removed }
}
