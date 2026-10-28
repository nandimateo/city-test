import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WALL, ROOF, GILT, REACH_COLORS, GROUND, BACKGROUND, STREET, ROUTE, RUBBLE, MONUMENT, PLANNER_COLORS } from './palette.js'
import { ARCH_FROM_M } from './council.js'

// Local metres (x east, y north) become three.js (x, height, -y).

const SINK_S = 1.4 // how long a demolished building takes to collapse
const COLLAPSE_AFTER_S = 0.15 // it drops just after its dust bursts
const CASCADE_S = 2.5 // the last building of a demolition goes this long after the first
const DUST_S = 4 // how long a dust cloud lingers
const RISE_AFTER_S = CASCADE_S + SINK_S + 0.3 // the monument rises once the dust has settled a little
const RISE_S = 2.2
const DUST = '#a8987e' // darker than the ground, so the cloud reads against it
const DEBRIS = '#4a433b'
const FLASH = '#ffb347' // the blast itself, for a moment
const FLY_S = 1.8 // how long the camera takes to reach a new round
const RUBBLE_M = 0.4 // what is left of it, just above the ground

function shapeFromRings(rings) {
  const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

// All buildings in one mesh, with a colour per vertex, so the view stays smooth.
// `ranges[i]` is building i's first vertex and vertex count; `roof` marks the
// vertices of the upward-facing tops; `basePositions` keeps where every
// vertex started, so demolished buildings can sink from there.
function useBuildingGeometry(footprints) {
  return useMemo(() => {
    const parts = []
    const ranges = []
    let start = 0
    for (const f of footprints) {
      const g = new THREE.ExtrudeGeometry(shapeFromRings(f.rings), { depth: f.height, bevelEnabled: false })
      g.deleteAttribute('uv')
      const count = g.attributes.position.count
      ranges.push([start, count])
      start += count
      parts.push(g)
    }
    const merged = mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())
    merged.rotateX(-Math.PI / 2)
    merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(start * 3), 3))
    const normals = merged.attributes.normal.array
    const roof = new Uint8Array(start)
    for (let v = 0; v < start; v++) roof[v] = normals[v * 3 + 1] > 0.9 ? 1 : 0
    const basePositions = merged.attributes.position.array.slice()
    return { geometry: merged, ranges, roof, basePositions }
  }, [footprints])
}

const centreOf = (f) => [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2]

// Each demolition is a wave: its buildings go one after another, starting
// nearest the resident's home, so the explosions run along the route.
let waveIds = 0
function useWaves(removed, footprints, origin) {
  const seen = useRef(new Set())
  const [waves, setWaves] = useState([])
  useEffect(() => {
    const fresh = [...removed].filter((i) => !seen.current.has(i))
    if (!fresh.length) return
    fresh.forEach((i) => seen.current.add(i))
    const at = fresh.map((i) => centreOf(footprints[i]))
    const o = origin ?? at[0]
    const d = at.map(([x, y]) => Math.hypot(x - o[0], y - o[1]))
    const lo = Math.min(...d)
    const span = Math.max(...d) - lo || 1
    const items = fresh.map((i, k) => ({ i, delay: ((d[k] - lo) / span) * CASCADE_S }))
    setWaves((w) => [...w, { id: ++waveIds, items }])
  }, [removed, footprints, origin])
  const done = useCallback((id) => setWaves((w) => w.filter((x) => x.id !== id)), [])
  return [waves, done]
}

// A soft round puff, drawn once, for the dust.
let puffTexture = null
function puff() {
  if (!puffTexture) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    puffTexture = new THREE.CanvasTexture(c)
  }
  return puffTexture
}

// Particles that start at their own time, fly out and fade: a position and a
// colour with its own alpha per particle, updated every frame.
function makeParticles(list, color) {
  const n = list.length
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  const rgba = new Float32Array(n * 4)
  const c = new THREE.Color(color)
  for (let k = 0; k < n; k++) rgba.set([c.r, c.g, c.b, 0], k * 4)
  geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4))
  return { geometry, list }
}

