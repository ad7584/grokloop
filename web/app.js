// The page. Connects to the stream, renders the log, the numbers and the parts
// table, and hands the design to the 3D view.

import { initRocket, drawVehicle } from '/rocket.js';

const $ = (id) => document.getElementById(id);
const feed = $('feed');
let feedInitialised = false;

initRocket($('stage3d'));

const pct = (x) => (x * 100).toFixed(2) + '%';
const fmt = (kg) => kg >= 1e6 ? (kg / 1e6).toFixed(2) + ' kt'
  : kg >= 1000 ? Math.round(kg / 1000).toLocaleString() + ' t'
  : Math.round(kg) + ' kg';
const clock = (ms) => new Date(ms).toTimeString().slice(0, 8);

// Empty on Railway and locally (same origin); the Railway URL when the front
// end is served from Vercel.
const API = (typeof window !== "undefined" && window.GROKLOOP_API) || "";

function eventLine(ev) {
  const div = document.createElement('div');
  div.className = 'ev ' + (ev.type || '');
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = clock(ev.at) + '  ' + (ev.type || '').toUpperCase();
  const m = document.createElement('div');
  m.className = 'm';
  m.textContent = ev.message || '';
  div.append(t, m);

  // The reasoning is the substance — show it, but only where it exists.
  if (ev.reasoning) {
    const r = document.createElement('div');
    r.className = 'r';
    r.textContent = ev.reasoning;
    div.append(r);
  }
  // Worked arithmetic, verbatim from the solver.
  if (ev.workings?.length) {
    const w = document.createElement('pre');
    w.className = 'w';
    w.textContent = ev.workings.join('\n');
    div.append(w);
  }

  /* The model's chain of thought, verbatim. Long traces are clipped with a
   * toggle rather than truncated, because the interesting part is often at the
   * end where it changes its mind. */
  if (ev.thinking) {
    const th = document.createElement('div');
    th.className = 'think';
    th.textContent = ev.thinking.trim();
    div.append(th);
    if (ev.thinking.length > 700) {
      const more = document.createElement('div');
      more.className = 'more';
      more.textContent = '▾ show the whole thing';
      more.onclick = () => {
        th.classList.toggle('open');
        more.textContent = th.classList.contains('open') ? '▴ collapse' : '▾ show the whole thing';
      };
      div.append(more);
    }
  }
  if (ev.type === 'backtrack' && ev.reason) {
    const r = document.createElement('div');
    r.className = 'r';
    r.textContent = 'because: ' + ev.reason;
    div.append(r);
  }
  return div;
}

/* Live streams, one per concurrent step.
 *
 * Deltas arrive several times a second while the model works. Each stream gets
 * one growing block in the feed, replaced by the finished event when the step
 * lands — so the wait itself is the content instead of a gap. */
const live = new Map();

function streamBlock(id) {
  if (live.has(id)) return live.get(id);
  if (!feedInitialised) { feed.innerHTML = ""; feedInitialised = true; }
  const div = document.createElement("div");
  div.className = "ev thinking live";
  div.innerHTML = `<div class="t">${clock(Date.now())}  THINKING <span class="cur">▍</span></div>`;
  const pre = document.createElement("div");
  pre.className = "think";
  div.append(pre);
  feed.append(div);
  const rec = { div, pre, text: "" };
  live.set(id, rec);
  return rec;
}

