// ═══════════════════════════════════════════════════════════════════════════
// FarmNet › Overview — the site in 3D, live (owner, 5 Nov 2026: "use this 3d for a nice navigable 3d model on
// the overview page farmnet"; the model: "Philippi V6.5 3D.step", cleaned to a .glb: "ablution, shelter could be
// simplified"; kept in the private bucket farm-models, migration 0273).
//
// three.js 0.160.0 (MIT) from jsdelivr, loaded only when the 3D view opens (the import map in index.html names
// "three" and "three/addons/"). The model (6.6 MB: 369 000 triangles of the STEP's 20.6 million — the office,
// ablutions, shelters and containers are blocks) is fetched with a signed address once per computer and kept in
// the cache fbc-data-models, which sign-out empties (api.js forgetAll). A new model gets a new file name (MODEL).
// FarmBox1's bays are the solids FB1_Span_Volume_01…08 (Bay n = volume n), tinted by the bay's temperature;
// its roof vents FB1_Vent_0n_N/S (over span n), drawn bluer the more they are open — the first of the bay's two
// FarmNet vents is taken as N, the second as S (assumed, as on the plan). A label over each bay: temperature,
// humidity, a drop while it is watered. Click a bay: the same drawer as the plan.
// The view lives across the Overview's minute: the canvas is kept and only the colours and labels change.
// ═══════════════════════════════════════════════════════════════════════════
import { api, URL_BASE } from './api.js';
import { el, toast } from './ui.js';

const BUCKET = 'farm-models';
const views = new Map();          // farm id → the view (one WebGL context a farm, kept between redraws)
let epoch = 0;                    // drop3d() moves it on: a load from before draws and keeps nothing

const MODEL = 'site-20261105.glb';      // Philippi V6.5, cleaned (5 Nov 2026)
const KEEP = 'fbc-data-models';         // sw.js leaves fbc-data* alone; sign-out deletes it

let THREE, GLTFLoader, OrbitControls, CSS2DRenderer, CSS2DObject;
async function libs() {
  if (THREE) return;
  [THREE, { GLTFLoader }, { OrbitControls }, { CSS2DRenderer, CSS2DObject }] = await Promise.all([
    import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/controls/OrbitControls.js'),
    import('three/addons/renderers/CSS2DRenderer.js'),
  ]);
}

