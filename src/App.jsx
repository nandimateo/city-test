import { useCallback, useEffect, useState } from 'react'
import CityScene from './CityScene.jsx'
import {
  prepareKit,
  findStart,
  computeReach,
  linkNetwork,
  moveFootprints,
  MINUTES,
  SPEED_M_PER_MIN,
  BAND_M,
  MAX_SNAP_M,
} from './reach.js'
import { makeAxis, planAxis, cutStreets, AXIS_WIDTH_M, CORRIDOR_MARGIN_M, PLACE_RADIUS_M, MIN_SPACING_M } from './axis.js'
import { WALL, ROOF, GILT, REACH_COLORS, BOULEVARD } from './palette.js'

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const fmt = (n) => n.toLocaleString('en-GB')

async function loadJson(name) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!r.ok) throw new Error(`data/${name}: ${r.status}`)
  return r.json()
}

export default function App() {
  const [kit, setKit] = useState(null)
  const [base, setBase] = useState(null) // the city as loaded; the 3D buildings are built from it
  const [prep, setPrep] = useState(null) // the city as it is now, after the axis
  const [error, setError] = useState(null)
  const [start, setStart] = useState(null)
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState(null)

  const [offsets, setOffsets] = useState(null) // how far each building has moved: dx, dy
  const [axis, setAxis] = useState(null)
  const [axisStep, setAxisStep] = useState(null) // null, 'first' or 'second'
  const [selected, setSelected] = useState([])
  const [axisNote, setAxisNote] = useState(null)

  useEffect(() => {
    Promise.all(['kit.json', 'buildings.geojson', 'streets.graph.json', 'zensus.geojson'].map(loadJson))
      .then(([kit, buildings, graph, zensus]) => {
        const p = prepareKit({ kit, buildings, graph, zensus })
        setKit(kit)
        setBase(p)
        setPrep(p)
        setOffsets(new Float64Array(2 * p.footprints.length))
      })
      .catch((e) => setError(e.message))
  }, [])

  const cancelAxis = useCallback(() => {
    setAxisStep(null)
    setSelected([])
    setAxisNote(null)
  }, [])

  const toggleAxis = () => {
    if (axisStep) return cancelAxis()
    setAxisStep('first')
    setSelected([])
    setAxisNote(null)
  }

  // Esc leaves the selection at any step.
  useEffect(() => {
    if (!axisStep) return
    const onKey = (e) => {
      if (e.key === 'Escape') cancelAxis()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [axisStep, cancelAxis])

  // Cut the boulevard from the centre of building i to the centre of building j.
  // A new axis replaces the last one: the city starts again from how it was loaded.
  const createAxis = (i, j) => {
    const boxes = base.footprints.map((f) => f.bbox)
    const centre = (k) => [(boxes[k][0] + boxes[k][2]) / 2, (boxes[k][1] + boxes[k][3]) / 2]
    const a = centre(i)
    const b = centre(j)
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) {
      setSelected([i])
      setAxisStep('second')
      setAxisNote('These two buildings share a centre. Select another second building.')
      return
    }
    const next = makeAxis(a, b, [i, j])
    const plan = planAxis({ original: boxes, axis: next })
    const net = cutStreets(base.nodes, base.edges, next, 'axis')
    const walkableNodes = linkNetwork(net.nodes, net.edges)
    setPrep({ ...base, nodes: net.nodes, edges: net.edges, walkableNodes, footprints: moveFootprints(base.footprints, plan.offsets) })
    setOffsets(plan.offsets)
    setAxis(next)
    setAxisStep(null)
    setStart(null)
    setResult(null)
    setMessage(null)
    const problems = plan.inCorridor + plan.tooClose
    setAxisNote(
      `Boulevard of ${fmt(Math.round(next.length))} m cut. ${fmt(plan.moved)} buildings moved aside.` +
        (problems
          ? ` ${fmt(plan.tooClose)} pairs are still too close and ${fmt(plan.inCorridor)} buildings still stand in the corridor; the pushing stopped after ${fmt(plan.iterations)} rounds.`
          : ''),
    )
  }

  const onPick = (xy, building) => {
    if (!prep) return

    if (axisStep) {
      if (building == null) {
        setAxisNote('That was the ground. Click on a building.')
        return
      }
      if (axisStep === 'first') {
        setSelected([building])
        setAxisStep('second')
        setAxisNote(null)
        return
      }
      if (building === selected[0]) {
        setAxisNote('That is the first building again. Select a different one.')
        return
      }
      setSelected([selected[0], building])
      createAxis(selected[0], building)
      return
    }

    setSelected([])
    setAxisNote(null)
    const s = findStart(prep, xy)
    if (!s.ok) {
      setStart(null)
      setResult(null)
      setMessage(
        `No walkable street within ${MAX_SNAP_M} m of this point (the nearest is ${fmt(Math.round(s.nearestStreet))} m away). Click closer to a street.`,
      )
      return
    }
    const reach = computeReach(prep, s.node.id)
    // Each building takes the shade of the nearest area it touches.
    const levels = new Array(prep.footprints.length).fill(null)
    for (let level = reach.areas.length - 1; level >= 0; level--) {
      for (const i of reach.areas[level].buildings) levels[i] = level
    }
    setStart(s.node)
    setResult({ ...reach, levels })
    setMessage(null)
  }

  const instruction = { first: 'Select the first building.', second: 'Select the second building.' }[axisStep]

  return (
    <div className="app">
      {base && kit && (
        <CityScene
          footprints={base.footprints}
          edges={prep.edges}
          sizeM={kit.size_m}
          offsets={offsets}
          axis={axis}
          selected={selected}
          result={result}
          start={start}
          onPick={onPick}
        />
      )}

      <header className="title">Haussmann’s Renovation of Weimar</header>

      <div className="axis-control">
        {instruction && <p className="instruction">{instruction}</p>}
        {axisNote && <p className="note">{axisNote}</p>}
        <button type="button" className={axisStep ? 'axis-button active' : 'axis-button'} onClick={toggleAxis} disabled={!prep}>
          {axisStep ? 'Cancel' : 'Create an Axis'}
        </button>
        {axisStep && <p className="hint">Press Esc or the button to cancel.</p>}
      </div>

      <aside className="panel">
        <h1>Walking reach</h1>
        {error && <p className="error">The city kit didn't load ({error}).</p>}
        {!prep && !error && <p className="hint">Loading the city kit…</p>}
        {prep && !result && !message && (
          <p className="hint">Click anywhere on the ground to see how far you can walk from there.</p>
        )}
        {message && <p className="error">{message}</p>}

        {result && (
          <table>
            <thead>
              <tr>
                <th />
                <th>Walk</th>
                <th className="num">Buildings</th>
                <th className="num">Residents</th>
              </tr>
            </thead>
            <tbody>
              {result.areas.map((a, level) => (
                <tr key={a.minutes}>
                  <td>
                    <span className="swatch" style={{ background: REACH_COLORS[level] }} />
                  </td>
                  <td>
                    {a.minutes} min
                    <span className="sub">{fmt(a.budget)} m</span>
                  </td>
                  <td className="num">{fmt(a.buildings.size)}</td>
                  <td className="num">
                    ≈ {fmt(a.residents)}
                    {a.cellsWithoutFigure > 0 && (
                      <span className="sub">
                        + {a.cellsWithoutFigure} {a.cellsWithoutFigure === 1 ? 'cell' : 'cells'} without a figure
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <details className="method">
          <summary>How it works</summary>
          <p>
            Walking at 4.8 km/h ({SPEED_M_PER_MIN} m per minute) along the pedestrian network, starting from the street
            junction nearest to your click. Each area is the streets reached in that time, with a band of {BAND_M} m on
            each side. A building counts when it touches the area.
          </p>
          <p>
            Residents come from the Zensus 2022 100 m grid: each cell adds its population times the share of the cell
            that lies inside the area, rounded to the nearest 10. Cells without a published figure are left out of the
            sum, not counted as zero; their number is shown next to it.
          </p>
          <p>
            A boulevard is {AXIS_WIDTH_M} m wide, with a round place of {PLACE_RADIUS_M} m radius and a triumphal arch
            in its middle, and {CORRIDOR_MARGIN_M} m kept clear around both. Buildings in the way move straight out
            from the boulevard, never turning, and push their neighbours outward until every pair is at least{' '}
            {MIN_SPACING_M} m apart, or as close as it already was. Streets that cross it end at it, and you can walk
            along it. A new axis replaces the last one.
          </p>
        </details>
        <p className="hint small">Drag to orbit, right-drag to pan, scroll to zoom.</p>
      </aside>

      {prep && (
        <aside className="legend">
          <h2>The city</h2>
          <ul>
            <li>
              <span className="swatch" style={{ background: WALL }} />
              limestone walls
            </li>
            <li>
              <span className="swatch" style={{ background: ROOF }} />
              zinc roofs
            </li>
            <li>
              <span className="swatch" style={{ background: BOULEVARD }} />
              boulevard
            </li>
            <li>
              <span className="swatch" style={{ background: GILT }} />
              chosen buildings
            </li>
          </ul>
          <h2>Reached on foot</h2>
          <ul>
            {MINUTES.map((m, level) => (
              <li key={m}>
                <span className="swatch" style={{ background: REACH_COLORS[level] }} />
                within {m} minutes
              </li>
            ))}
          </ul>
        </aside>
      )}

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