function onStream(ev) {
  const rec = streamBlock(ev.streamId);
  rec.text += ev.text;
  // Keep the tail visible: this is a window on a long trace, not the archive.
  rec.pre.textContent = rec.text.length > 4000 ? "…" + rec.text.slice(-4000) : rec.text;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  rec.pre.scrollTop = rec.pre.scrollHeight;
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

function endStream(id) {
  const rec = live.get(id);
  if (!rec) return;
  rec.div.remove();      // the recorded thinking event replaces it
  live.delete(id);
}

function appendEvent(ev) {
  if (!feedInitialised) { feed.innerHTML = ''; feedInitialised = true; }
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  feed.append(eventLine(ev));
  while (feed.children.length > 200) feed.firstChild.remove();
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

function renderParts(snap) {
  const el = $('parts');
  const r = snap.bestResult;
  if (!r || !r.closed) {
    // Show what HAS been decided rather than an empty panel. Undecided rows
    // read "undecided" so the table never implies a choice that was not made.
    const p = snap.preview;
    if (!p?.stages?.length) {
      el.innerHTML = '<div class="empty">nothing decided yet</div>';
      return;
    }
    const rows = [`<tr><td class="sec" colspan="2">provisional · ${p.decided} of ${p.total} decided</td></tr>`];
    rows.push(`<tr><td class="k">estimated liftoff</td><td class="v">${fmt(p.glow)}</td></tr>`);
    rows.push(`<tr><td class="k">payload</td><td class="v">${fmt(p.payloadMass)}</td></tr>`);
    for (const s of p.stages) {
      rows.push(`<tr><td class="sec" colspan="2">${s.name}</td></tr>`);
      const cell = (ok, v) => ok ? v : '<span style="color:var(--dim)">undecided</span>';
      rows.push(`<tr><td class="k">propellant</td><td class="v">${cell(s.known.propellant, s.propellant)}</td></tr>`);
      rows.push(`<tr><td class="k">engine</td><td class="v">${cell(s.known.engine, `${s.engine}${s.engineCount ? ' ×' + s.engineCount : ''}`)}</td></tr>`);
      rows.push(`<tr><td class="k">material</td><td class="v">${cell(s.known.material, s.material)}</td></tr>`);
      rows.push(`<tr><td class="k">recovery</td><td class="v">${cell(s.known.recovery, s.recovery)}</td></tr>`);
      rows.push(`<tr><td class="k">estimated length</td><td class="v">${s.geometry.totalLength.toFixed(1)} m</td></tr>`);
    }
    el.innerHTML = `<table>${rows.join('')}</table>`;
    return;
  }

  const rows = [];
  rows.push(`<tr><td class="sec" colspan="2">vehicle</td></tr>`);
  rows.push(`<tr><td class="k">gross liftoff mass</td><td class="v">${fmt(r.glow)}</td></tr>`);
  rows.push(`<tr><td class="k">payload to LEO</td><td class="v">${fmt(r.payloadMass)}</td></tr>`);
  rows.push(`<tr><td class="k">payload fraction</td><td class="v">${pct(r.payloadFraction)}</td></tr>`);
  rows.push(`<tr><td class="k">fully reusable</td><td class="v">${r.fullyReusable ? 'yes' : 'no'}</td></tr>`);

  for (const s of r.stages) {
    rows.push(`<tr><td class="sec" colspan="2">${s.name}</td></tr>`);
    rows.push(`<tr><td class="k">propellant</td><td class="v">${s.stage.propellant}</td></tr>`);
    rows.push(`<tr><td class="k">engine</td><td class="v">${s.stage.engine}${s.stage.engineCount ? ' ×' + s.stage.engineCount : ''}</td></tr>`);
    rows.push(`<tr><td class="k">material</td><td class="v">${s.stage.material}</td></tr>`);
    rows.push(`<tr><td class="k">delta-v assigned</td><td class="v">${Math.round(s.deltaV).toLocaleString()} m/s</td></tr>`);
    rows.push(`<tr><td class="k">specific impulse</td><td class="v">${Math.round(s.isp)} s</td></tr>`);
    rows.push(`<tr><td class="k">propellant mass</td><td class="v">${fmt(s.propellant)}</td></tr>`);
    rows.push(`<tr><td class="k">dry mass</td><td class="v">${fmt(s.dry)}</td></tr>`);
    if (s.tpsMass > 0) rows.push(`<tr><td class="k">thermal protection</td><td class="v">${fmt(s.tpsMass)}</td></tr>`);
    if (s.landingMass > 0) rows.push(`<tr><td class="k">landing hardware</td><td class="v">${fmt(s.landingMass)}</td></tr>`);
    // Often the single largest reuse cost, and invisible unless it is listed.
    if (s.landingPropellant > 0) {
      rows.push(`<tr><td class="k">landing propellant</td><td class="v">${fmt(s.landingPropellant)}</td></tr>`);
      rows.push(`<tr><td class="k">&nbsp;&nbsp;reserved for</td><td class="v">${Math.round(s.recoveryDv)} m/s</td></tr>`);
    }
    rows.push(`<tr><td class="k">structural coefficient</td><td class="v">${s.eps.toFixed(4)}</td></tr>`);
    rows.push(`<tr><td class="k">length</td><td class="v">${s.geometry.totalLength.toFixed(1)} m</td></tr>`);
    rows.push(`<tr><td class="k">recovery</td><td class="v">${s.stage.recovery}</td></tr>`);
  }
  el.innerHTML = `<table>${rows.join('')}</table>`;
}

/**
 * The archive: every design the search finished with, and every branch it
 * killed, kept whole. The live log scrolls away; this is the record.
 */
function renderArchive(snap) {
  const el = $('archive');
  const rows = snap.archive || [];
  $('archcount').textContent = rows.length ? `(${rows.length})` : '';

  if (!rows.length) {
    el.innerHTML = '<div class="empty">nothing finished yet — results land here as designs close or die</div>';
    return;
  }

  el.innerHTML = rows.map(a => {
    const closed = a.payloadFraction != null;
    const cls = a.status === 'solved' ? 'win' : closed ? '' : 'dead';
    const num = closed ? pct(a.payloadFraction) : 'killed';
    const path = (a.path || []).slice(-3).join(' › ');
    return `<div class="arch">
      <div class="h">
        <span>${a.label}</span>
        <span class="n ${cls}">${num}</span>
      </div>
      ${path ? `<div class="p">${path}</div>` : ''}
      ${closed && a.glow ? `<div class="p">${fmt(a.glow)} on the pad</div>` : ''}
      ${a.blockedReason ? `<div class="why">${a.blockedReason}</div>` : ''}
    </div>`;
  }).join('');
}

// Tab switching between the parts table and the archive.
let tab = 'parts';
function showTab(which) {
  tab = which;
  $('parts').style.display = which === 'parts' ? '' : 'none';
  $('archive').style.display = which === 'archive' ? '' : 'none';
  $('tab-parts').className = which === 'parts' ? 'on' : '';
  $('tab-archive').className = which === 'archive' ? 'on' : '';
}
$('tab-parts').onclick = () => showTab('parts');
$('tab-archive').onclick = () => showTab('archive');

function renderSnapshot(snap) {
  $('best').textContent = snap.bestFraction > 0 ? pct(snap.bestFraction) : '—';
  $('steps').textContent = snap.step;
  $('killed').textContent = snap.counts.blocked;
  $('progress').style.width = Math.min(100, (snap.bestFraction / snap.target) * 100) + '%';

  $('pathline').textContent = snap.currentPath.length
    ? snap.currentPath.slice(-3).map(p => p.label).join(' › ')
    : '';

  const r = snap.bestResult;
  const p = snap.preview;
  // A vehicle is on screen from the first decision, so the header reports how
  // far the design has been specified rather than claiming nothing exists.
  $('vehicleline').textContent = r && r.closed
    ? `${pct(r.payloadFraction)} · ${fmt(r.glow)} liftoff`
    : p?.total
      ? `provisional · ${p.decided}/${p.total} decided · ~${fmt(p.glow)} liftoff`
      : 'nothing decided yet';

  feed.innerHTML = '';
  feedInitialised = true;
  for (const ev of snap.events) feed.append(eventLine(ev));
  feed.scrollTop = feed.scrollHeight;

  renderParts(snap);
  renderArchive(snap);
  drawVehicle(snap.preview, snap.bestResult);

  $('spend').textContent = `$${(snap.spentToday || 0).toFixed(3)} spent today`;
  if (snap.solved) {
    $('statusline').textContent = 'solved — a fully reusable design reached the target';
    $('dot').className = 'dot waiting';
  }
}

function renderStatus(st) {
  const dot = $('dot');
  dot.className = 'dot ' + (st.state || '');
  const line = $('statusline');
  if (st.state === 'thinking') line.textContent = st.inFlight > 1
    ? `grok 4.6 is working on ${st.inFlight} decisions at once`
    : 'grok 4.6 is working on the next decision';
  else if (st.state === 'waiting') line.textContent = 'next decision at ' + clock(st.nextAt);
  else if (st.state === 'idle') line.textContent = 'idle — ' + (st.message || 'nothing to do');
  else if (st.state === 'error') line.textContent = 'stopped — ' + (st.message || 'error');
  if (st.spentToday != null) $('spend').textContent = `$${st.spentToday.toFixed(3)} spent today`;
}

/* --------------------------------------------------------------- transport */

let es;
function connect() {
  es = new EventSource(API + '/api/stream');
  es.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.kind === 'snapshot') renderSnapshot(msg.snapshot);
    else if (msg.kind === 'event' && msg.event.type === 'stream') onStream(msg.event);
    else if (msg.kind === 'event' && msg.event.type === 'stream-end') endStream(msg.event.streamId);
    else if (msg.kind === 'event') {
      appendEvent(msg.event);
      // A result-bearing event changes the numbers, so refresh from the source
      // rather than trying to patch state on the client.
      if (['best', 'solved', 'blocked', 'exhausted', 'branch'].includes(msg.event.type)) {
        fetch(API + '/api/state').then(r => r.json()).then(renderSnapshot).catch(() => {});
      }
    } else if (msg.kind === 'status') renderStatus(msg.status);
  };
  es.onerror = () => {
    $('statusline').textContent = 'reconnecting…';
    $('dot').className = 'dot error';
    es.close();
    setTimeout(connect, 4000);
  };
}
connect();
