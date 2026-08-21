// Grok 4.6, via OpenRouter. The only place money is spent.
//
// The model is asked for OPTIONS, never for answers. It says what is worth
// trying and why; physics.js decides what survives. Structured output is
// enforced so a decision can never arrive as prose that has to be parsed by
// guesswork.

import process from 'node:process';
import { ENGINES, THEORETICAL_MAX_ISP_VAC } from '../data/engines.js';
import { MATERIALS, specificStrength } from '../data/materials.js';
import { PROPELLANTS } from '../data/propellants.js';
import { TPS, DELTA_V, RECOVERY_DELTA_V, TARGET_PAYLOAD_FRACTION } from '../data/constants.js';
import { REFERENCE_VEHICLES, structuralCoefficient } from '../data/reference.js';
import { BEST_FLOWN } from './scrutiny.js';

const BASE = 'https://openrouter.ai/api/v1/chat/completions';
const RATE = { in: 2, out: 6 }; // $/M tokens, grok-4.6

export const MODEL = () => process.env.GROK_MODEL || 'x-ai/grok-4.6';

/* One model, deliberately. grok-4.6 is congested — measured at 84% uptime over
 * 30 minutes against 99.9% for grok-4.5 — and xAI is the only provider, so
 * OpenRouter cannot route around it. Falling back to a sibling would keep the
 * loop moving, but the whole claim is that Grok 4.6 is doing this research, and
 * a page saying so over work another model did is not a claim worth making.
 * The loop retries, and when 4.6 is genuinely unavailable it waits and says so. */

function key() {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error('OPENROUTER_API_KEY is not set — copy .env.example to .env');
  return k;
}

/**
 * The catalogue the model is allowed to choose from, rendered into the prompt.
 *
 * It is here, in full, for a reason: the model cannot invent an engine or a
 * material, so it must be shown exactly what exists. Anything it wants that is
 * not on this list has to be argued for as a modification of something that is.
 */
