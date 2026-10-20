import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WALL, ROOF, GILT, REACH_COLORS, GROUND, BACKGROUND, STREET, BOULEVARD, KERB, ARCH_STONE } from './palette.js'
import { AXIS_WIDTH_M, PLACE_RADIUS_M, ANIMATION_S } from './axis.js'

// Local metres (x east, y north) become three.js (x, height, -y).

function shapeFromRings(rings) {
  const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

// All buildings in one mesh, with a colour per vertex, so the view stays smooth.
// `ranges[i]` is building i's first vertex and vertex count; `roof` marks the
// vertices of the upward-facing tops; `basePositions` keeps where every
// vertex started, so buildings can slide from there.
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

function Buildings({ footprints, offsets, levels, selected, meshRef }) {
  const { geometry, ranges, roof, basePositions } = useBuildingGeometry(footprints)

  // Walls in limestone, roofs in zinc. Reached buildings take the reach shade
  // on their walls and a touch of it on their roofs; chosen buildings are gilt.
  useEffect(() => {
    const colors = geometry.attributes.color.array
    const wall = new THREE.Color(WALL)
    const zinc = new THREE.Color(ROOF)
    const gilt = new THREE.Color(GILT)
    const reachWalls = REACH_COLORS.map((c) => new THREE.Color(c))
    const reachRoofs = reachWalls.map((c) => zinc.clone().lerp(c, 0.45))
    const chosen = new Set(selected)
    footprints.forEach((f, i) => {
      const level = levels?.[i]
      let w = level != null ? reachWalls[level] : wall
      let r = level != null ? reachRoofs[level] : zinc
      if (chosen.has(i)) w = r = gilt
      const [s, n] = ranges[i]
      for (let v = s; v < s + n; v++) {
        const c = roof[v] ? r : w
        colors[v * 3] = c.r
        colors[v * 3 + 1] = c.g
        colors[v * 3 + 2] = c.b
      }
    })
    geometry.attributes.color.needsUpdate = true
  }, [geometry, ranges, roof, footprints, levels, selected])

  // Slide the buildings that moved from where they are drawn now to their
  // new offsets, easing in and out over ANIMATION_S.
  const shown = useRef(null)
  const slide = useRef(null)
  useEffect(() => {
    if (!shown.current || shown.current.length !== 2 * footprints.length) {
      shown.current = new Float64Array(2 * footprints.length)
    }
    if (!offsets) return
    const from = shown.current.slice()
    const changed = []
    for (let i = 0; i < footprints.length; i++) {
      if (from[2 * i] !== offsets[2 * i] || from[2 * i + 1] !== offsets[2 * i + 1]) changed.push(i)
    }
    slide.current = changed.length ? { from, to: offsets, changed, t0: null } : null
  }, [offsets, footprints])

  useFrame(({ clock }) => {
    const a = slide.current
    if (!a) return
    const now = clock.elapsedTime
    if (a.t0 == null) a.t0 = now
    const t = Math.min(1, (now - a.t0) / ANIMATION_S)
    const e = t * t * (3 - 2 * t)
    const pos = geometry.attributes.position.array
    for (const i of a.changed) {
      const dx = a.from[2 * i] + (a.to[2 * i] - a.from[2 * i]) * e
      const dy = a.from[2 * i + 1] + (a.to[2 * i + 1] - a.from[2 * i + 1]) * e
      shown.current[2 * i] = dx
      shown.current[2 * i + 1] = dy
      const [s, n] = ranges[i]
      for (let v = s; v < s + n; v++) {
        pos[v * 3] = basePositions[v * 3] + dx
        pos[v * 3 + 2] = basePositions[v * 3 + 2] - dy
      }
    }
    geometry.attributes.position.needsUpdate = true
    if (t === 1) {
      slide.current = null
      geometry.computeBoundingSphere() // keeps clicking on the moved buildings accurate
    }
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
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={STREET} />
    </lineSegments>
  )
}

// The boulevard: a sandy band AXIS_WIDTH_M wide with dark kerbs, laid over the
// street lines, so side streets visibly stop at its edge. In its middle a round
// place of PLACE_RADIUS_M, whose kerb opens where the boulevard runs through.
function Boulevard({ axis }) {
  const { band, kerbs } = useMemo(() => {
    const h = AXIS_WIDTH_M / 2
    const R = PLACE_RADIUS_M
    const [u0, u1] = axis.u
    const [n0, n1] = axis.n
    // A point t metres along the axis and s metres across it, in three.js.
    const at = (t, s, y) => [axis.a[0] + u0 * t + n0 * s, y, -(axis.a[1] + u1 * t + n1 * s)]
    const L = axis.length

    const band = new THREE.BufferGeometry()
    const [a1, b1, b2, a2] = [at(0, h, 2), at(L, h, 2), at(L, -h, 2), at(0, -h, 2)]
    band.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a1, ...a2, ...b1, ...b1, ...a2, ...b2]), 3))

    // Kerbs along both sides, broken where they enter the place.
    const kerb = []
    const gap = Math.sqrt(Math.max(0, R * R - h * h))
    for (const s of [h, -h]) {
      for (const [t0, t1] of [
        [0, L / 2 - gap],
        [L / 2 + gap, L],
      ]) {
        if (t1 > t0) kerb.push(...at(t0, s, 2.2), ...at(t1, s, 2.2))
      }
    }
    // The kerb round the place, left open across the boulevard.
    const steps = 96
    const ring = (k) => {
      const f = (k / steps) * 2 * Math.PI
      return { open: Math.abs(R * Math.sin(f)) < h, p: at(L / 2 + R * Math.cos(f), R * Math.sin(f), 2.2) }
    }
    for (let k = 0; k < steps; k++) {
      const p = ring(k)
      const q = ring(k + 1)
      if (!p.open && !q.open) kerb.push(...p.p, ...q.p)
    }
    const kerbs = new THREE.BufferGeometry()
    kerbs.setAttribute('position', new THREE.BufferAttribute(new Float32Array(kerb), 3))
    return { band, kerbs }
  }, [axis])
  useEffect(
    () => () => {
      band.dispose()
      kerbs.dispose()
    },
    [band, kerbs],
  )
  return (
    <>
      <mesh geometry={band}>
        <meshBasicMaterial color={BOULEVARD} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[axis.mid[0], 2, -axis.mid[1]]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[PLACE_RADIUS_M, 96]} />
        <meshBasicMaterial color={BOULEVARD} />
      </mesh>
      <lineSegments geometry={kerbs}>
        <lineBasicMaterial color={KERB} />
      </lineSegments>
      <TriumphalArch axis={axis} />
    </>
  )
}