// One demolition, building by building: a short flash of the blast, a
// billowing cloud of dust drifting out and up, and dark debris thrown out
// that falls back.
function DustWave({ wave, footprints, onDone }) {
  const { flash, dust, debris, materials } = useMemo(() => {
    const rand = (a, b) => a + Math.random() * (b - a)
    const flashes = []
    const clouds = []
    const bits = []
    for (const { i, delay } of wave.items) {
      const f = footprints[i]
      const [x0, y0, x1, y1] = f.bbox
      const [cx, cy] = centreOf(f)
      const area = (x1 - x0) * (y1 - y0)
      const out = (x, y, speed) => {
        const len = Math.hypot(x - cx, y - cy) || 1
        return [((x - cx) / len) * speed, -((y - cy) / len) * speed] // three.js x and z
      }
      for (let k = 0; k < 4; k++) {
        flashes.push({ p: [cx + rand(-3, 3), f.height * rand(0.3, 0.7), -cy + rand(-3, 3)], v: [rand(-2, 2), rand(2, 5), rand(-2, 2)], born: delay + rand(0, 0.1), life: rand(0.35, 0.6) })
      }
      for (let k = 0, n = Math.min(70, Math.max(14, Math.round(area / 15))); k < n; k++) {
        const x = rand(x0, x1)
        const y = rand(y0, y1)
        const [vx, vz] = out(x, y, rand(2, 7))
        clouds.push({ p: [x, rand(0, f.height * 0.8), -y], v: [vx, rand(2, 7), vz], born: delay + rand(0, 0.4), life: DUST_S * rand(0.6, 1) })
      }
      for (let k = 0, n = Math.min(30, Math.max(8, Math.round(area / 40))); k < n; k++) {
        const x = rand(x0, x1)
        const y = rand(y0, y1)
        const [vx, vz] = out(x, y, rand(4, 11))
        bits.push({ p: [x, rand(f.height * 0.3, f.height), -y], v: [vx, rand(3, 8), vz], born: delay + rand(0, 0.2), life: rand(1.2, 1.8) })
      }
    }
    const points = (size) => new THREE.PointsMaterial({ size, map: puff(), vertexColors: true, transparent: true, depthWrite: false })
    const materials = [points(18), points(3.5), points(30)]
    return { dust: makeParticles(clouds, DUST), debris: makeParticles(bits, DEBRIS), flash: makeParticles(flashes, FLASH), materials }
  }, [wave, footprints])

  useEffect(
    () => () => {
      dust.geometry.dispose()
      debris.geometry.dispose()
      flash.geometry.dispose()
      materials.forEach((m) => m.dispose())
    },
    [dust, debris, flash, materials],
  )

  const t0 = useRef(null)
  useFrame(({ clock }) => {
    if (t0.current == null) t0.current = clock.elapsedTime
    const t = clock.elapsedTime - t0.current
    const step = ({ geometry, list }, kind) => {
      const falls = kind === 'debris'
      const pos = geometry.attributes.position.array
      const rgba = geometry.attributes.color.array
      list.forEach(({ p, v, born, life }, k) => {
        const age = t - born
        const s = age / life
        let alpha = 0
        if (age >= 0 && s < 1) {
          // Dust slows down in the air; debris keeps its speed and falls.
          const f = falls ? age : (1 - Math.exp(-1.6 * age)) / 1.6
          const up = p[1] + v[1] * f - (falls ? 4.9 * age * age : 0)
          pos.set([p[0] + v[0] * f, Math.max(RUBBLE_M, up), p[2] + v[2] * f], k * 3)
          if (kind === 'debris') alpha = 1 - s
          else if (kind === 'flash') alpha = 1 - s * s
          else alpha = Math.min(1, s / 0.06) * Math.pow(1 - s, 1.3)
        }
        rgba[k * 4 + 3] = alpha
      })
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
    }
    step(dust, 'dust')
    step(debris, 'debris')
    step(flash, 'flash')
    materials[0].size = 18 + 36 * Math.min(1, t / 3) // the cloud swells
    if (t > CASCADE_S + DUST_S + 0.5) onDone(wave.id)
  })

  return (
    <>
      <points geometry={dust.geometry} material={materials[0]} frustumCulled={false} />
      <points geometry={debris.geometry} material={materials[1]} frustumCulled={false} />
      <points geometry={flash.geometry} material={materials[2]} frustumCulled={false} />
    </>
  )
}

