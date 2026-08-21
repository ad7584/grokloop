// The loop.
//
// One step is one decision point: pick the most promising unexplored branch,
// ask Grok what is worth trying there, let the solver kill whatever cannot
// work, and record what happened. When the best remaining branch is somewhere
// else in the tree, the loop walks back to it — and that walk back is the
// moment the whole site exists to show.

import process from 'node:process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.js';
import { ask } from './grok.js';
import { catalogue } from './grok.js';
import { SLOTS, createRoot, makeChild, selectNext, anyExploring, pathTo, isComplete, resetIds } from './tree.js';
import { TARGET_PAYLOAD_FRACTION } from '../data/constants.js';
import { previewVehicle } from './physics.js';
import { ENGINES } from '../data/engines.js';
import { MATERIALS } from '../data/materials.js';
import { PROPELLANTS } from '../data/propellants.js';
import { TPS } from '../data/constants.js';

/* Where the research lives.
 *
 * Configurable because a container filesystem is ephemeral: in production a
 * redeploy would wipe loop.json and the search would silently restart from an
 * empty tree, which for a project whose whole value is an accumulating record
 * is the worst possible failure. In production this points at a mounted volume.
 */
const STATE_DIR = process.env.STATE_DIR || join(ROOT, 'state');
const STATE_FILE = join(STATE_DIR, 'loop.json');
const MAX_EVENTS = 600;

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(ev) {
  const e = { ...ev, at: Date.now() };
  for (const fn of listeners) { try { fn(e); } catch { /* a dead socket is not the loop's problem */ } }
  return e;
}

const blank = () => ({
  step: 0,
  nodes: { 0: createRoot() },
  events: [],
  currentId: 0,
  bestId: null,
  bestFraction: 0,
  solvedId: null,
  spend: {},
  lastError: null,
  startedAt: Date.now(),
});

export function load() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

  /* Operator reset, once per token. Set RESET_STATE to any new value and the
   * next boot archives the current search and starts clean — used when the
   * ruleset changes enough that old results are no longer honest (the first
   * "solved" run closed at 4.01% on a vehicle whose liftoff thrust-to-weight
   * was 0.77; results found under gates that missed that are not results).
   * The marker file makes it idempotent: later restarts see the same token
   * and leave the new search alone. */
  const token = process.env.RESET_STATE;
  if (token && existsSync(STATE_FILE) && !existsSync(join(STATE_DIR, `.reset-${token}`))) {
    const archived = join(STATE_DIR, `loop.archived-${token}.json`);
    writeFileSync(archived, readFileSync(STATE_FILE));
    writeFileSync(join(STATE_DIR, `.reset-${token}`), new Date().toISOString());
    writeFileSync(STATE_FILE, JSON.stringify(blank(), null, 2));
    console.log(`RESET_STATE=${token}: previous search archived to ${archived}, starting clean`);
  }

  if (!existsSync(STATE_FILE)) return blank();
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    const maxId = Math.max(0, ...Object.keys(s.nodes || {}).map(Number));
    resetIds(maxId + 1);

    /* Heal transient statuses. 'exploring' means a request was in flight when
     * the process died — in production that is every redeploy — and nothing will
     * ever select that node again, so a crash at the wrong moment leaves the
     * search permanently wedged. In-flight work is simply open work after a
     * restart. */
    for (const n of Object.values(s.nodes || {})) {
      if (n.status === 'exploring') n.status = 'open';
    }

    return { ...blank(), ...s };
  } catch {
    return blank();
  }
}

export function save(s) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/**
 * One shared state object for the whole process.
 *
 * Steps run concurrently now, and if each loaded its own copy from disk they
 * would each write back a snapshot taken before the others started — every
 * parallel step but the last would silently vanish. A single in-memory object
 * avoids that entirely: Node is single-threaded, so the mutations between
 * awaits are atomic, and a node is marked 'exploring' BEFORE its await, which
 * is what stops two steps picking the same branch.
 */
let shared = null;
export function state() {
  if (!shared) shared = load();
  return shared;
}
export function resetState() { shared = null; }