// An abstract Arc de Triomphe in the middle of the place: two piers and an
// attic across them, turned so the boulevard runs straight through the arch.
// In the arch's own frame, x runs along the boulevard and z across it.
const ARCH = { width: 24, depth: 12, height: 26, opening: 9, openingHeight: 16 }

function TriumphalArch({ axis }) {
  const { width, depth, height, opening, openingHeight } = ARCH
  const pier = (width - opening) / 2
  const turn = Math.atan2(axis.u[1], axis.u[0])
  return (
    <group position={[axis.mid[0], 2, -axis.mid[1]]} rotation-y={turn}>
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, openingHeight / 2, s * (opening / 2 + pier / 2)]}>
          <boxGeometry args={[depth, openingHeight, pier]} />
          <meshLambertMaterial color={ARCH_STONE} />
        </mesh>
      ))}
      <mesh position={[0, openingHeight + (height - openingHeight) / 2, 0]}>
        <boxGeometry args={[depth, height - openingHeight, width]} />
        <meshLambertMaterial color={ARCH_STONE} />
      </mesh>
      <mesh position={[0, openingHeight + 0.6, 0]}>
        <boxGeometry args={[depth + 1, 1.2, width + 1]} />
        <meshLambertMaterial color={ARCH_STONE} />
      </mesh>
    </group>
  )
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

export default function CityScene({ footprints, edges, sizeM, offsets, axis, selected, result, start, onPick }) {
  const buildingsRef = useRef()
  const [w, h] = sizeM
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
          .map((a, level) => <ReachArea key={`${start.id}-${level}`} polygons={a.polygons} color={REACH_COLORS[level]} level={level} />)
          .reverse()}

      <Streets edges={edges} />
      {axis && <Boulevard axis={axis} />}
      <Buildings footprints={footprints} offsets={offsets} levels={result?.levels} selected={selected} meshRef={buildingsRef} />

      {start && (
        <mesh position={[start.xy[0], 12, -start.xy[1]]}>
          <cylinderGeometry args={[5, 5, 24, 24]} />
          <meshLambertMaterial color="#222" />
        </mesh>
      )}

      <ClickPicker buildingsRef={buildingsRef} onPick={onPick} />
      <OrbitControls makeDefault target={[0, 0, 0]} maxPolarAngle={1.45} minDistance={80} maxDistance={7000} />
    </Canvas>
  )
}
