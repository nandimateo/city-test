import { useEffect, useState } from 'react'
import { PLANNERS, TRIP_M, aUse } from './council.js'
import { REST_S, THINKS_HERE } from './useCouncil.js'
import { PLANNER_COLORS } from './palette.js'

const fmt = (n) => Math.round(n).toLocaleString('en-GB')
const min = (m) => m.toFixed(1)
const LABEL = { p1: 'The Prefect', p2: 'The Engineer', p3: 'The Conservator', none: 'None of them' }
const THINKING = {
  resident: 'A resident is thinking…',
  planners: 'The planners are designing…',
  vote: 'The people are voting…',
}

function Thinking({ children }) {
  return (
    <p className="thinking">
      <span className="spinner" /> {children}
    </p>
  )
}

function Design({ planner, design, stage }) {
  return (
    <div className="design" style={{ borderColor: PLANNER_COLORS[planner.id] }}>
      <div className="who">
        <span className="swatch" style={{ background: PLANNER_COLORS[planner.id] }} />
        {planner.name}
        <span className="sub"> · {planner.idea}</span>
      </div>
      {design ? (
        <>
          <p className="design-title">“{design.title}”</p>
          <p className="numbers">
            {design.option.width} m wide · demolishes {fmt(design.option.removed.length)} ({fmt(design.option.homesLost)} homes,{' '}
            {fmt(design.option.publicLost)} public) · ≈ {fmt(design.option.displaced)} displaced · {min(design.option.oldMinutes)} →{' '}
            {min(design.option.newMinutes)} min
          </p>
          <p className="said">{design.pitch}</p>
        </>
      ) : (
        stage === 'planners' && <Thinking>designing…</Thinking>
      )}
    </div>
  )
}

function Round({ r, stage, current }) {
  const worst = r.candidates?.[0]
  return (
    <section className="round">
      <h2>Round {r.n}</h2>

      {r.candidates && (
        <p className="noticed">
          <b>Noticed:</b> {aUse(r.homeUse)} building, {fmt(r.homeHeight)} m tall, ≈ {fmt(r.homeResidents)} residents.{' '}
          {r.candidates.length} places {fmt(TRIP_M[0])}–{fmt(TRIP_M[1])} m away; worst detour {worst.detour.toFixed(1)}× ({aUse(worst.use)} building, {fmt(worst.straight)} m straight, {fmt(worst.street)} m by street).
        </p>
      )}

      {r.resident ? (
        <div className="voice">
          <div className="who">
            <span className="swatch gilt" />
            {r.resident.name}, {r.resident.age} → {aUse(r.dest.use)} building
            <span className="sub">
              {' '}
              ({fmt(r.dest.straight)} m straight, {fmt(r.dest.street)} m by street)
            </span>
          </div>
          <p className="said">“{r.resident.complaint}”</p>
        </div>
      ) : (
        current && stage === 'resident' && <Thinking>A resident is looking for a shorter way…</Thinking>
      )}

      {(r.designs || (current && stage === 'planners')) &&
        PLANNERS.map((p, k) => <Design key={p.id} planner={p} design={r.designs?.[k]} stage={current ? stage : null} />)}

      {r.vote ? (
        <div className="vote">
          <b>The vote</b>
          {['p1', 'p2', 'p3', 'none'].map((k) => (
            <div key={k} className={k === r.vote.winner ? 'bar won' : 'bar'}>
              <span className="label">{LABEL[k]}</span>
              <span className="track">
                <span className="fill" style={{ width: `${r.vote.shares[k]}%`, background: PLANNER_COLORS[k] ?? '#8a8378' }} />
              </span>
              <span className="pct">{r.vote.shares[k]} %</span>
            </div>
          ))}
          <p className="said">{r.vote.reason}</p>
        </div>
      ) : (
        current && stage === 'vote' && <Thinking>The people of Weimar are voting…</Thinking>
      )}

      {r.summary &&
        (r.summary.winner === 'none' ? (
          <p className="outcome">Rejected. Nothing was demolished.</p>
        ) : (
          <p className="outcome">
            Built {r.summary.winnerName}’s design: {fmt(r.summary.removed)} buildings demolished, ≈ {fmt(r.summary.displaced)} residents
            displaced. {r.summary.monument[0].toUpperCase() + r.summary.monument.slice(1)} rises in its middle.
          </p>
        ))}
      {r.stopped && <p className="outcome">Paused before the round ended.</p>}
      {r.error && <p className="error">The council stopped: {r.error}</p>}
    </section>
  )
}

export default function CouncilPanel({ council }) {
  if (!THINKS_HERE) {
    return (
      <aside className="council">
        <h1>The Renovation Council</h1>
        <p className="note">
          The council only thinks on localhost. Run the app on your own laptop with <code>npm run dev</code> to watch a resident ask
          for a route, three planners design it, the people vote, and the buildings in its way come down.
        </p>
      </aside>
    )
  }
  const { rounds, stage } = council
  const done = rounds.filter((r) => r.summary)
  const demolished = done.reduce((s, r) => s + r.summary.removed, 0)
  const displaced = done.reduce((s, r) => s + r.summary.displaced, 0)
  return (
    <aside className="council">
      <h1>The Renovation Council</h1>
      <p className="hint">
        {done.length
          ? `${done.length} ${done.length === 1 ? 'round' : 'rounds'} decided: ${fmt(demolished)} buildings demolished, ≈ ${fmt(displaced)} residents displaced.`
          : 'Every round, a resident asks for a shorter route, three planners design it, and the people vote. The winner is built.'}
      </p>
      {[...rounds].reverse().map((r) => (
        <Round key={r.n} r={r} stage={stage} current={r.n === rounds.length} />
      ))}
    </aside>
  )
}

// Bottom centre: what the council is doing now, and Pause / Resume.
export function CouncilControl({ council, onRestart }) {
  const { running, toggle, stage, nextAt } = council
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!nextAt) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [nextAt])
  if (!THINKS_HERE) return null
  let status = 'Paused.'
  if (stage) status = THINKING[stage]
  else if (running && nextAt) status = `Next round in ${Math.max(0, Math.ceil((nextAt - now) / 1000))} s.`
  else if (running) status = 'Starting…'
  return (
    <div className="council-control">
      <p className="instruction">{status}</p>
      <div className="buttons">
        <button type="button" className={running ? 'council-button' : 'council-button active'} onClick={toggle}>
          {running ? 'Pause the Council' : 'Resume the Council'}
        </button>
        <button type="button" className="council-button active" onClick={onRestart}>
          Restart the City
        </button>
      </div>
      {running && <p className="hint">A new round starts {REST_S} s after the last one ends. Pause stops it after the current step.</p>}
    </div>
  )
}