// Which building a vertex belongs to.
function buildingAt(ranges, vertex) {
  let lo = 0
  let hi = ranges.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ranges[mid][0] <= vertex) lo = mid
    else hi = mid - 1
  }
  return lo
}

function Buildings({ footprints, removed, waves, levels, chosen, condemned, meshRef }) {
  const { geometry, ranges, roof, basePositions } = useBuildingGeometry(footprints)

  // Walls in limestone, roofs in zinc. Reached buildings take the reach shade;
  // a building a planner would demolish takes that planner's colour; the
  // resident's home and destination are gilt; demolished ones are rubble.
  useEffect(() => {
    const colors = geometry.attributes.color.array
    const wall = new THREE.Color(WALL)
    const zinc = new THREE.Color(ROOF)
    const gilt = new THREE.Color(GILT)
    const rubble = new THREE.Color(RUBBLE)
    const reachWalls = REACH_COLORS.map((c) => new THREE.Color(c))
    const reachRoofs = reachWalls.map((c) => zinc.clone().lerp(c, 0.45))
    const planner = Object.fromEntries(Object.entries(PLANNER_COLORS).map(([k, c]) => [k, new THREE.Color(c)]))
    const gold = new Set(chosen)
    footprints.forEach((f, i) => {
      const level = levels?.[i]
      let w = level != null ? reachWalls[level] : wall
      let r = level != null ? reachRoofs[level] : zinc
      if (condemned?.has(i)) w = r = planner[condemned.get(i)]
      if (gold.has(i)) w = r = gilt
      if (removed.has(i)) w = r = rubble
      const [s, n] = ranges[i]
      for (let v = s; v < s + n; v++) {
        const c = roof[v] ? r : w
        colors[v * 3] = c.r
        colors[v * 3 + 1] = c.g
        colors[v * 3 + 2] = c.b
      }
    })
    geometry.attributes.color.needsUpdate = true
  }, [geometry, ranges, roof, footprints, removed, levels, chosen, condemned])

  // Each building of a wave collapses at its turn, just after its dust bursts,
  // falling faster as it goes.
  const started = useRef(new Map()) // wave id -> when it began
  const fallen = useRef(new Set())
  useFrame(({ clock }) => {
    if (!waves.length) return
    const now = clock.elapsedTime
    const pos = geometry.attributes.position.array
    let moved = false
    for (const w of waves) {
      if (!started.current.has(w.id)) started.current.set(w.id, now)
      const t0 = started.current.get(w.id)
      for (const { i, delay } of w.items) {
        if (fallen.current.has(i)) continue
        const t = Math.min(1, Math.max(0, (now - t0 - delay - COLLAPSE_AFTER_S) / SINK_S))
        if (t === 0) continue
        const e = t * t
        const [s, n] = ranges[i]
        for (let v = s; v < s + n; v++) {
          const y = basePositions[v * 3 + 1]
          if (y > 0.01) pos[v * 3 + 1] = y + (RUBBLE_M - y) * e
        }
        moved = true
        if (t === 1) fallen.current.add(i)
      }
    }
    if (moved) geometry.attributes.position.needsUpdate = true
  })

  return (
    <mesh ref={meshRef} geometry={geometry} userData={{ ranges }}>
      <meshLambertMaterial vertexColors />
    </mesh>
  )
}

