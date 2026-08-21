// The vehicle, drawn from the numbers.
//
// Every dimension here comes from the solver: stage length from propellant
// volume and density, diameter from the design, engine count from the choice.
// Nothing is styled to look impressive — if a stage is stubby it is because the
// propellant is dense, and that is worth seeing.

import * as THREE from 'three';

const COLOUR = {
  'ss-301-fullhard': 0xb8bfc7,
  'al-li-2195': 0x8f9aa6,
  'cfrp-im7': 0x2b2f35,
  'ti-6al-4v': 0x9aa3ad,
  'inconel-718': 0xa8926a,
  _default: 0x8a929c,
};
const TPS_COLOUR = 0x14161a;
const ENGINE_COLOUR = 0x4a5058;

let renderer, scene, camera, group, labelLayer, container;
let spin = 0, hasContent = false;

export function initRocket(el) {
  container = el;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08090b);

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
  camera.position.set(0, 12, 62);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);

  labelLayer = document.createElement('div');
  Object.assign(labelLayer.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden',
  });
  el.appendChild(labelLayer);

  scene.add(new THREE.HemisphereLight(0xdfe7f2, 0x0a0b0d, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(30, 40, 30);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5c2b, 0.8);
  rim.position.set(-30, 10, -20);
  scene.add(rim);

  const grid = new THREE.GridHelper(200, 40, 0x1c2026, 0x121417);
  grid.position.y = 0;
  scene.add(grid);

  group = new THREE.Group();
  scene.add(group);

  resize();
  addEventListener('resize', resize);
  // A window resize event never fires for a container that was simply laid out
  // late — a hidden pane, a slow font, a background tab. Without this the canvas
  // stays at its 300x150 default forever.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(el);
  animate();
}

function resize() {
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (hasContent) { spin += 0.0022; group.rotation.y = spin; }
  renderer.render(scene, camera);
  positionLabels();
}

const labels = [];
function addLabel(text, worldY, side = 1) {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'absolute', whiteSpace: 'nowrap', font: '600 12px ui-monospace, monospace',
    color: '#b3bfcc', transform: 'translate(0,-50%)', textShadow: '0 0 6px #08090b',
  });
  labelLayer.appendChild(el);
  labels.push({ el, worldY, side });
}

function positionLabels() {
  if (!labels.length || !container) return;
  const w = container.clientWidth, h = container.clientHeight;
  for (const l of labels) {
    const v = new THREE.Vector3(0, l.worldY, 0).project(camera);
    const y = (-v.y * 0.5 + 0.5) * h;
    const x = (v.x * 0.5 + 0.5) * w;
    l.el.style.top = y + 'px';
    l.el.style.left = (l.side > 0 ? x + 26 : 8) + 'px';
    l.el.style.opacity = (y > 6 && y < h - 6) ? '1' : '0';
  }
}

function clearGroup() {
  while (group.children.length) {
    const c = group.children.pop();
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  }
  for (const l of labels) l.el.remove();
  labels.length = 0;
}

const fmt = (kg) => kg >= 1e6 ? (kg / 1e6).toFixed(2) + ' kt'
  : kg >= 1000 ? Math.round(kg / 1000) + ' t'
  : Math.round(kg) + ' kg';

/**
 * Draw the vehicle as it currently stands.
 *
 * `preview` is always present, even mid-search, so the rocket assembles itself
 * decision by decision instead of appearing fully formed at the end of a
 * sixteen-step path. Anything not yet chosen renders as a translucent ghost, so
 * the picture never implies a decision that has not been made.
 *
 * `result` is the scored solver output, present only once a design closes. When
 * it exists it supplies the extra detail — thermal protection mass, landing
 * hardware — that a partial design does not have.
 */
