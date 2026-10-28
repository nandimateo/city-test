import { useCallback, useEffect, useRef, useState } from 'react'
import { PLANNERS, pickResident, findDestinations, designOptions, applyDesign, monumentFor } from './council.js'

// The council's loop: resident, three planners, the vote, the demolition,
// then a rest, and again. It runs by itself until paused.

export const REST_S = 10 // between the end of one round and the start of the next
const FIRST_S = 3 // after the page has loaded, after Resume, or after a restart
const LOOK_S = 2 // the planners' three designs stay on the map alone this long before the vote

// The endpoint exists only in the dev server on this laptop (server/council.js).
export const THINKS_HERE = import.meta.env.DEV

async function ask(role, context) {
  const r = await fetch(`${import.meta.env.BASE_URL}api/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, context }),
  })
  const reply = await r.json().catch(() => ({ ok: false, error: `the endpoint answered ${r.status}` }))
  if (!reply.ok) throw new Error(reply.error)
  return reply.output
}

const wait = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000))

// What the voices are told about a design: numbers only.
const facts = (o) => ({
  width: o.width,
  length: o.length,
  removed: o.removed.length,
  homesLost: o.homesLost,
  publicLost: o.publicLost,
  displaced: o.displaced,
  oldMinutes: o.oldMinutes,
  newMinutes: o.newMinutes,
})

// Vote shares that add up to 100.
function normalise(shares) {
  const keys = ['p1', 'p2', 'p3', 'none']
  const total = keys.reduce((s, k) => s + Math.max(0, shares[k] ?? 0), 0) || 1
  return Object.fromEntries(keys.map((k) => [k, Math.round((100 * Math.max(0, shares[k] ?? 0)) / total)]))
}

export function useCouncil({ prep, setPrep, residents }) {
  const [running, setRunning] = useState(THINKS_HERE)
  const [rounds, setRounds] = useState([]) // oldest first
  const [stage, setStage] = useState(null) // 'resident', 'planners', 'vote' or null
  const [nextAt, setNextAt] = useState(null) // when the next round starts, in ms
  const [live, setLive] = useState(null) // what the map shows: home, dest, designs, winner
  const [routes, setRoutes] = useState([]) // routes built so far, each with its monument

  const prepRef = useRef(prep)
  const runningRef = useRef(running)
  const roundsRef = useRef([])
  const busy = useRef(false)
  const generation = useRef(0) // goes up on every restart; a round from an older city changes nothing
  useEffect(() => {
    prepRef.current = prep
  }, [prep])
  useEffect(() => {
    runningRef.current = running
  }, [running])

  const update = useCallback((n, patch) => {
    roundsRef.current = roundsRef.current.map((r) => (r.n === n ? { ...r, ...patch } : r))
    setRounds(roundsRef.current)
  }, [])

  const runRound = useCallback(async () => {
    if (busy.current || !prepRef.current || !residents) return
    busy.current = true
    const gen = generation.current
    const stale = () => generation.current !== gen
    setNextAt(null)
    const n = roundsRef.current.length + 1
    roundsRef.current = [...roundsRef.current, { n, started: Date.now() }]
    setRounds(roundsRef.current)
    const history = roundsRef.current.filter((r) => r.summary).map((r) => r.summary)
    const city = prepRef.current
    const note = (patch) => {
      if (!stale()) update(n, patch)
    }
    // After every answer: give up if the city was restarted, or note the pause.
    const halt = () => {
      if (stale()) return true
      if (runningRef.current) return false
      update(n, { stopped: true })
      return true
    }

    try {
      // 1. A resident notices a detour and asks for a route.
      setStage('resident')
      let home
      let candidates = []
      for (let k = 0; k < 10 && !candidates.length; k++) {
        home = pickResident(city, residents)
        candidates = findDestinations(city, home)
      }
      if (!candidates.length) throw new Error('No resident found a destination worth a new route.')
      const f = city.footprints[home]
      note({ home, homeUse: f.use, homeHeight: f.height, homeResidents: residents[home], candidates })
      setLive({ home })
      const said = await ask('resident', {
        home: { use: f.use, height: f.height, residents: residents[home] },
        candidates: candidates.map(({ id, use, height, straight, street, detour, oldMinutes }) => ({ id, use, height, straight, street, detour, oldMinutes })),
        history,
      })
      if (stale()) return
      const dest = candidates.find((c) => String(c.id) === said.destination)
      const resident = { name: said.name, age: said.age, complaint: said.complaint, homeUse: f.use, destUse: dest.use }
      note({ resident, dest })
      setLive({ home, dest: dest.index })
      if (halt()) return

      // 2. Three planners each design the route, all at once.
      setStage('planners')
      const options = designOptions(city, residents, home, dest)
      const designs = []
      await Promise.all(
        PLANNERS.map(async (p, k) => {
          const pick = await ask('planner', { planner: p.id, idea: p.idea, resident, options: options[p.style].map(facts), history })
          if (stale()) return
          const option = options[p.style].find((o) => o.width === pick.width) ?? options[p.style][0]
          designs[k] = { ...p, title: pick.title, pitch: pick.pitch, option }
          note({ designs: [...designs] })
          setLive((l) => ({ ...l, designs: [...designs] }))
        }),
      )
      await wait(LOOK_S)
      if (halt()) return

      // 3. The people vote.
      setStage('vote')
      const done = roundsRef.current.filter((r) => r.summary)
      const totals = {
        demolished: done.reduce((s, r) => s + r.summary.removed, 0),
        displaced: done.reduce((s, r) => s + r.summary.displaced, 0),
      }
      const vote = await ask('population', {
        resident,
        designs: designs.map((d) => ({ planner: d.id, name: d.name, title: d.title, pitch: d.pitch, ...facts(d.option) })),
        totals,
        history,
      })
      if (stale()) return
      const shares = normalise(vote.shares)
      note({ vote: { ...vote, shares } })

      // 4. The winner is built: its buildings come down, the route goes in,
      // and a monument rises in its middle.
      const winner = designs.find((d) => d.id === vote.winner)
      setLive({ home, dest: dest.index, designs: winner ? [winner] : [], winner: vote.winner })
      if (winner) {
        const next = applyDesign(city, winner.option, dest, n)
        prepRef.current = next
        setPrep(next)
        setRoutes((r) => [...r, { round: n, planner: winner.id, style: winner.option.style, width: winner.option.width, line: winner.option.line }])
      }
      note({
        summary: {
          round: n,
          resident: resident.name,
          use: dest.use,
          winner: vote.winner,
          winnerName: winner?.name,
          share: shares[vote.winner],
          removed: winner ? winner.option.removed.length : 0,
          displaced: winner ? winner.option.displaced : 0,
          monument: winner ? monumentFor(winner.option.width) : null,
        },
      })
    } catch (e) {
      if (stale()) return
      update(n, { error: e.message })
      setRunning(false)
    } finally {
      if (!stale()) {
        busy.current = false
        setStage(null)
        if (runningRef.current) setNextAt(Date.now() + REST_S * 1000)
      }
    }
  }, [residents, setPrep, update])

  // Start a round when it is due; a new due time when (re)started.
  const ready = Boolean(prep && residents)
  useEffect(() => {
    if (!THINKS_HERE || !running || !ready || busy.current) return
    if (nextAt == null) {
      setNextAt(Date.now() + FIRST_S * 1000)
      return
    }
    const t = setTimeout(runRound, Math.max(0, nextAt - Date.now()))
    return () => clearTimeout(t)
  }, [running, ready, nextAt, runRound])

  const toggle = useCallback(() => {
    setRunning((r) => !r)
    setNextAt(null)
  }, [])

  // Forget every round. The city itself is reset by the app (see App.jsx);
  // a round still thinking belongs to the old city and is dropped.
  const restart = useCallback(() => {
    generation.current++
    busy.current = false
    roundsRef.current = []
    setRounds([])
    setLive(null)
    setRoutes([])
    setStage(null)
    // Set the next start directly: the old round may already have cleared it,
    // and then nothing else would notice the restart.
    setNextAt(runningRef.current ? Date.now() + FIRST_S * 1000 : null)
  }, [])

  return { running, toggle, restart, rounds, stage, nextAt, live, routes }
}