function Streets({ edges }) {
  const geometry = useMemo(() => {
    const pos = new Float32Array(edges.length * 6)
    edges.forEach((e, i) => {
      pos.set([e.a[0], 1.5, -e.a[1], e.b[0], 1.5, -e.b[1]], i * 6)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [edges])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={STREET} />
    </lineSegments>
  )
}

// A band `width` metres wide along a line, flat at height y: a rectangle per
// segment and a disc at every bend, so the corners stay filled.
function Ribbon({ line, width, color, y }) {
  const geometry = useMemo(() => {
    const h = width / 2
    const pos = []
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1]
      const [bx, by] = line[k]
      const len = Math.hypot(bx - ax, by - ay) || 1
      const nx = (-(by - ay) / len) * h
      const ny = ((bx - ax) / len) * h
      const p = [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ].map(([x, z]) => [x, y, -z])
      pos.push(...p[0], ...p[3], ...p[1], ...p[1], ...p[3], ...p[2])
    }
    for (const [cx, cy] of line.slice(1, -1)) {
      const steps = 16
      for (let s = 0; s < steps; s++) {
        const f0 = (s / steps) * 2 * Math.PI
        const f1 = ((s + 1) / steps) * 2 * Math.PI
        pos.push(cx, y, -cy, cx + Math.cos(f0) * h, y, -(cy + Math.sin(f0) * h), cx + Math.cos(f1) * h, y, -(cy + Math.sin(f1) * h))
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    return g
  }, [line, width, y])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  )
}

// The middle of a route and its direction there, in local metres.
function middleOf(line) {
  const lengths = line.slice(1).map((p, k) => Math.hypot(p[0] - line[k][0], p[1] - line[k][1]))
  let left = lengths.reduce((s, l) => s + l, 0) / 2
  for (let k = 0; k < lengths.length; k++) {
    if (left <= lengths[k] || k === lengths.length - 1) {
      const [a, b] = [line[k], line[k + 1]]
      const t = lengths[k] ? left / lengths[k] : 0
      return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], turn: Math.atan2(b[1] - a[1], b[0] - a[0]) }
    }
    left -= lengths[k]
  }
}

// An abstract Arc de Triomphe: two piers and an attic across them, turned so
// the route runs straight through the arch. In its own frame, x runs along
// the route and z across it. Full size on a 32 m route, smaller on narrower ones.
const ARCH = { width: 24, depth: 12, height: 26, opening: 9, openingHeight: 16 }

function TriumphalArch({ scale }) {
  const { width, depth, height, opening, openingHeight } = ARCH
  const pier = (width - opening) / 2
  return (
    <group scale={scale}>
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, openingHeight / 2, s * (opening / 2 + pier / 2)]}>
          <boxGeometry args={[depth, openingHeight, pier]} />
          <meshLambertMaterial color={MONUMENT} />
        </mesh>
      ))}
      <mesh position={[0, openingHeight + (height - openingHeight) / 2, 0]}>
        <boxGeometry args={[depth, height - openingHeight, width]} />
        <meshLambertMaterial color={MONUMENT} />
      </mesh>
      <mesh position={[0, openingHeight + 0.6, 0]}>
        <boxGeometry args={[depth + 1, 1.2, width + 1]} />
        <meshLambertMaterial color={MONUMENT} />
      </mesh>
    </group>
  )
}

// A victory column, after Berlin's Siegessäule: a plinth, a stone column and
// a gilt figure on top, 47 m tall. Narrow enough for a 12 m street.
function VictoryColumn() {
  return (
    <group scale={1.5}>
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[6, 3, 6]} />
        <meshLambertMaterial color={MONUMENT} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <boxGeometry args={[4.2, 2, 4.2]} />
        <meshLambertMaterial color={MONUMENT} />
      </mesh>
      <mesh position={[0, 15, 0]}>
        <cylinderGeometry args={[0.9, 1.2, 20, 24]} />
        <meshLambertMaterial color={MONUMENT} />
      </mesh>
      <mesh position={[0, 25.5, 0]}>
        <cylinderGeometry args={[1.8, 1.4, 1, 24]} />
        <meshLambertMaterial color={MONUMENT} />
      </mesh>
      <mesh position={[0, 28, 0]}>
        <coneGeometry args={[0.9, 4, 16]} />
        <meshLambertMaterial color={GILT} />
      </mesh>
      <mesh position={[0, 30.5, 0]}>
        <sphereGeometry args={[0.6, 16, 12]} />
        <meshLambertMaterial color={GILT} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, 29.2, s * 1.2]} rotation-x={s * 0.6}>
          <boxGeometry args={[0.2, 2.4, 1.8]} />
          <meshLambertMaterial color={GILT} />
        </mesh>
      ))}
    </group>
  )
}