export function drawVehicle(preview, result) {
  if (!group) return;
  clearGroup();

  const source = (result?.closed && result.stages?.length) ? result.stages : preview?.stages;
  if (!source?.length) {
    hasContent = false;
    return;
  }
  const complete = Boolean(result?.closed);

  // Scale so the tallest plausible vehicle fits the frame.
  const totalLen = source.reduce((a, s) => a + s.geometry.totalLength, 0);
  const SCALE = Math.min(1, 46 / Math.max(totalLen, 1));

  let y = 0;
  // Stage 0 is the booster and sits at the bottom.
  for (let i = 0; i < source.length; i++) {
    const st = source[i];
    const s = st.stage ?? st;
    const known = st.known ?? {};
    const ghost = !complete && st.provisional;
    const len = st.geometry.totalLength * SCALE;
    const dia = st.geometry.effectiveDiameter * SCALE;
    const r = Math.max(dia / 2, 0.05);

    const materialDecided = complete || known.material;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, Math.max(len, 0.1), 48, 1, false),
      new THREE.MeshStandardMaterial({
        color: materialDecided ? (COLOUR[s.material] ?? COLOUR._default) : 0x39424d,
        metalness: materialDecided ? 0.85 : 0.2,
        roughness: materialDecided ? 0.32 : 0.85,
        transparent: ghost,
        opacity: ghost ? 0.35 : 1,
        wireframe: !complete && !known.propellant,
      }),
    );
    body.position.y = y + len / 2;
    group.add(body);

    // Thermal protection, drawn on the windward face as a dark shell.
    if (s.tps && st.tpsMass > 0) {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.035, r * 1.035, Math.max(len * 0.92, 0.1), 48, 1, true, 0, Math.PI),
        new THREE.MeshStandardMaterial({
          color: TPS_COLOUR, metalness: 0.1, roughness: 0.95, side: THREE.DoubleSide,
        }),
      );
      shell.position.y = y + len / 2;
      group.add(shell);
      addLabel(`${s.tps} · ${fmt(st.tpsMass)}`, y + len * 0.72, -1);
    }

    // Engines.
    const n = Math.min(s.engineCount || (complete ? 1 : 0), 33);
    const bellR = Math.max(r * 0.16, 0.06);
    for (let e = 0; e < n; e++) {
      const ring = n <= 1 ? 0 : (e < 9 ? 0 : 1);
      const inRing = n <= 1 ? 1 : (ring === 0 ? Math.min(n, 9) : n - 9);
      const idx = ring === 0 ? e : e - 9;
      const radius = n <= 1 ? 0 : (ring === 0 ? r * 0.42 : r * 0.78);
      const ang = (idx / inRing) * Math.PI * 2;
      const bell = new THREE.Mesh(
        new THREE.ConeGeometry(bellR, bellR * 2.4, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: ENGINE_COLOUR, metalness: 0.9, roughness: 0.4, side: THREE.DoubleSide }),
      );
      bell.position.set(Math.cos(ang) * radius, y - bellR * 1.2, Math.sin(ang) * radius);
      bell.rotation.x = Math.PI;
      group.add(bell);
    }

    const pending = Object.entries(known).filter(([, v]) => !v).map(([k]) => k);
    addLabel(
      complete
        ? `${st.name} · ${fmt(st.total)} · ${fmt(st.propellant)} propellant`
        : `${st.name} · ${fmt(st.total)}${pending.length ? `  (${pending.join(", ")} undecided)` : ""}`,
      y + len / 2, 1);
    y += len + 0.15;
  }

  // Payload, on top.
  const payR = Math.max((source.at(-1).geometry.effectiveDiameter * SCALE) / 2 * 0.8, 0.1);
  const fairing = new THREE.Mesh(
    new THREE.ConeGeometry(payR, payR * 3, 32),
    new THREE.MeshStandardMaterial({ color: 0xff5c2b, metalness: 0.4, roughness: 0.5 }),
  );
  fairing.position.y = y + payR * 1.5;
  group.add(fairing);
  addLabel(`payload · ${fmt(result?.payloadMass ?? preview?.payloadMass ?? 0)}`, y + payR * 1.5, 1);

  const height = y + payR * 3;
  group.position.y = -height / 2;
  camera.position.set(0, height * 0.12, Math.max(height * 1.5, 30));
  camera.lookAt(0, 0, 0);
  hasContent = true;
}