export function catalogue() {
  const L = [];

  L.push('## Propellant combinations available');
  for (const [k, p] of Object.entries(PROPELLANTS)) {
    L.push(`- ${k} (${p.short}): bulk density ${p.bulkDensity} kg/m3, mixture ratio ${p.mixtureRatio}. ${p.note}`);
  }

  L.push('', '## Engines available (you may not invent one)');
  for (const [k, e] of Object.entries(ENGINES)) {
    const tw = (e.thrustSL ?? e.thrustVac) / (e.mass * 9.80665);
    L.push(`- ${k}: ${e.name}, ${e.propellant}, ${e.cycle}. ` +
      `Isp ${e.ispSL ? e.ispSL + 's SL / ' : ''}${e.ispVac}s vac. ` +
      `Thrust ${((e.thrustSL ?? e.thrustVac) / 1000).toFixed(0)} kN, mass ${e.mass} kg, T/W ${tw.toFixed(0)}. ` +
      `${e.sealevel ? 'Sea-level capable.' : 'VACUUM ONLY — cannot be a first stage.'} ` +
      `${e.restartInFlight === false ? 'CANNOT RESTART IN FLIGHT — no landing burn possible. ' : ''}` +
      `${e.rapidReuse === false ? 'NOT rapidly reusable — disqualified on any recovered stage. ' : ''}${e.note}`);
  }

  L.push('', '## Theoretical Isp ceilings (chemistry, not engineering — these cannot be exceeded)');
  for (const [k, v] of Object.entries(THEORETICAL_MAX_ISP_VAC)) L.push(`- ${k}: ${v}s vacuum`);

  L.push('', '## Structural materials');
  for (const [k, m] of Object.entries(MATERIALS)) {
    L.push(`- ${k}: ${m.name}. Density ${m.density} kg/m3, yield ${m.yieldStrength} MPa ` +
      `(specific strength ${specificStrength(m).toFixed(3)}), max service ${m.maxServiceTempK}K, ` +
      `cryogenic behaviour: ${m.cryoBehaviour}.`);
    L.push(`    Manufacturing: ${m.manufacturing}`);
    L.push(`    Risks: ${m.manufacturingRisks.join(' ')}`);
  }

  L.push('', '## Thermal protection systems');
  for (const [k, t] of Object.entries(TPS)) {
    L.push(`- ${k}: ${t.arealDensity} kg/m2 of protected area, good to ${t.maxTempK}K, ` +
      `${t.reusable ? 'reusable' : 'ABLATIVE — consumed each flight'}. ${t.note}`);
  }

  L.push('', '## Mission budget');
  L.push(`- Ascent to LEO: ${DELTA_V.toLEO} m/s including gravity, drag and steering losses.`);
  L.push(`- Booster return to launch site: ${RECOVERY_DELTA_V.boosterRTLS.value} m/s.`);
  L.push(`- Booster downrange landing: ${RECOVERY_DELTA_V.boosterDownrange.value} m/s.`);
  L.push(`- Orbital stage deorbit plus landing: ${RECOVERY_DELTA_V.orbitalStageDeorbit.value + RECOVERY_DELTA_V.orbitalStageLanding.value} m/s.`);

  L.push('', '## What has actually been flown (your claims are checked against this)');
  for (const v of Object.values(REFERENCE_VEHICLES)) {
    const pf = v.payloadLEOReusable ? (v.payloadLEOReusable / v.glow * 100).toFixed(2) + '%' : 'n/a';
    L.push(`- ${v.name}: GLOW ${(v.glow / 1000).toFixed(0)}t, reusable payload fraction ${pf}` +
      `${v.fullyReusable ? ' (FULLY reusable)' : ' (partially reusable)'}.`);
    for (const s of v.stages) {
      L.push(`    ${s.name}: structural coefficient ${structuralCoefficient(s).toFixed(4)} ` +
        `${s.recovered ? '[recovered]' : '[expended]'}`);
    }
  }
  L.push('',
    '## The flight record, split three ways — your claims are checked against THIS',
    `- Best EXPENDED stage ever flown: ${BEST_FLOWN.expendable.toFixed(4)} (Falcon 9 upper stage).`,
    `- Best RECOVERED BOOSTER ever flown: ${BEST_FLOWN.recoveredSuborbital.toFixed(4)} (Falcon 9 first stage). ` +
      `It stages far below orbital velocity and carries no orbital heat shield.`,
    BEST_FLOWN.recoveredOrbital == null
      ? `- Best RECOVERED ORBITAL STAGE ever flown: NONE. No orbital stage has ever been recovered and ` +
        `reflown, anywhere, by anyone. There is no flight record to check such a claim against, so any ` +
        `number you propose for one is an extrapolation and must come with a manufacturing route. ` +
        `Starship's published figures are targets, not achievements — it has not reached orbit — and ` +
        `they are excluded from this record. Citing them as proof is not an argument.`
      : `- Best RECOVERED ORBITAL STAGE ever flown: ${BEST_FLOWN.recoveredOrbital.toFixed(4)}.`);

  return L.join('\n');
}