// The monument in the middle of a built route, rising out of the ground once
// its demolition has passed.
function Monument({ route }) {
  const { at, turn } = useMemo(() => middleOf(route.line), [route.line])
  const group = useRef()
  const t0 = useRef(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    if (t0.current == null) t0.current = clock.elapsedTime
    const t = Math.min(1, Math.max(0, (clock.elapsedTime - t0.current - RISE_AFTER_S) / RISE_S))
    group.current.scale.y = Math.max(0.001, t * t * (3 - 2 * t))
  })
  return (
    <group ref={group} position={[at[0], 1, -at[1]]} rotation-y={turn} scale={[1, 0.001, 1]}>
      {route.width >= ARCH_FROM_M ? <TriumphalArch scale={Math.min(1, (route.width * 0.8) / ARCH.width)} /> : <VictoryColumn />}
    </group>
  )
}

// A gilt pin above the resident's home and their destination.
function Pin({ footprint }) {
  const [x0, y0, x1, y1] = footprint.bbox
  const top = footprint.height + 18
  return (
    <mesh position={[(x0 + x1) / 2, top, -(y0 + y1) / 2]} rotation-x={Math.PI}>
      <coneGeometry args={[7, 22, 24]} />
      <meshLambertMaterial color={GILT} />
    </mesh>
  )
}

// The camera glides to each round: first to the resident's home, then to
// frame home and destination together. Orbiting stays free in between.
function FollowRound({ focus }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const flight = useRef(null)
  const [x, y, r] = focus ?? []
  useEffect(() => {
    if (x == null || !controls) return
    const toTarget = new THREE.Vector3(x, 0, -y)
    const away = camera.position.clone().sub(controls.target).normalize()
    flight.current = {
      fromTarget: controls.target.clone(),
      toTarget,
      fromCamera: camera.position.clone(),
      toCamera: toTarget.clone().add(away.multiplyScalar(Math.max(450, r * 2.6))),
      t0: null,
    }
  }, [x, y, r, camera, controls])
  useFrame(({ clock }) => {
    const f = flight.current
    if (!f || !controls) return
    if (f.t0 == null) f.t0 = clock.elapsedTime
    const t = Math.min(1, (clock.elapsedTime - f.t0) / FLY_S)
    const e = t * t * (3 - 2 * t)
    controls.target.lerpVectors(f.fromTarget, f.toTarget, e)
    camera.position.lerpVectors(f.fromCamera, f.toCamera, e)
    controls.update()
    if (t === 1) flight.current = null
  })
  return null
}

// On the ground each area is a lighter tint of its shade, so reached buildings stand out.
// Mixed as the eye sees colour (sRGB), so the three tints stay clearly apart.
function groundTint(color) {
  const g = new THREE.Color(GROUND).getRGB({}, THREE.SRGBColorSpace)
  const c = new THREE.Color(color).getRGB({}, THREE.SRGBColorSpace)
  const t = 0.6
  return new THREE.Color().setRGB(
    g.r + (c.r - g.r) * t,
    g.g + (c.g - g.g) * t,
    g.b + (c.b - g.b) * t,
    THREE.SRGBColorSpace,
  )
}

function ReachArea({ polygons, color, level }) {
  const tint = useMemo(() => groundTint(color), [color])
  const geometry = useMemo(() => {
    const shapes = polygons.map(({ outer, holes }) => shapeFromRings([outer, ...holes]))
    const g = new THREE.ShapeGeometry(shapes)
    g.rotateX(-Math.PI / 2)
    return g
  }, [polygons])
  useEffect(() => () => geometry.dispose(), [geometry])
  // 15 min lowest, 5 min on top
  const y = 0.3 * (3 - level)
  return (
    <mesh geometry={geometry} position={[0, y, 0]}>
      <meshBasicMaterial color={tint} />
    </mesh>
  )
}

