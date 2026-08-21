#!/usr/bin/env node
import process from 'node:process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, ROOT } from './env.js';
loadEnv();

import { step, load, save, snapshot, spentToday } from './loop.js';
import { pathTo } from './tree.js';
import { MODEL } from './grok.js';
import { TARGET_PAYLOAD_FRACTION } from '../data/constants.js';

const [cmd = 'help'] = process.argv.slice(2);
const pct = (x) => (x * 100).toFixed(2) + '%';

async function one() {
  const r = await step();
  if (r.error) { console.error('error:', r.error); return false; }
  if (r.skipped) { console.log('skipped:', r.skipped); return false; }
  console.log(`step ${r.state.step}  slot=${r.slot}  ${r.created} option(s), ${r.blocked} blocked  $${r.costUsd.toFixed(4)}`);
  for (const ev of r.state.events.slice(-r.created - 2)) {
    if (['branch', 'blocked', 'backtrack', 'best', 'solved'].includes(ev.type)) {
      console.log('  ' + ev.type.padEnd(9) + ev.message);
    }
  }
  return true;
}

switch (cmd) {
  case 'step':
    await one();
    break;

  case 'loop': {
    const gap = Number(process.env.STEP_SECONDS || 420) * 1000;
    console.log(`looping every ${gap / 1000}s. ctrl-c to stop.`);
    for (;;) {
      await one();
      await new Promise(r => setTimeout(r, gap));
    }
  }

  case 'status': {
    const s = load();
    const snap = snapshot(s);
    console.log(`model        ${MODEL()}`);
    console.log(`key          ${process.env.OPENROUTER_API_KEY ? 'present' : 'MISSING'}`);
    console.log(`target       ${pct(TARGET_PAYLOAD_FRACTION)} payload to LEO, fully reusable`);
    console.log(`best so far  ${snap.bestFraction > 0 ? pct(snap.bestFraction) : 'nothing has closed yet'}`);
    console.log(`decisions    ${snap.step}`);
    console.log(`nodes        ${snap.counts.total} total · ${snap.counts.open} open · ${snap.counts.blocked} blocked · ${snap.counts.complete} closed`);
    console.log(`spent today  $${spentToday(s).toFixed(4)}`);
    console.log(`solved       ${snap.solved ? 'YES' : 'no'}`);
    if (snap.currentPath.length) console.log(`current path ${snap.currentPath.map(p => p.label).join(' > ')}`);
    if (s.lastError) console.log(`last error   ${s.lastError}`);
    break;
  }

  case 'tree': {
    const s = load();
    const mark = { blocked: 'x', solved: '*', complete: 'o', open: '.', expanded: '+', exploring: '>', exhausted: '-' };
    const walk = (id, indent) => {
      const n = s.nodes[id];
      if (!n) return;
      const bound = n.bound != null ? ` [bound ${pct(n.bound)}]` : '';
      const why = n.blockedReason ? `  <- ${n.blockedReason.slice(0, 90)}` : '';
      console.log(`${indent}${mark[n.status] ?? '?'} ${n.label}${bound}${why}`);
      for (const c of n.children) walk(c, indent + '  ');
    };
    walk(0, '');
    break;
  }

  case 'reset':
    rmSync(join(ROOT, 'state', 'loop.json'), { force: true });
    console.log('search reset. the tree is empty.');
    break;

  default:
    console.log(`GROK LOOP

  npm run serve     start the website and the loop
  npm run step      run one decision now
  npm run loop      run continuously in the terminal
  npm run status    counters, spend, current path
  npm run tree      print the whole search tree
  npm run reset     wipe the search and start over
`);
}