const today = () => new Date().toISOString().slice(0, 10);
export const spentToday = (s) => s.spend[today()] || 0;
function charge(s, usd) { s.spend[today()] = (s.spend[today()] || 0) + (usd || 0); }

function record(s, ev) {
  const e = emit(ev);
  s.events.push(e);
  if (s.events.length > MAX_EVENTS) s.events = s.events.slice(-MAX_EVENTS);
  return e;
}

/* ---------------------------------------------------------------- prompting */

function describeDesign(design) {
  if (!design.stages?.length) return 'Nothing committed yet. Clean sheet.';
  const L = [];
  if (design.architecture) L.push(`Architecture: ${design.architecture}`);
  if (design.payloadMass) L.push(`Payload class: ${(design.payloadMass / 1000).toFixed(0)} t to LEO`);
  for (const [i, s] of design.stages.entries()) {
    const bits = [];
    if (s.propellant) bits.push(s.propellant);
    if (s.engine) bits.push(`${ENGINES[s.engine]?.name ?? s.engine}${s.engineCount ? ` x${s.engineCount}` : ''}`);
    if (s.material) bits.push(MATERIALS[s.material]?.name ?? s.material);
    if (s.structuralCoefficient != null) bits.push(`structural coefficient ${s.structuralCoefficient.toFixed(4)}`);
    if (s.diameter) bits.push(`${s.diameter} m diameter`);
    if (s.recovery) bits.push(`recovery: ${s.recovery}`);
    if (s.tps) bits.push(`TPS: ${s.tps}`);
    if (s.deltaVShare != null) bits.push(`${(s.deltaVShare * 100).toFixed(0)}% of ascent delta-v`);
    L.push(`  ${s.name || `Stage ${i + 1}`}: ${bits.length ? bits.join(', ') : 'undecided'}`);
  }
  return L.join('\n');
}

function deadEndsSoFar(s, limit = 6) {
  const blocked = Object.values(s.nodes)
    .filter(n => n.status === 'blocked' && n.blockedReason)
    .slice(-limit);
  if (!blocked.length) return 'None yet.';
  return blocked.map(n => `- ${n.label}: ${n.blockedReason}`).join('\n');
}

const SCHEMAS = {
  architecture: `{"options":[{"label":"...","value":"two-stage","stageCount":2,"reasoning":"...","plain":"..."}]}`,
  diameter: `{"options":[{"label":"9 m","diameter":9,"reasoning":"...","plain":"..."}]}`,
  payloadMass: `{"options":[{"label":"100 t class","payloadMass":100000,"reasoning":"...","plain":"..."}]}`,
  propellant: `{"options":[{"label":"...","propellant":"LOX/CH4","reasoning":"...","plain":"..."}]}`,
  engine: `{"options":[{"label":"...","engine":"raptor-3","engineCount":33,"reasoning":"...","plain":"..."}]}`,
  material: `{"options":[{"label":"...","material":"ss-301-fullhard","structuralCoefficient":0.045,"justification":"the manufacturing route, required if this beats what has flown","reasoning":"...","plain":"..."}]}`,
  recovery: `{"options":[{"label":"...","recovery":"RTLS","tps":null,"landingHardwareFraction":0.06,"justification":"...","reasoning":"...","plain":"..."}]}`,
  deltaVSplit: `{"options":[{"label":"55/45","shares":[0.55,0.45],"reasoning":"...","plain":"..."}]}`,
};

const VALID = {
  propellant: () => Object.keys(PROPELLANTS),
  engine: () => Object.keys(ENGINES),
  material: () => Object.keys(MATERIALS),
  tps: () => Object.keys(TPS),
  recovery: () => ['RTLS', 'downrange', 'orbital'],
};

