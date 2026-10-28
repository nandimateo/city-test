// The Renovation Council's voices: a small endpoint in the Vite dev server.
// The page posts { role, context } to /api/council; this file turns it into a
// prompt, asks Claude through `claude -p` on this laptop, and sends back the
// structured answer. It only exists under `npm run dev`, never on the live page.
//
// Claude gets no tools and none of the project's settings (--tools "",
// --safe-mode), and may only answer with one of the choices the schema lists,
// which are built from the ids the app sent.

import { spawn } from 'node:child_process'
import os from 'node:os'

const TIMEOUT_MS = 60_000
const MAX_BODY = 50_000

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n)
const num = (x, digits = 0) => Number(Number(x).toFixed(digits))
const ENGLISH = 'Answer in English. Keep every sentence short and concrete.'

// A use as it reads in a sentence: "an office", "a food and drink".
const aUse = (use) => {
  const words = clip(use, 30).replace(/_/g, ' ')
  return `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`
}

// What earlier rounds did, in a few lines.
function history(rounds) {
  if (!Array.isArray(rounds) || !rounds.length) return 'This is the first round; nothing has been demolished yet.'
  return [
    'Earlier rounds, most recent last:',
    ...rounds.slice(-4).map(
      (r) =>
        `- Round ${num(r.round)}: ${clip(r.resident, 60)} wanted a route to ${aUse(r.use)} building. ` +
        (r.winner === 'none'
          ? 'The population rejected all designs.'
          : `${clip(r.winnerName, 40)}'s design won with ${num(r.share)} %: ${num(r.removed)} buildings demolished, about ${num(r.displaced)} residents displaced.`),
    ),
  ].join('\n')
}

function designLine(o) {
  return (
    `${num(o.width)} m wide, ${num(o.length)} m long: demolishes ${num(o.removed)} buildings ` +
    `(${num(o.homesLost)} homes, ${num(o.publicLost)} public buildings), displaces about ${num(o.displaced)} residents; ` +
    `the trip goes from ${num(o.oldMinutes, 1)} to ${num(o.newMinutes, 1)} min by car`
  )
}

const PLANNER_PROMPTS = {
  p1:
    'You are the Prefect, an urban planner who admires Baron Haussmann. Grand, straight, wide cuts bring light, air, order and fast traffic, ' +
    'and you believe the price in demolished buildings is worth paying for a modern city. You only design straight routes from door to door. ' +
    'You go for the widest cut unless it costs far more for almost no gain; a city is not made with lanes. ' +
    'You speak like a 19th-century prefect: grand, certain, a little contemptuous of crooked medieval lanes.',
  p2:
    'You are the Engineer, a pragmatic traffic engineer. You trust the streets people already use and widen them rather than cutting new ones. ' +
    'You judge a design by minutes saved and by capacity: traffic grows, so you rather build a width too wide than one too narrow, ' +
    'and you accept losing buildings when the time saved is real. ' +
    'You speak dryly, like an engineer at a public hearing: capacity, ratios, no poetry.',
  p3:
    'You are the Conservator, a planner who loves the old town. Your route bends around the densest homes and the public buildings, ' +
    'to demolish as little as possible. You pick the narrowest width that still makes the trip clearly faster. ' +
    'You speak warmly about neighbours, courtyards and the character of the old town, and you name what your design spares.',
}