export const SYSTEM = `You are the engineering mind inside GROK LOOP, working continuously on one
problem: design a FULLY AND RAPIDLY REUSABLE orbital launch vehicle that delivers at least
${(TARGET_PAYLOAD_FRACTION * 100).toFixed(0)}% of its liftoff mass to low Earth orbit, with every
stage recovered and reflown.

This is the bar Elon Musk named as the threshold for full reusability, and he has said openly that
it is so difficult he sometimes doubts it can be done. No vehicle has ever achieved it. Falcon 9
reaches about 4.15% only by expending its second stage. Starship, fully reusable, targets about 2%.

You are doing real engineering research, not writing marketing copy and not telling a story.

## How this works

You are asked one design question at a time and you answer with two to four OPTIONS worth trying.
You do not decide which is correct — a deterministic solver computes the mass budget for each
option using the Tsiolkovsky equation and real constants, and prunes any branch that cannot reach
the target even under the most favourable remaining assumptions. Your job is to propose the
options that are actually worth the solver's time, and to say why.

## Rules you must follow

0. Thrust is checked. Liftoff thrust-to-weight must clear 1.15 with the engines you actually
   picked, upper stages must ignite above 0.45, and the engines must fit inside the dry mass
   your structural coefficient implies (real stages spend 12-19% of dry mass on engines).
   Recovered stages need an engine that can restart in flight AND has a rapid-reuse service
   history — RS-25 and RL10 fail that on facts, and no justification text overrides it.

1. You may only select engines, materials, propellants and thermal protection systems from the
   catalogue you are given. You cannot invent hardware.
2. If you claim a structural coefficient better than anything that has flown, you MUST give the
   manufacturing route: the process, the precedent, what limits it, and what fails first. A bare
   number with no route is rejected automatically and the branch dies. "Advanced manufacturing"
   is not a route. Naming a real process, its known limits, and why it applies here is a route.
3. Never exceed the theoretical Isp ceiling for a propellant combination. That is chemistry.
4. A vacuum-optimised engine cannot be used as a first stage — its nozzle flow-separates at sea
   level.
5. Every stage must be recovered. A design that expends anything is not an answer to this problem.
6. Be honest when an option is a long shot. Saying "this probably fails on permeation but is worth
   one branch because the mass saving is large" is useful. Overselling is not.

## Voice

Write like a working engineer. Terse, specific, numerate. No hype, no salesmanship, no
exclamation marks. Real units on every number. If something is uncertain, say so.`;

/** Transient upstream conditions worth waiting out rather than failing on. */
const TRANSIENT = /at capacity|high demand|rate.?limit|temporarily|timeout|overloaded|\b(429|502|503|504)\b/i;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Retry the things that are the provider having a bad minute, and only those.
 * xAI returns "the model is currently at capacity" fairly often at peak, and a
 * research loop that treats that as a dead branch would fill its tree with
 * fictional dead ends — the one failure mode this project cannot tolerate.
 */
async function postWithRetry(body, { attempts = 5, timeoutMs = 300_000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await post(body, timeoutMs);
    } catch (e) {
      last = e;
      if (!TRANSIENT.test(e.message)) throw e;  // a real error is not a capacity problem
      if (i === attempts - 1) throw e;
      const wait = Math.round(15_000 * Math.pow(2, i)); // 15s, 30s, 60s, 120s
      console.log(`  ${body.model} busy, waiting ${wait / 1000}s (attempt ${i + 2}/${attempts})`);
      await sleep(wait);
    }
  }
  throw last;
}

/**
 * The same request, streamed.
 *
 * Without this a step is silent for one to eight minutes and then everything
 * lands at once — the page shows nothing while the interesting part is actually
 * happening. Streaming turns the wait itself into the content: the reasoning
 * arrives as it is produced, so you watch the model work rather than watch a
 * spinner and then read a conclusion.
 *
 * `onDelta({ thinking, content })` is called as fragments arrive. It must never
 * throw — a listener problem is not a reason to lose the research.
 */