// A click (not a drag) picks the point under the mouse: on a roof or on the
// ground. It also says which building was hit, or null for the ground.
function ClickPicker({ buildingsRef, onPick }) {
  const { camera, gl } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    let down = null
    const onDown = (e) => {
      down = e.button === 0 ? [e.clientX, e.clientY] : null
    }
    const onUp = (e) => {
      if (!down || e.button !== 0) return
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1])
      down = null
      if (moved > 4) return
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const mesh = buildingsRef.current
      const hit = mesh ? raycaster.intersectObject(mesh, false)[0] : null
      const point = hit?.point ?? raycaster.ray.intersectPlane(ground, new THREE.Vector3())
      const building = hit ? buildingAt(mesh.userData.ranges, hit.faceIndex * 3) : null
      if (point) onPick([point.x, -point.z], building)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [camera, gl, buildingsRef, onPick])
  return null
}

// `live` is the council's current round: home, dest, and the designs on the table.
export default function CityScene({ footprints, edges, sizeM, removed, routes, live, result, onPick }) {
  const buildingsRef = useRef()
  const [w, h] = sizeM
  const chosen = useMemo(() => [live?.home, live?.dest].filter((i) => i != null), [live])
  // Which planner's design would demolish each building (the last one wins where they overlap).
  // Where the camera should look: the home alone, then home and destination together.
  const focus = useMemo(() => {
    const [a, b] = chosen.map((i) => footprints[i].bbox).map((bb) => [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2])
    if (!a) return null
    if (!b) return [a[0], a[1], 200]
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 120]
  }, [chosen, footprints])
  const origin = useMemo(() => (live?.home != null ? centreOf(footprints[live.home]) : null), [live?.home, footprints])
  const [waves, waveDone] = useWaves(removed, footprints, origin)
  const condemned = useMemo(() => {
    const m = new Map()
    for (const d of live?.designs ?? []) if (d) for (const i of d.option.removed) m.set(i, d.id)
    return m
  }, [live])
  return (
    <Canvas
      camera={{ position: [0, 2300, 2100], fov: 35, near: 10, far: 20000 }}
      dpr={[1, 2]}
      flat
      style={{ background: BACKGROUND }}
    >
      <hemisphereLight args={['#ffffff', '#d8d2c4', 1.6]} />
      <directionalLight position={[-800, 1500, 600]} intensity={1.6} />

      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[w + 400, h + 400]} />
        <meshBasicMaterial color={GROUND} />
      </mesh>

      {result &&
        result.areas
          .map((a, level) => <ReachArea key={`${result.start.id}-${level}`} polygons={a.polygons} color={REACH_COLORS[level]} level={level} />)
          .reverse()}

      {routes.map((r) => (
        <Ribbon key={r.round} line={r.line} width={r.width} color={ROUTE} y={1.0} />
      ))}
      {routes.map((r) => (
        <Monument key={r.round} route={r} />
      ))}
      {(live?.designs ?? []).map(
        (d, k) => d && <Ribbon key={d.id} line={d.option.line} width={d.option.width} color={groundTint(PLANNER_COLORS[d.id])} y={1.1 + 0.1 * k} />,
      )}

      <Streets edges={edges} />
      <Buildings footprints={footprints} removed={removed} waves={waves} levels={result?.levels} chosen={chosen} condemned={condemned} meshRef={buildingsRef} />
      {chosen.map((i) => (
        <Pin key={i} footprint={footprints[i]} />
      ))}
      {waves.map((wave) => (
        <DustWave key={wave.id} wave={wave} footprints={footprints} onDone={waveDone} />
      ))}

      {result && (
        <mesh position={[result.start.xy[0], 12, -result.start.xy[1]]}>
          <cylinderGeometry args={[5, 5, 24, 24]} />
          <meshLambertMaterial color="#222" />
        </mesh>
      )}

      <ClickPicker buildingsRef={buildingsRef} onPick={onPick} />
      <FollowRound focus={focus} />
      <OrbitControls makeDefault target={[0, 0, 0]} maxPolarAngle={1.45} minDistance={80} maxDistance={7000} />
    </Canvas>
  )
}