function buildPrompt(s, node) {
  const slot = SLOTS[node.cursor.slotIndex];
  const stage = node.design.stages?.[node.cursor.stageIndex];
  const scope = slot.scope === 'stage'
    ? `This question is about ${stage?.name || `stage ${node.cursor.stageIndex + 1}`} specifically.`
    : 'This question is about the vehicle as a whole.';

  return [
    catalogue(),
    '',
    '## Where the search currently stands',
    '',
    describeDesign(node.design),
    '',
    `Best payload fraction reached by any complete design so far: ` +
      (s.bestFraction > 0 ? `${(s.bestFraction * 100).toFixed(2)}%` : 'none has closed yet') +
      `. Target: ${(TARGET_PAYLOAD_FRACTION * 100).toFixed(0)}%.`,
    '',
    '## Branches already killed by the solver — do not walk back into these',
    '',
    deadEndsSoFar(s),
    '',
    '## Your question',
    '',
    slot.question,
    scope,
    '',
    'Give two to four options. Each needs a short label, the field values, and reasoning that is',
    'specific and numerate. Where a value beats anything that has flown, the justification field',
    'must carry a real manufacturing route or the option is discarded unread.',
    '',
    'Each option ALSO needs a "plain" field: ONE SHORT SENTENCE, UNDER 95 CHARACTERS, lowercase,',
    'that a',
    'smart person with no engineering background would understand. No symbols, no units like kg/m3',
    'or m/s, no Isp, no epsilon, no jargon. Say what the idea IS and why it might work or not.',
    'Example of a good plain line: "burn methane instead of hydrogen — less efficient, but the fuel',
    'is dense so the tank can be much smaller." That line is published verbatim.',
    '',
    `Reply with JSON in exactly this shape: ${SCHEMAS[slot.key]}`,
    slot.key === 'engine'
      ? `Engines that can fly this stage (same propellant, sea-level capable if it is the booster, ` +
        `restartable in flight, rapid-reuse history): ${compatibleEngines(stage, node.cursor.stageIndex).join(', ')}. ` +
        `Choose ONLY from these; anything else is discarded unread.`
      : VALID[slot.key] ? `Valid values for this field: ${VALID[slot.key]().join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Engines that can legally fly a given stage of THIS mission: same propellant,
 * sea-level capable if it is the booster, able to restart in flight (every
 * stage lands propulsively) and with a rapid-reuse service history (every
 * stage is reflown). Checked at proposal time, because discovering a mismatch
 * at the end of a sixteen-decision path wasted hundreds of branches.
 */
export function compatibleEngines(stage, stageIndex) {
  return Object.entries(ENGINES)
    .filter(([, e]) => e.propellant === stage?.propellant)
    .filter(([, e]) => stageIndex > 0 || e.sealevel)
    .filter(([, e]) => e.restartInFlight !== false && e.rapidReuse !== false)
    .map(([k]) => k);
}

/** Drop anything the model made up before it reaches the solver. */
function sanitise(slotKey, opt, ctx = {}) {
  if (!opt || typeof opt !== 'object') return null;
  const bad = (msg) => ({ __invalid: msg });

  switch (slotKey) {
    case 'architecture':
      if (!(opt.stageCount >= 1 && opt.stageCount <= 3)) return bad('stage count out of range');
      break;
    case 'diameter':
      if (!(opt.diameter > 1 && opt.diameter < 30)) return bad('implausible diameter');
      break;
    case 'payloadMass':
      if (!(opt.payloadMass > 100 && opt.payloadMass < 1e7)) return bad('implausible payload mass');
      break;
    case 'propellant':
      if (!PROPELLANTS[opt.propellant]) return bad(`unknown propellant "${opt.propellant}"`);
      break;
    case 'engine':
      if (!ENGINES[opt.engine]) return bad(`invented engine "${opt.engine}"`);
      if (ctx.stage && !compatibleEngines(ctx.stage, ctx.stageIndex).includes(opt.engine)) {
        return bad(`${ENGINES[opt.engine].name} cannot fly this stage — wrong propellant, not sea-level capable, cannot restart in flight, or no rapid-reuse history`);
      }
      if (!Number.isInteger(opt.engineCount) || opt.engineCount < 1 || opt.engineCount > 40) {
        return bad(`engine count ${opt.engineCount} — must be a whole number from 1 to 40, and it is checked against liftoff weight`);
      }
      break;
    case 'material':
      if (!MATERIALS[opt.material]) return bad(`invented material "${opt.material}"`);
      if (!(opt.structuralCoefficient > 0.005 && opt.structuralCoefficient < 0.5)) {
        return bad(`structural coefficient ${opt.structuralCoefficient} is outside any physical range`);
      }
      break;
    case 'recovery':
      if (!['RTLS', 'downrange', 'orbital'].includes(opt.recovery)) return bad(`unknown recovery mode "${opt.recovery}"`);
      if (opt.tps && !TPS[opt.tps]) return bad(`invented thermal protection "${opt.tps}"`);
      break;
    case 'deltaVSplit': {
      if (!Array.isArray(opt.shares) || !opt.shares.length) return bad('no delta-v shares given');
      const sum = opt.shares.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.02) return bad(`delta-v shares sum to ${sum.toFixed(2)}`);
      // Normalise small rounding so the solver's strict check does not reject good options.
      opt.shares = opt.shares.map(x => x / sum);
      break;
    }
  }
  return opt;
}

/* -------------------------------------------------------------------- step */

/** One research step. Returns a summary; never throws for ordinary failure. */
export async function step(s = state()) {
  /* No cap by default. 0, empty or unset all mean uncapped — a naive
   * `Number(env || 6)` would read "0" as a zero budget and silently stop the
   * loop on its first step, which is the exact opposite of what setting it to
   * zero is meant to express.
   *
   * Uncapped is not unbounded: the loop is sequential, so spend is limited by
   * how fast grok-4.6 can answer. At the fastest observed 52s per step that is
   * about $55/day, and errors back off 60s before retrying. */
  // Operator pause. The site stays up and says so — it never fakes activity.
  if (process.env.PAUSED === '1') {
    return { skipped: 'paused by the operator — the search resumes when the pause is lifted', state: s };
  }

  const raw = Number(process.env.DAILY_BUDGET_USD);
  const budget = Number.isFinite(raw) && raw > 0 ? raw : Infinity;
  if (spentToday(s) >= budget) {
    return { skipped: `daily budget reached ($${spentToday(s).toFixed(2)})`, state: s };
  }
  if (s.solvedId != null) {
    return { skipped: 'solved — the target has been reached', state: s };
  }

  // Once any design has been scored there is something to bound against, so
  // the search switches from diving to optimising.
  const node = selectNext(s.nodes, { haveIncumbent: s.bestFraction > 0 });
  if (!node) {
    /* Nothing open is not the same as nothing left. At startup there is one
     * node and three workers, so two of them find the root already taken —
     * declaring the search exhausted there killed the whole run in its first
     * second. Only an idle tree with nothing in flight is genuinely finished. */
    if (anyExploring(s.nodes)) {
      return { skipped: 'waiting for another branch to finish', state: s };
    }
    record(s, { type: 'exhausted', message: 'every branch in the tree has been explored or killed' });
    save(s);
    return { skipped: 'search exhausted', state: s };
  }

  // Moving to a node that is not a child of where we just were IS the backtrack.
  const cameFrom = s.currentId;
  if (cameFrom != null && node.parentId !== cameFrom && node.id !== cameFrom) {
    const from = s.nodes[cameFrom];
    record(s, {
      type: 'backtrack',
      fromId: cameFrom,
      toId: node.id,
      message: `backing out of "${from?.label ?? 'that line'}" and returning to "${node.label}"`,
      reason: from?.blockedReason ?? 'that line stopped being the most promising one open',
      // What each side of the jump IS, for a reader who never saw the tree.
      fromPlain: from?.plain || from?.label || null,
      toPlain: node.plain || node.label || null,
      plainReason: from?.plainBlocked ?? null,
      fromBlocked: from?.status === 'blocked',
    });
  }
  s.currentId = node.id;
  node.status = 'exploring';

  const slot = SLOTS[node.cursor.slotIndex];

  /* A stage with no legal engine is dead before any question is worth asking.
   * Hydrogen is the live case: its only sea-level engine (RS-25) and its only
   * upper-stage engine (RL10) are both disqualified from rapid reuse by their
   * service history, so a reusable hydrogen stage cannot be built from flown
   * hardware — which is exactly why nobody has built one. Saying so here costs
   * nothing; finding out sixteen decisions later cost 297 branches. */
  if (slot.key === 'engine') {
    const st = node.design.stages[node.cursor.stageIndex];
    if (compatibleEngines(st, node.cursor.stageIndex).length === 0) {
      const fuel = { 'LOX/LH2': 'hydrogen', 'LOX/CH4': 'methane', 'LOX/RP-1': 'kerosene' }[st.propellant] ?? st.propellant;
      node.status = 'blocked';
      node.blockedReason = `no engine in the catalogue burns ${st.propellant}` +
        `${node.cursor.stageIndex === 0 ? ', runs at sea level' : ''}, restarts in flight and has a ` +
        `rapid-reuse service history — every ${fuel} engine ever flown was either expended or rebuilt for months between flights`;
      node.plainBlocked = `there is no ${fuel} engine on earth that can land itself and fly again quickly. ` +
        `every one ever built was thrown away or rebuilt for months`;
      record(s, {
        type: 'blocked', nodeId: node.id, parentId: node.parentId, slot: slot.key,
        label: node.label, plain: node.plain, bound: node.bound,
        message: `${node.label} — blocked: ${node.blockedReason}`,
        blockedReason: node.blockedReason, plainReason: node.plainBlocked, trivial: false,
      });
      s.step += 1;
      save(s);
      return { state: s, nodeId: node.id, slot: slot.key, created: 0, blocked: 1, costUsd: 0, solved: false };
    }
  }

  record(s, {
    type: 'question',
    nodeId: node.id,
    slot: slot.key,
    short: slot.short,
    message: slot.question,
    path: pathTo(s.nodes, node.id).map(n => n.label),
  });

  let answer;
  try {
    let buf = "", lastFlush = 0;
    const flush = (force) => {
      if (!buf) return;
      if (!force && Date.now() - lastFlush < 400) return;
      emit({ type: "stream", nodeId: node.id, slot: slot.key, streamId: node.id, text: buf });
      buf = "";
      lastFlush = Date.now();
    };
    answer = await ask(buildPrompt(s, node), {
      // Deltas are broadcast live but NOT stored in the event log — they are
      // the same text as the finished trace, and keeping both would double the
      // state file for nothing.
      onDelta: ({ thinking, content }) => { buf += thinking || content || ""; flush(false); },
    });
    flush(true);
    emit({ type: "stream-end", nodeId: node.id, streamId: node.id });
  } catch (e) {
    node.status = 'open';
    s.lastError = e.message;
    record(s, { type: 'error', message: e.message });
    save(s);
    return { error: e.message, state: s };
  }
  charge(s, answer.costUsd);
  s.lastError = null;

  // The working-out, before any conclusion. This is the most alive thing on the
  // page and it costs nothing extra — the model already produced it.
  if (answer.thinking) {
    record(s, {
      type: "thinking",
      nodeId: node.id,
      slot: slot.key,
      message: `grok thought for ${answer.reasoningTokens.toLocaleString()} tokens`,
      thinking: answer.thinking,
      tokens: answer.reasoningTokens,
    });
  }

  const options = Array.isArray(answer.data?.options) ? answer.data.options : [];
  if (!options.length) {
    node.status = 'open';
    record(s, { type: 'error', message: 'the model returned no usable options; retrying this node' });
    save(s);
    return { error: 'no options returned', state: s };
  }

  const made = [];
  for (const raw of options.slice(0, 4)) {
    const clean = sanitise(slot.key, raw, {
      stage: node.design.stages?.[node.cursor.stageIndex],
      stageIndex: node.cursor.stageIndex,
    });
    if (!clean) continue;
    if (clean.__invalid) {
      record(s, { type: 'rejected', nodeId: node.id, message: `option discarded: ${clean.__invalid}` });
      continue;
    }
    const child = makeChild(node, slot.key, clean);
    s.nodes[child.id] = child;
    node.children.push(child.id);
    made.push(child);

    record(s, {
      type: child.status === 'blocked' ? 'blocked' : 'branch',
      nodeId: child.id,
      parentId: node.id,
      slot: slot.key,
      short: slot.short,
      stage: slot.scope === 'stage' ? (node.design.stages?.[node.cursor.stageIndex]?.name ?? null) : null,
      label: child.label,
      reasoning: child.reasoning,
      plain: child.plain,
      bound: child.bound,
      message: child.status === 'blocked'
        ? `${child.label} — blocked: ${child.blockedReason}`
        : `${child.label}`,
      blockedReason: child.blockedReason ?? null,
      plainReason: child.plainBlocked ?? null,
      trivial: child.trivial ?? false,
    });

    // The arithmetic that produced that verdict, shown rather than discarded.
    if (child.workings?.length) {
      record(s, {
        type: 'calc',
        nodeId: child.id,
        label: child.label,
        bound: child.bound,
        message: `solver · ${child.label}`,
        workings: child.workings,
      });
    }

    if (child.status === 'solved') {
      s.solvedId = child.id;
      s.bestId = child.id;
      s.bestFraction = child.payloadFraction;
      record(s, {
        type: 'solved',
        nodeId: child.id,
        fraction: child.payloadFraction,
        message: `a fully reusable design closed at ${(child.payloadFraction * 100).toFixed(2)}% ` +
          `and passed scrutiny`,
      });
    } else if (child.status === 'complete' && child.payloadFraction > s.bestFraction) {
      s.bestId = child.id;
      s.bestFraction = child.payloadFraction;
      record(s, {
        type: 'best',
        nodeId: child.id,
        fraction: child.payloadFraction,
        message: `new best fully reusable design: ${(child.payloadFraction * 100).toFixed(2)}% ` +
          `(target ${(TARGET_PAYLOAD_FRACTION * 100).toFixed(0)}%)`,
      });
    }
  }

  node.status = made.some(c => c.status === 'open') ? 'expanded' : 'exhausted';
  s.step += 1;
  save(s);

  return {
    state: s,
    nodeId: node.id,
    slot: slot.key,
    created: made.length,
    blocked: made.filter(c => c.status === 'blocked').length,
    costUsd: answer.costUsd,
    solved: s.solvedId != null,
  };
}

/** The compact view the website renders. */
export function snapshot(s = state()) {
  const nodes = Object.values(s.nodes).map(n => ({
    id: n.id, parentId: n.parentId, depth: n.depth, label: n.label,
    slot: n.slot, status: n.status, bound: n.bound,
    blockedReason: n.blockedReason ?? null,
    payloadFraction: n.payloadFraction ?? null,
    reasoning: n.reasoning ?? '',
  }));
  const current = s.nodes[s.currentId];
  const best = s.bestId != null ? s.nodes[s.bestId] : null;

  return {
    step: s.step,
    target: TARGET_PAYLOAD_FRACTION,
    bestFraction: s.bestFraction,
    solved: s.solvedId != null,
    spentToday: spentToday(s),
    startedAt: s.startedAt,
    lastError: s.lastError,
    currentPath: current ? pathTo(s.nodes, current.id).map(n => ({ id: n.id, label: n.label, slot: n.slot })) : [],
    design: best?.design ?? current?.design ?? { stages: [] },
    bestResult: best?.result ?? null,
    preview: previewVehicle(best?.design ?? current?.design ?? { stages: [] }),
    nodes,
    events: s.events.slice(-120),
    archive: Object.values(s.nodes)
      .filter(n => n.status === "solved" || n.status === "complete" || n.status === "blocked")
      .sort((a, b) => (b.payloadFraction ?? -1) - (a.payloadFraction ?? -1) || b.id - a.id)
      .slice(0, 60)
      .map(n => ({
        id: n.id, label: n.label, status: n.status,
        payloadFraction: n.payloadFraction ?? null,
        blockedReason: n.blockedReason ?? null,
        glow: n.result?.glow ?? null,
        path: pathTo(s.nodes, n.id).map(p => p.label),
        at: n.createdAt,
      })),
    counts: {
      total: nodes.length,
      blocked: nodes.filter(n => n.status === 'blocked').length,
      open: nodes.filter(n => n.status === 'open').length,
      complete: nodes.filter(n => n.status === 'complete' || n.status === 'solved').length,
    },
  };
}