const ROLES = {
  resident: {
    system:
      "You are one resident of Weimar's old town. The city lets residents ask for a direct new route through the city, " +
      'and the buildings in its way may be demolished. You are tired of the detours the old street pattern forces on you. ' +
      'From the list you are given, choose the ONE destination you most want a direct route to: a place you need in daily life, where the detour hurts most. ' +
      'Invent a plausible German name and an age that fit your home. Write your complaint in the first person, one or two sentences, ' +
      'about what you go there for and what the detour costs you. Never mention building ids; call the place by what it is. ' + ENGLISH,
    build(c) {
      const ids = c.candidates.map((d) => String(d.id))
      const prompt = [
        `Your home: ${aUse(c.home.use)} building, ${num(c.home.height)} m tall, with about ${num(c.home.residents)} residents.`,
        'Destinations you could ask for, by building id:',
        ...c.candidates.map(
          (d) =>
            `- ${clip(d.id, 20)}: ${aUse(d.use)} building, ${num(d.straight)} m away in a straight line but ${num(d.street)} m by street ` +
            `(${num(d.detour, 2)} times the distance), ${num(d.oldMinutes, 1)} min by car today.`,
        ),
        history(c.history),
      ].join('\n')
      const schema = {
        type: 'object',
        properties: {
          destination: { type: 'string', enum: ids },
          name: { type: 'string', maxLength: 40 },
          age: { type: 'integer', minimum: 18, maximum: 99 },
          complaint: { type: 'string', maxLength: 300 },
        },
        required: ['destination', 'name', 'age', 'complaint'],
        additionalProperties: false,
      }
      return { prompt, schema }
    },
  },

  planner: {
    systemFor: (c) =>
      `${PLANNER_PROMPTS[c.planner]} The city is Weimar. A resident has asked for a new route; design it. ` +
      'Choose exactly one width from your options and give the design a short, memorable title. ' +
      'Your numbers are printed next to your pitch, so do not list them: pitch it to the citizens in your own voice, ' +
      'in one or two sentences, saying why this route and this width are right, with at most one number. ' +
      ENGLISH,
    build(c) {
      if (!PLANNER_PROMPTS[c.planner]) throw new Error('unknown planner')
      const widths = c.options.map((o) => num(o.width))
      const prompt = [
        `${clip(c.resident.name, 40)}, ${num(c.resident.age)}, lives in ${aUse(c.resident.homeUse)} building and wants a route to ${aUse(c.resident.destUse)} building.`,
        `Their complaint: "${clip(c.resident.complaint, 300)}"`,
        `Your route is ${clip(c.idea, 80)}. Your options:`,
        ...c.options.map((o) => `- ${designLine(o)}.`),
        history(c.history),
      ].join('\n')
      const schema = {
        type: 'object',
        properties: {
          width: { type: 'integer', enum: widths },
          title: { type: 'string', maxLength: 60 },
          pitch: { type: 'string', maxLength: 300 },
        },
        required: ['width', 'title', 'pitch'],
        additionalProperties: false,
      }
      return { prompt, schema }
    },
  },

  population: {
    system:
      'You are the people of Weimar, voting together in a referendum on a new route through the city. ' +
      'You are fed up with the crooked old streets, the detours and the traffic, and you want a modern city with room to move. ' +
      'Old buildings can be replaced; minutes lost every day cannot. You usually back the design that saves the most time, ' +
      'and you accept demolition, even of homes, when the gain is real. You still care about your neighbours: when two designs save ' +
      'about the same time, the one that displaces fewer people wins. Reject all three ("none") only if every design saves almost nothing. ' +
      'Give the vote shares in percent, adding up to 100, ' +
      'and report the outcome in one or two sentences, as a local newspaper would: why the people chose this, with at most two numbers. ' + ENGLISH,
    build(c) {
      const prompt = [
        `${clip(c.resident.name, 40)}, ${num(c.resident.age)}, asked for a route from their home, ${aUse(c.resident.homeUse)} building, to ${aUse(c.resident.destUse)} building:`,
        `"${clip(c.resident.complaint, 300)}"`,
        'The three designs:',
        ...c.designs.map((d) => `- ${d.planner} (${clip(d.name, 40)}), "${clip(d.title, 60)}": ${designLine(d)}. Pitch: "${clip(d.pitch, 300)}"`),
        `So far the council has demolished ${num(c.totals.demolished)} buildings and displaced about ${num(c.totals.displaced)} residents.`,
        history(c.history),
      ].join('\n')
      const share = { type: 'integer', minimum: 0, maximum: 100 }
      const schema = {
        type: 'object',
        properties: {
          winner: { type: 'string', enum: ['p1', 'p2', 'p3', 'none'] },
          shares: {
            type: 'object',
            properties: { p1: share, p2: share, p3: share, none: share },
            required: ['p1', 'p2', 'p3', 'none'],
            additionalProperties: false,
          },
          reason: { type: 'string', maxLength: 320 },
        },
        required: ['winner', 'shares', 'reason'],
        additionalProperties: false,
      }
      return { prompt, schema }
    },
  },
}

// One `claude -p` run, without a shell: arguments go in as a list.
function askClaude(system, prompt, schema) {
  const args = [
    '-p', prompt,
    '--safe-mode',
    '--tools', '',
    '--model', 'haiku',
    '--effort', 'low',
    '--output-format', 'json',
    '--no-session-persistence',
    '--system-prompt', system,
    '--json-schema', JSON.stringify(schema),
  ]
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`no answer within ${TIMEOUT_MS / 1000} s`))
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(e.code === 'ENOENT' ? 'the claude command was not found on this laptop' : e.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const reply = JSON.parse(out)
        if (reply.is_error || !reply.structured_output) throw new Error(clip(reply.result || 'no structured answer', 200))
        resolve({ output: reply.structured_output, ms: reply.duration_ms })
      } catch (e) {
        reject(new Error(code ? clip(err || out || `claude exited with ${code}`, 200) : e.message))
      }
    })
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (d) => {
      body += d
      if (body.length > MAX_BODY) reject(new Error('request too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

async function handle(req, res) {
  const send = (status, data) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  }
  if (req.method !== 'POST') return send(405, { ok: false, error: 'POST only' })
  try {
    const { role, context } = JSON.parse(await readBody(req))
    const voice = ROLES[role]
    if (!voice) return send(400, { ok: false, error: 'unknown role' })
    const { prompt, schema } = voice.build(context)
    const system = voice.system ?? voice.systemFor(context)
    const answer = await askClaude(system, prompt, schema)
    send(200, { ok: true, ...answer, prompt })
  } catch (e) {
    send(500, { ok: false, error: e.message })
  }
}

export function councilPlugin() {
  return {
    name: 'renovation-council',
    apply: 'serve', // dev server only; the built site has no endpoint
    configureServer(server) {
      server.middlewares.use('/api/council', (req, res) => {
        handle(req, res)
      })
    },
  }
}
