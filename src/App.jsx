import { useCallback, useEffect, useMemo, useState } from 'react'
import CityScene from './CityScene.jsx'
import CouncilPanel, { CouncilControl } from './CouncilPanel.jsx'
import { prepareKit, findStart, computeReach, MINUTES, SPEED_M_PER_MIN, BAND_M, MAX_SNAP_M } from './reach.js'
import { estimateResidents, PLANNERS, WIDTHS_M, SPEED_KMH, OLD_TOWN_KMH } from './council.js'
import { useCouncil } from './useCouncil.js'
import { WALL, ROOF, GILT, REACH_COLORS, ROUTE, RUBBLE, MONUMENT, PLANNER_COLORS } from './palette.js'

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
  const [prep, setPrep] = useState(null) // the city as it is now, after the council's rounds
  const [residents, setResidents] = useState(null) // estimated residents per building
  const [error, setError] = useState(null)
  const [startId, setStartId] = useState(null)
  const [message, setMessage] = useState(null)
  const [cityKey, setCityKey] = useState(0) // a new key rebuilds the 3D city from scratch

  useEffect(() => {
    Promise.all(['kit.json', 'buildings.geojson', 'streets.graph.json', 'zensus.geojson'].map(loadJson))
      .then(([kit, buildings, graph, zensus]) => {
        const p = { ...prepareKit({ kit, buildings, graph, zensus }), removed: new Set() }
        setKit(kit)
        setBase(p)
        setPrep(p)
        setResidents(estimateResidents(p))
      })
      .catch((e) => setError(e.message))
  }, [])

  const council = useCouncil({ prep, setPrep, residents })

  // Back to the city as it was loaded: every building standing, no routes,
  // no monuments, and the council starting again from round 1.
  const { restart } = council
  const restartCity = useCallback(() => {
    restart()
    setPrep(base)
    setStartId(null)
    setMessage(null)
    setCityKey((k) => k + 1)
  }, [restart, base])

  // The walking reach follows the city as the council changes it.
  const result = useMemo(() => {
    if (!prep || startId == null || !prep.nodes.has(startId)) return null
    const reach = computeReach(prep, startId)
    // Each building takes the shade of the nearest area it touches.
    const levels = new Array(prep.footprints.length).fill(null)
    for (let level = reach.areas.length - 1; level >= 0; level--) {
      for (const i of reach.areas[level].buildings) levels[i] = level
    }
    return { ...reach, levels, start: prep.nodes.get(startId) }
  }, [prep, startId])

  const onPick = (xy) => {
    if (!prep) return
    const s = findStart(prep, xy)
    if (!s.ok) {
      setStartId(null)
      setMessage(
        `No walkable street within ${MAX_SNAP_M} m of this point (the nearest is ${fmt(Math.round(s.nearestStreet))} m away). Click closer to a street.`,
      )
      return
    }
    setStartId(s.node.id)
    setMessage(null)
  }

  return (
    <div className="app">
      {base && kit && (
        <CityScene
          key={cityKey}
          footprints={base.footprints}
          edges={prep.edges}
          sizeM={kit.size_m}
          removed={prep.removed}
          routes={council.routes}
          live={council.live}
          result={result}
          onPick={onPick}
        />
      )}

      <header className="title">Haussmann’s Renovation of Weimar</header>

      <CouncilControl council={council} onRestart={restartCity} />
      <CouncilPanel council={council} />

      <aside className="panel">
        <h1>Walking reach</h1>
        {error && <p className="error">The city kit didn't load ({error}).</p>}
        {!prep && !error && <p className="hint">Loading the city kit…</p>}
        {prep && !result && !message && (
          <p className="hint">Click anywhere on the ground to see how far you can walk from there, on the streets as the council leaves them.</p>
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

        {prep && (
          <>
            <h2 className="key">Map key</h2>
            <ul className="key-list">
              <li>
                <span className="swatch" style={{ background: WALL }} />
                limestone walls
              </li>
              <li>
                <span className="swatch" style={{ background: ROOF }} />
                zinc roofs
              </li>
              <li>
                <span className="swatch" style={{ background: GILT }} />
                the resident’s home and destination
              </li>
              {PLANNERS.map((p) => (
                <li key={p.id}>
                  <span className="swatch" style={{ background: PLANNER_COLORS[p.id] }} />
                  {p.name}’s design and what it would demolish
                </li>
              ))}
              <li>
                <span className="swatch" style={{ background: ROUTE }} />
                a route the council built
              </li>
              <li>
                <span className="swatch" style={{ background: MONUMENT }} />
                a triumphal arch or victory column in the middle of each route
              </li>
              <li>
                <span className="swatch" style={{ background: RUBBLE }} />
                demolished
              </li>
              {MINUTES.map((m, level) => (
                <li key={m}>
                  <span className="swatch" style={{ background: REACH_COLORS[level] }} />
                  within {m} minutes on foot
                </li>
              ))}
            </ul>
          </>
        )}

        <details className="method">
          <summary>How it works</summary>
          <p>
            Walking at 4.8 km/h ({SPEED_M_PER_MIN} m per minute) along the pedestrian network, starting from the street
            junction nearest to your click. Each area is the streets reached in that time, with a band of {BAND_M} m on
            each side. A building counts when it touches the area; demolished buildings don't.
          </p>
          <p>
            Residents come from the Zensus 2022 100 m grid: each cell adds its population times the share of the cell
            that lies inside the area, rounded to the nearest 10. Cells without a published figure are left out of the
            sum, not counted as zero; their number is shown next to it.
          </p>
          <p>
            The council: a random resident is offered up to eight non-residential buildings 300 to 1,200 m away, the
            worst detours by street first, and picks one. The app works out three kinds of route in {WIDTHS_M.join(', ')} m:
            a straight cut, the existing streets widened, and a two-leg route bent to spare the most buildings. Every
            building within half the width of the route is demolished, except the two ends. Trips are timed by car at{' '}
            {OLD_TOWN_KMH} km/h through the old streets and {WIDTHS_M.map((w) => `${SPEED_KMH[w]}`).join(' / ')} km/h on a new
            route of that width. Displaced residents share each census cell's population over its houses by volume. Each
            planner picks a width and pitches it; the people vote, or reject all three. A built route gets a monument in its
            middle: a triumphal arch from 20 m wide, a victory column on a narrower one. Claude (Haiku) speaks for every
            voice through <code>claude -p</code> on this laptop, choosing only from the options the app lists.
          </p>
        </details>
        <p className="hint small">Drag to orbit, right-drag to pan, scroll to zoom.</p>
      </aside>

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
