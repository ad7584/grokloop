// HTTP + server-sent events.
//
// The browser gets a snapshot on connect and then a live feed of everything the
// loop does. When the loop is idle, broken, or out of budget, the feed says so
// in plain words — it never invents activity to look busy.

import http from 'node:http';
import process from 'node:process';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadEnv, ROOT } from './env.js';
loadEnv();

import { step, state, snapshot, subscribe, spentToday } from './loop.js';

const PORT = Number(process.env.PORT || 4300);
const STEP_SECONDS = Number(process.env.STEP_SECONDS || 420);
const WEB = join(ROOT, 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const clients = new Set();

subscribe((ev) => {
  const line = `data: ${JSON.stringify({ kind: 'event', event: ev })}\n\n`;
  for (const res of clients) { try { res.write(line); } catch { clients.delete(res); } }
});

function pushStatus(status) {
  const line = `data: ${JSON.stringify({ kind: 'status', status })}\n\n`;
  for (const res of clients) { try { res.write(line); } catch { clients.delete(res); } }
}

/* The site is public and read-only — there is no write endpoint and nothing
 * user-specific to leak — so a front end on another origin may read the API. */
const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }

  // Runtime config: API origin (same-origin here) plus any optional extras set
  // in the environment, so the markup itself stays free of them.
  if (url.pathname === '/config.js') {
    const coin = process.env.COIN_URL ? { url: process.env.COIN_URL, ca: process.env.COIN_CA || '', label: process.env.COIN_LABEL || '$GROKLOOP' } : null;
    res.writeHead(200, { ...CORS, 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    res.end(`window.GROKLOOP_API = '';
window.GROKLOOP_COIN = ${JSON.stringify(coin)};
`);
    return;
  }

  if (url.pathname === '/api/state') {
    res.writeHead(200, { ...CORS, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(snapshot()));
    return;
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ kind: 'snapshot', snapshot: snapshot() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // Static site.
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(WEB, p.replace(/^\/+/, ''));
  if (!file.startsWith(WEB) || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

/* ------------------------------------------------------------- the runner */

/* Several steps run at once.
 *
 * grok-4.6 takes 52 to 974 seconds to answer, and a single-file loop spends
 * almost all of that idle with nothing on screen. The branches of a search tree
 * are independent, so there is no reason to explore them one at a time — a node
 * is marked 'exploring' before its await, so concurrent steps never collide on
 * the same branch, and they all mutate one shared state object so none of their
 * writes clobber each other.
 *
 * The effect on the page is the point: with three in flight, something finishes
 * every ~45 seconds instead of every ~2 minutes, and the terminal stops going
 * quiet between decisions. */
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
let inFlight = 0;
let nextAt = Date.now();

async function tick() {
  if (inFlight >= CONCURRENCY) return;
  if (Date.now() < nextAt) return;
  inFlight++;
  try {
    pushStatus({ state: 'thinking', nextAt: null, inFlight });
    const r = await step();
    if (r.error) {
      // Back off, and say so rather than pretending the next step is imminent.
      nextAt = Date.now() + Math.max(60_000, STEP_SECONDS * 250);
      pushStatus({ state: 'error', message: r.error, nextAt });
    } else if (r.skipped) {
      nextAt = Date.now() + 5 * 60_000;
      pushStatus({ state: 'idle', message: r.skipped, nextAt });
    } else {
      /* STEP_SECONDS of 0 starts the next step as soon as this one lands. That
       * is the normal setting: grok-4.6 already takes one to eight minutes per
       * call, so an added gap only idles the loop. DAILY_BUDGET_USD is the real
       * throttle, and it is the one that stops runaway spend if the model
       * suddenly gets fast. */
      nextAt = Date.now() + STEP_SECONDS * 1000;
      // Something else may still be thinking, so do not report idle while it is.
      pushStatus({ state: inFlight > 1 ? 'thinking' : 'waiting', nextAt, inFlight: inFlight - 1, spentToday: spentToday(r.state) });
    }
  } catch (e) {
    nextAt = Date.now() + 120_000;
    pushStatus({ state: 'error', message: e.message, nextAt });
  } finally {
    inFlight--;
  }
}

server.listen(PORT, () => {
  const s = state();
  console.log(`GROK LOOP listening on http://localhost:${PORT}`);
  console.log(`${CONCURRENCY} steps in parallel · gap ${STEP_SECONDS}s · ${Object.keys(s.nodes).length} nodes · best ${(s.bestFraction * 100).toFixed(2)}%`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('note: OPENROUTER_API_KEY is not set, so the loop will report an error and idle.');
  }
  setInterval(tick, 2000);
  for (let i = 0; i < CONCURRENCY; i++) tick();

  // Optional deployment extras, if the file exists. The research runs without it.
  import('./extras.js').then(m => m.attach({ subscribe, state })).catch(() => {});
});