async function postStreaming(body, onDelta, timeoutMs = 300_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key()}`,
        'Content-Type': 'application/json',
        'X-Title': 'GROK LOOP',
      },
      signal: ctrl.signal,
      body: JSON.stringify({ ...body, stream: true }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    let content = '', thinking = '', usage = null, finish = null, model = null;
    let buffer = '';

    for await (const chunk of res.body) {
      buffer += Buffer.from(chunk).toString('utf8');
      // SSE frames are separated by a blank line; keep any partial tail.
      const frames = buffer.split('\n');
      buffer = frames.pop() ?? '';

      for (const line of frames) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;

        let json;
        try { json = JSON.parse(payload); } catch { continue; }

        // A provider failure can arrive mid-stream as an error frame.
        if (json.error) {
          const e = json.error;
          throw new Error(`provider error${e.code ? ` ${e.code}` : ''}: ${e.message ?? 'unknown'}`);
        }

        model ??= json.model;
        if (json.usage) usage = json.usage;

        const d = json.choices?.[0];
        if (!d) continue;
        if (d.finish_reason) finish = d.finish_reason;

        const dThinking = d.delta?.reasoning ?? d.delta?.reasoning_content ?? '';
        const dContent = d.delta?.content ?? '';
        if (!dThinking && !dContent) continue;

        thinking += dThinking;
        content += dContent;
        if (onDelta) {
          try { onDelta({ thinking: dThinking, content: dContent }); }
          catch { /* a listener is not the research's problem */ }
        }
      }
    }

    return { content, thinking, usage, finish, model };
  } finally {
    clearTimeout(timer);
  }
}

async function streamWithRetry(body, onDelta, { attempts = 5, timeoutMs = 300_000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await postStreaming(body, onDelta, timeoutMs); }
    catch (e) {
      last = e;
      if (!TRANSIENT.test(e.message) || i === attempts - 1) throw e;
      const wait = Math.round(15_000 * Math.pow(2, i));
      console.log(`  ${body.model} busy, waiting ${wait / 1000}s (attempt ${i + 2}/${attempts})`);
      await sleep(wait);
    }
  }
  throw last;
}

async function post(body, timeoutMs = 300_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key()}`,
        'Content-Type': 'application/json',
        'X-Title': 'GROK LOOP',
      },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);

    const data = JSON.parse(text);
    /* OpenRouter returns provider failures — rate limits, upstream errors,
     * moderation — as HTTP 200 with an error body and no choices. Checking only
     * res.ok lets those through as a mysterious empty response, so the real
     * message never reaches the log. */
    if (data?.error) {
      const e = data.error;
      throw new Error(`provider error${e.code ? ` ${e.code}` : ''}: ${e.message ?? JSON.stringify(e).slice(0, 200)}`);
    }
    if (!Array.isArray(data?.choices) || !data.choices.length) {
      throw new Error(`no choices returned: ${text.slice(0, 200)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function cost(usage) {
  if (usage?.cost != null) return usage.cost;
  return ((usage?.prompt_tokens ?? 0) / 1e6) * RATE.in + ((usage?.completion_tokens ?? 0) / 1e6) * RATE.out;
}

export function parseLoose(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { /* nope */ } }
  return null;
}

/**
 * Ask for structured JSON. Returns { data, raw, costUsd, model, reasoningTokens }.
 *
 * The budget here looks generous because it has to cover two things. Grok
 * reasons before it answers and that reasoning is billed INSIDE max_tokens — a
 * measured 147 of 161 completion tokens on a trivial prompt. Size the budget for
 * the answer alone and the model spends all of it thinking and returns an empty
 * string, which reaches the loop as "the model had no ideas" when what actually
 * happened was truncation. The empty-content check below tells those apart.
 */
export async function ask(user, { maxTokens = 16000, schemaHint = '', onDelta = null } = {}) {
  const data = await streamWithRetry({
    model: MODEL(),
    max_tokens: maxTokens,
    temperature: 0.85,
    response_format: { type: 'json_object' },
    reasoning: { effort: 'medium' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user + (schemaHint ? `\n\n${schemaHint}` : '') },
    ],
  }, onDelta);

  const raw = data?.content ?? '';
  const usage = data?.usage ?? null;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  /* The chain of thought itself, which OpenRouter returns alongside the answer
   * and this was quietly throwing away. It is the most interesting thing the
   * model produces — the working-out before the conclusion — and showing it is
   * the difference between a site that reports decisions and one where you can
   * watch a mind change. */
  const thinking = data?.thinking ?? '';

  if (!String(raw).trim()) {
    const spent = usage?.completion_tokens ?? 0;
    throw new Error(data?.finish === 'length'
      ? `spent the whole ${maxTokens}-token budget (${reasoningTokens} of ${spent} on reasoning) and returned nothing`
      : `returned empty content (finish_reason: ${data?.finish ?? 'unknown'})`);
  }

  return { data: parseLoose(raw), raw, thinking, costUsd: cost(usage),
           model: data?.model ?? MODEL(), usage, reasoningTokens };
}

/** Plain prose, for the narration line and X headlines. */
export async function say(user, { maxTokens = 400 } = {}) {
  const data = await postWithRetry({
    model: MODEL(),
    max_tokens: maxTokens,
    temperature: 0.9,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
  });
  return {
    text: String(data?.choices?.[0]?.message?.content ?? '').trim(),
    costUsd: cost(data?.usage),
    model: MODEL(),
  };
}