// the model's bytes: this computer's copy, or the bucket through a signed address (then kept)
async function modelBytes(farm, mine) {
  const path = `${farm.id}/${MODEL}`, key = 'https://models.farmbox/' + path;
  try { const hit = await (await caches.open(KEEP)).match(key); if (hit) return await hit.arrayBuffer(); } catch { /* no Cache API */ }
  const res = await api(`/storage/v1/object/sign/${BUCKET}/${path}`, { method: 'POST', body: JSON.stringify({ expiresIn: 600 }), quiet: true });
  if (!res?.signedURL) throw new Error('the model is not there yet');
  const got = await fetch(URL_BASE + '/storage/v1' + res.signedURL);
  if (!got.ok) throw new Error(`the model could not be read (${got.status})`);
  const buf = await got.arrayBuffer();
  if (mine === epoch) {
    try { await (await caches.open(KEEP)).put(key, new Response(buf.slice(0), { headers: { 'Content-Type': 'model/gltf-binary' } })); } catch { /* kept for this visit only */ }
  }
  return buf;
}
const forgetCopy = async farm => { try { await (await caches.open(KEEP)).delete('https://models.farmbox/' + `${farm.id}/${MODEL}`); } catch { /* nothing kept */ } };
// the same reading rule as the plan (farmnet.js valueOf): null, '' and FarmNet's "no sensor" values are no reading
const reading = (real, s) => {
  if (!s) return null;
  const raw = real.find(r => r.id === s.id)?.value;
  if (raw === null || raw === undefined || raw === '') return null;
  const x = Number(raw);
  return Number.isFinite(x) && x !== 65535 && x !== -100 ? x : null;
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const KIND = {
  steel: { color: 0x9aa3ab, metalness: 0.6, roughness: 0.45 },
  film:  { color: 0xf2f6f8, transparent: true, opacity: 0.16, roughness: 0.2, depthWrite: false, side: 2 },
  vent:  { color: 0xd9e2e8, transparent: true, opacity: 0.55, roughness: 0.3, side: 2 },
  road:  { color: 0x4a4d52, roughness: 0.95 },
  water: { color: 0x5b8fb5, roughness: 0.5 },
  power: { color: 0xd18a3a, roughness: 0.6 },
  other: { color: 0xc9c2b4, roughness: 0.85 },
};

// the view of one farm: { el, update(plan, real, onBay) }
export function site3d(farm, fresh = false) {
  let v = views.get(farm.id);
  if (v && v.failed && fresh) { views.delete(farm.id); v = null; }
  if (v) return v;
  const box = el('div', 'f3-box');
  const stage = el('div', 'f3-stage');
  const bar = el('div', 'f3-bar');
  const note = el('div', 'f3-note', 'Loading the 3D model…');
  box.append(stage, bar, note);
  const btn = (label, fn, pressed) => {
    const b = el('button', 'btn btn-sm', label); b.type = 'button';
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.onclick = () => fn(b); bar.append(b); return b;
  };
  const st = { ready: false, pending: null, bays: new Map(), vents: new Map(), labels: new Map(), films: [], all: null, fb1: null, onBay: null };
  let renderer, labeller, scene, camera, controls, observer, frame = 0;
  const mine = epoch;
  v = {
    el: box,
    update: (plan, real, onBay) => { st.pending = { plan, real }; st.onBay = onBay; if (st.ready) paint(); },
    // free the GPU and the memory: sign-out, or a load that failed
    dispose: (keepBox = false) => {
      observer?.disconnect();
      scene?.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
      st.ready = false; renderer?.domElement.remove(); labeller?.domElement.remove();
      if (!keepBox) box.remove();
    },
  };
  views.set(farm.id, v);
  // controls.update() fires "change" while damping settles, so a drawn frame asks for the next one until it stops
  const draw = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; if (!box.isConnected || !st.ready) return; controls.update(); renderer.render(scene, camera); labeller.render(scene, camera); }); };

  (async () => {
    let bytes = null;
    try {
      try { await libs(); } catch { throw new Error('three.js could not be loaded (no internet?)'); }
      bytes = await modelBytes(farm, mine);
      const gltf = await new GLTFLoader().parseAsync(bytes, '').catch(async e => { await forgetCopy(farm); throw new Error('the model file is damaged; it is fetched again next time'); });
      if (mine !== epoch) return;              // signed out meanwhile
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      labeller = new CSS2DRenderer(); labeller.domElement.className = 'f3-labels';
      stage.append(renderer.domElement, labeller.domElement);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-60, 120, 80); scene.add(sun);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.addEventListener('change', draw);

      const root = gltf.scene;
      root.rotation.x = -Math.PI / 2;            // the model is Z up (metres), three is Y up
      scene.add(root);
      root.updateMatrixWorld(true);
      root.traverse(o => {
        if (!o.isMesh) return;
        const n = o.name || o.parent?.name || '';
        let m;
        const bay = n.match(/^FB1_Span_Volume_(\d+)/), vent = n.match(/^FB1_Vent_(\d+)_([NS])/);
        if (bay) {
          m = new THREE.MeshStandardMaterial({ color: 0x9ab0bf, transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.6, flatShading: true });
          o.userData.bay = Number(bay[1]); st.bays.set(Number(bay[1]), o); o.renderOrder = 2;
        } else if (vent) {
          m = new THREE.MeshStandardMaterial({ ...KIND.vent, flatShading: true }); st.vents.set(`${Number(vent[1])}${vent[2]}`, o);
        } else {
          const k = (n.split('__')[1] || 'other').replace(/_\d+$/, '');   // FB1__steel, site__road… (build_glb.py)
          m = new THREE.MeshStandardMaterial({ ...(KIND[k] || KIND.other), flatShading: true });
          if (k === 'film') { st.films.push(o); o.renderOrder = 3; }
        }
        o.material = m;
      });
      st.all = new THREE.Box3().setFromObject(root);
      st.fb1 = new THREE.Box3(); st.bays.forEach(o => st.fb1.expandByObject(o));
      if (st.fb1.isEmpty()) st.fb1 = st.all.clone();
      // a label over each bay
      st.bays.forEach((o, n) => {
        const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
        const tag = el('button', 'f3-tag'); tag.type = 'button';
        tag.onclick = () => st.onBay?.(n);
        const lab = new CSS2DObject(tag); lab.position.set(c.x, b.max.y + 1.2, c.z);
        scene.add(lab); st.labels.set(n, tag);
      });
      // click a bay volume
      const ray = new THREE.Raycaster(), p = new THREE.Vector2();
      let down = null;
      renderer.domElement.addEventListener('pointerdown', e => { down = e.button === 0 ? [e.clientX, e.clientY] : null; });
      renderer.domElement.addEventListener('pointerup', e => {
        if (e.button !== 0 || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
        const r = renderer.domElement.getBoundingClientRect();
        p.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(p, camera);
        const hit = ray.intersectObjects([...st.bays.values()], false)[0];
        if (hit) st.onBay?.(hit.object.userData.bay);
      });

      const frameOn = (b3, from) => {
        const c = b3.getCenter(new THREE.Vector3()), s = b3.getSize(new THREE.Vector3()).length();
        controls.target.copy(c);
        camera.position.copy(c).add(from.clone().normalize().multiplyScalar(s * 0.95));
        camera.near = Math.max(0.1, s / 500); camera.far = s * 20; camera.updateProjectionMatrix(); draw();
      };
      const fb1View = () => frameOn(st.fb1, new THREE.Vector3(0.55, 0.75, 0.9));
      btn('FarmBox1', fb1View);
      btn('Whole site', () => frameOn(st.all, new THREE.Vector3(0.4, 0.9, 0.7)));
      btn('From above', () => frameOn(st.fb1, new THREE.Vector3(0.001, 1, 0.0001)));
      btn('Roof & walls', b => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); st.films.forEach(o => { o.visible = on; }); draw(); }, true);

      const size = () => {
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!w || !h) return;                      // off the page for a moment (the minute's re-read): nothing to size
        renderer.setSize(w, h); labeller.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); draw();
      };
      observer = new ResizeObserver(size); observer.observe(stage);
      st.ready = true;
      size(); fb1View();
      note.remove();
      if (st.pending) paint();
    } catch (e) {
      // the view stays, failed, until the page is opened again: the minute's re-read does not retry (nor leak a context)
      v.dispose(true); if (!note.isConnected) box.append(note);
      bar.textContent = '';
      note.textContent = `The 3D view could not open: ${e.message}. The Plan above shows the same live values.`; note.classList.add('bad');
      v.failed = true;
    }
  })();

  function paint() {
    const { plan, real } = st.pending;
    const val = s => reading(real, s);
    const hue = t => Math.max(0, Math.min(210, 210 - (t - 12) * 10.5));
    plan.bays.forEach(b => {
      const main = b.sensors.find(x => val(x.t) !== null) || b.sensors[0];
      const t = main ? val(main.t) : null, rh = main ? val(main.rh) : null;
      const o = st.bays.get(b.n);
      if (o) {
        if (t === null) { o.material.color.set(0x9ab0bf); o.material.opacity = 0.15; }
        else { o.material.color.setHSL(hue(t) / 360, 0.75, 0.5); o.material.opacity = 0.32; }
      }
      // the bay's FarmNet windows on the model's two vents: the first over N, the second over S (assumed); a bay with one
      // window (Bays 1–4 since 0.7.296) shows it on both
      ['N', 'S'].forEach((side, i) => {
        const vo = st.vents.get(`${b.n}${side}`), src = b.vents.length === 1 ? b.vents[0] : b.vents[i];
        if (!vo) return;
        const open = src ? val(src.s) : null;
        if (open === null) { vo.material.color.set(0xd9e2e8); vo.material.opacity = 0.55; }
        else { vo.material.color.setHSL(0.55, Math.min(1, 0.25 + open / 100), 0.75 - open / 400); vo.material.opacity = 0.55 + open / 250; }
      });
      const tag = st.labels.get(b.n);
      if (tag) {
        const water = b.valves.some(x => (val(x.s) || 0) > 0);
        const openMax = Math.max(0, ...b.vents.map(x => val(x.s) || 0));
        tag.className = 'f3-tag' + (water ? ' wet' : '');
        tag.textContent = '';
        tag.append(el('b', null, `Bay ${b.n}`), el('span', null, t === null ? 'no sensor' : `${t.toFixed(1)}° · ${rh === null ? '—' : Math.round(rh) + '%'}`),
          el('small', null, `${water ? '💧 watering · ' : ''}vents ${Math.round(openMax)}%`));
        tag.title = `Bay ${b.n}: its details and its last 24 h`;
      }
    });
    if (renderer) { renderer.render(scene, camera); labeller.render(scene, camera); }
  }
  return v;
}

// sign-out: every view goes (GPU, memory, labels), and a load still on its way keeps nothing (app.js doSignOut)
export function drop3d() {
  epoch++;
  views.forEach(v => v.dispose());
  views.clear();
}
