// ═══════════════════════════════════════════════════════════════════════════
// The photo viewer (migration 0096, console 0.7.98)
//
// One scouting photo — a sticky trap or a plant part — full screen on the
// full-resolution file: wheel or pinch to zoom up to 8×, drag to pan, 1:1 and
// Fit. Beside it: what it is, the person's tags from the pest catalogue, the
// AI's reading with an "Ask the AI" button (nothing is sent by itself), and
// "Compare with…", which lists the same zone's photos by date and opens the
// chosen one in a second pane at the same zoom.
//
//   openViewer({ farm, photo, catalog, zonePhotos, aiReady, mayWrite, onChange })
//     photo       { kind: 'trap' | 'observation', id, taken_at, photo_data, photo_path, tags, … }
//     catalog     the pest catalogue (rpc pest_catalog)
//     zonePhotos  async () → the zone's photos, newest first (rpc zone_photos)
//     onChange    called after a tag or an AI answer, so the page repaints
//     zoneId, cropId, crops   where the photo was taken, for the case section (0097)
//     openCases   async () → the open cases of the zone (rpc cases, filtered)
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn, api, URL_BASE } from './api.js';
import { el, toast, busy, num, selectBox } from './ui.js';
import { newCase, openCase } from './cases.js';

const when = ts => ts ? new Date(ts).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const day = ts => ts ? new Date(ts).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
const SEV = ['none', 'slight', 'clear', 'severe'];
export const partLabel = p => ({ leaf: 'leaf', fruit: 'fruit', root: 'root', stem: 'stem', whole: 'whole plant', other: 'other' })[p] || p || '';

// a signed URL (one hour) for a full photo in the private evidence bucket
export async function fullPhotoUrl(path) {
  if (!path) return null;
  try {
    const res = await api('/storage/v1/object/sign/evidence/' + path, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) });
    return res?.signedURL ? URL_BASE + '/storage/v1' + res.signedURL : null;
  } catch { return null; }
}

export const photoTitle = p => p.kind === 'trap'
  ? `Trap ${p.code}` + (p.total != null ? ` · ${num(p.total, 0)} insects` : '')
  : `${p.crop || 'Plant'} · ${partLabel(p.part)}`;

// the tags on a photo, the person's and the AI's, as one list of chips
export function tagChips(p) {
  const box = el('div', 'vw-chips');
  (p.tags || []).forEach(t => box.append(el('span', 'vw-tag ' + (t.kind || ''), `${t.label || t.code}${t.severity != null ? ' · ' + SEV[t.severity] : ''}`)));
  if (p.kind === 'observation' && p.ai_status === 'done') {
    const f = p.ai?.findings || [];
    if (!f.length && p.ai?.healthy !== false) box.append(el('span', 'vw-tag ai', 'AI: healthy'));
    f.forEach(x => box.append(el('span', 'vw-tag ai ' + (x.kind || ''), `AI: ${x.name || x.code}${x.severity != null ? ' · ' + SEV[x.severity] : ''}`)));
  }
  if (p.kind === 'trap' && p.ai_status === 'done' && Array.isArray(p.species)) {
    p.species.slice(0, 3).forEach(x => box.append(el('span', 'vw-tag ai', `AI: ${x.common || x.name} ${x.count ?? ''}`)));
  }
  return box;
}

export function openViewer(ctx) {
  const { photo, catalog = [], mayWrite = true } = ctx;
  const root = el('div', 'viewer');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', photoTitle(photo));
  const stage = el('div', 'vw-stage');
  const panel = el('aside', 'vw-panel');
  root.append(stage, panel);
  document.body.append(root);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };

  // ── a pane: one photo with its zoom ──
  const panes = [];
  const view = { scale: 0, x: 0, y: 0, fit: true };          // shared by the panes when comparing
  const makePane = p => {
    const pane = el('div', 'vw-pane');
    const img = el('img'); img.alt = photoTitle(p); img.draggable = false;
    img.src = p.photo_data || '';
    const cap = el('div', 'vw-cap', `${photoTitle(p)} · ${day(p.taken_at)}`);
    const state = el('span', 'vw-state', p.photo_path ? 'loading the full photo…' : 'phone copy');
    cap.append(' ', state);
    pane.append(img, cap);
    const o = { pane, img, p, nat: [0, 0] };
    img.onload = () => { o.nat = [img.naturalWidth, img.naturalHeight]; if (view.fit) fitAll(); else apply(); };
    fullPhotoUrl(p.photo_path).then(u => {
      if (!u) { state.textContent = p.photo_path ? 'full photo not reachable' : 'phone copy'; return; }
      const full = new Image();
      full.onload = () => { img.src = u; state.textContent = `${full.naturalWidth} × ${full.naturalHeight}`; };
      full.onerror = () => { state.textContent = 'full photo not reachable'; };
      full.src = u;
    });
    // zoom and pan
    pane.addEventListener('wheel', e => {
      e.preventDefault();
      const r = pane.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015), o);
    }, { passive: false });
    const pts = new Map(); let last = null, dist0 = 0, scale0 = 1;
    pane.addEventListener('pointerdown', e => { pane.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY];
      if (pts.size === 2) { const [a, b] = [...pts.values()]; dist0 = Math.hypot(a[0] - b[0], a[1] - b[1]); scale0 = view.scale; } });
    pane.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const r = pane.getBoundingClientRect();
        const cx = (a[0] + b[0]) / 2 - r.left, cy = (a[1] + b[1]) / 2 - r.top;
        zoomAt(cx, cy, (scale0 * (d / (dist0 || d))) / view.scale, o);
      } else if (last) {
        view.x += e.clientX - last[0]; view.y += e.clientY - last[1]; view.fit = false; last = [e.clientX, e.clientY]; apply();
      }
    });
    const up = e => { pts.delete(e.pointerId); last = pts.size ? [...pts.values()][0] : null; };
    pane.addEventListener('pointerup', up); pane.addEventListener('pointercancel', up);
    pane.addEventListener('dblclick', e => { const r = pane.getBoundingClientRect(); view.scale === 1 && !view.fit ? fitAll() : oneToOne(e.clientX - r.left, e.clientY - r.top, o); });
    panes.push(o);
    stage.append(pane);
    return o;
  };
  const apply = () => panes.forEach(o => { o.img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`; });
  const fitAll = () => {
    const o = panes[0]; if (!o || !o.nat[0]) return;
    const r = o.pane.getBoundingClientRect();
    view.scale = Math.min(r.width / o.nat[0], r.height / o.nat[1]);
    view.x = (r.width - o.nat[0] * view.scale) / 2; view.y = (r.height - o.nat[1] * view.scale) / 2; view.fit = true;
    apply(); paintZoom();
  };
  const zoomAt = (cx, cy, k, o) => {
    if (!o.nat[0]) return;
    const r = o.pane.getBoundingClientRect();
    const fitScale = Math.min(r.width / o.nat[0], r.height / o.nat[1]);
    const next = Math.max(fitScale * 0.5, Math.min(8, view.scale * k));
    const kk = next / view.scale;
    view.x = cx - (cx - view.x) * kk; view.y = cy - (cy - view.y) * kk; view.scale = next; view.fit = false;
    apply(); paintZoom();
  };
  const oneToOne = (cx, cy, o) => zoomAt(cx ?? o.pane.clientWidth / 2, cy ?? o.pane.clientHeight / 2, 1 / view.scale, o);
  const zoomLabel = el('span', 'vw-zoom');
  const paintZoom = () => { zoomLabel.textContent = view.fit ? 'fit' : Math.round(view.scale * 100) + ' %'; };
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') zoomAt(panes[0].pane.clientWidth / 2, panes[0].pane.clientHeight / 2, 1.25, panes[0]);
    else if (e.key === '-') zoomAt(panes[0].pane.clientWidth / 2, panes[0].pane.clientHeight / 2, 0.8, panes[0]);
    else if (e.key === '0') fitAll();
    else if (e.key === '1') oneToOne(null, null, panes[0]);
  };
  document.addEventListener('keydown', onKey);
  const onResize = () => { if (view.fit) fitAll(); };   // removed on close: it kept every viewer and its photo alive
  window.addEventListener('resize', onResize);
  const main = makePane(photo);

  // ── the panel ──
  const head = el('div', 'vw-head');
  head.append(el('h2', null, photoTitle(photo)), el('div', 'hint', `${when(photo.taken_at)}${photo.zone ? ' · ' + photo.zone : ''}`));
  const x = el('button', 'btn btn-ghost btn-sm', '✕'); x.setAttribute('aria-label', 'Close'); x.onclick = close;
  head.append(x);
  const tools = el('div', 'vw-tools');
  const b = (label, f, title) => { const k = el('button', 'btn btn-sm', label); k.onclick = f; if (title) k.title = title; return k; };
  tools.append(b('−', () => zoomAt(main.pane.clientWidth / 2, main.pane.clientHeight / 2, 0.8, main)), zoomLabel,
               b('+', () => zoomAt(main.pane.clientWidth / 2, main.pane.clientHeight / 2, 1.25, main)),
               b('Fit', fitAll, 'the whole photo (0)'), b('1:1', () => oneToOne(null, null, main), 'one pixel of the photo per pixel (1)'));
  panel.append(head, tools, el('div', 'hint', 'Wheel or pinch to zoom, drag to move. Both photos move together when comparing.'));

  // the facts
  const facts = el('div', 'facts');
  const fact = (k, v) => { if (v == null || v === '') return; const f = el('div', 'fact'); f.append(el('span', 'fact-k', k), el('span', 'fact-v', v)); facts.append(f); };
  if (photo.kind === 'trap') {
    fact('Counted', photo.total != null ? num(photo.total, 0) + (photo.corrected ? ' (corrected)' : photo.algo_total != null ? ' by the phone' : '') : '—');
    const c = photo.counts || {};
    fact('By size', ['tiny', 'small', 'medium', 'large'].filter(k => c[k] != null).map(k => `${k} ${c[k]}`).join(' · ') || null);
    if (photo.replaced) fact('Trap', 'replaced on this round');
    if (photo.installed_at) fact('Hung since', day(photo.installed_at));
  } else {
    fact('Crop', photo.crop || '—');
    fact('Part', partLabel(photo.part));
  }
  fact('Note', photo.note);
  panel.append(facts);

  // the person's tags
  const secTags = el('div');
  const paintTags = () => {
    secTags.textContent = '';
    secTags.append(el('div', 'sec-title', 'Tags'));
    const list = el('div', 'vw-chips');
    const tags = photo.tags || [];
    if (!tags.length) list.append(el('span', 'hint', 'No tag yet.'));
    tags.forEach((t, i) => {
      const chip = el('span', 'vw-tag ' + (t.kind || ''), `${t.label || t.code} · ${SEV[t.severity ?? 1]}`);
      if (mayWrite) { const rm = el('button', 'vw-x', '×'); rm.title = 'Remove'; rm.onclick = () => saveTags(tags.filter((_, j) => j !== i)); chip.append(rm); }
      list.append(chip);
    });
    secTags.append(list);
    if (mayWrite && catalog.length) {
      const row = el('div', 'row'); row.style.alignItems = 'center';
      const byKind = ['pest', 'disease', 'disorder', 'beneficial'];
      const opts = [['', 'Add a tag…']];
      byKind.forEach(k => catalog.filter(c => c.kind === k).forEach(c => opts.push([c.code, `${k}: ${c.label}`])));
      const pick = selectBox(opts, '');
      const sev = selectBox([[1, 'slight'], [2, 'clear'], [3, 'severe'], [0, 'none']], 1);
      const add = el('button', 'btn btn-sm', 'Add');
      add.onclick = () => { if (!pick.value) return; saveTags([...tags, { code: pick.value, severity: Number(sev.value) }]); };
      row.append(pick, sev, add);
      secTags.append(row);
    }
  };
  const saveTags = async list => {
    try {
      const saved = await rpc('tag_photo', { p_kind: photo.kind, p_id: photo.id, p_tags: list });
      photo.tags = saved; paintTags(); ctx.onChange?.(photo);
    } catch (e) { toast(e.message, 'bad'); }
  };
  paintTags();
  panel.append(secTags);

  // the AI
  const secAI = el('div');
  const paintAI = () => {
    secAI.textContent = '';
    secAI.append(el('div', 'sec-title', 'The AI'));
    const st = photo.ai_status;
    if (photo.kind === 'observation') {
      if (st === 'done' && photo.ai) {
        const a = photo.ai;
        if (a.quality && a.quality !== 'ok') secAI.append(el('div', 'note warn', 'The photo is ' + a.quality + ' — the reading is less sure.'));
        const f = a.findings || [];
        if (!f.length) secAI.append(el('div', 'vw-ai-line', a.healthy === false ? 'Nothing it could name.' : 'Looks healthy.'));
        f.forEach(x => {
          const line = el('div', 'vw-ai-line');
          line.append(el('b', null, x.name || x.code), ` · ${x.kind} · ${SEV[x.severity ?? 0]}` +
            (x.coverage_pct ? ` · ${num(x.coverage_pct, 0)} % of the ${partLabel(photo.part)}` : '') +
            (x.confidence != null ? ` · ${Math.round(x.confidence * 100)} % sure` : ''));
          if (x.evidence) line.append(el('div', 'hint', x.evidence));
          secAI.append(line);
        });
        if (a.summary) secAI.append(el('p', 'vw-ai-notes', a.summary));
        if (a.recommendation) secAI.append(el('p', 'vw-ai-notes', a.recommendation));
        secAI.append(el('div', 'hint', [photo.ai_model, photo.ai_at ? when(photo.ai_at) : null].filter(Boolean).join(' · ')));
      } else if (st === 'queued') secAI.append(el('div', 'hint', 'Asked — waiting for the answer.'));
      else if (st === 'failed') secAI.append(el('div', 'note bad', 'The AI could not answer: ' + (photo.ai_error || 'unknown error')));
      else secAI.append(el('div', 'hint', 'Not asked yet.'));
    } else {
      if (st === 'done') {
        const list = Array.isArray(photo.species) ? photo.species : [];
        if (!list.length) secAI.append(el('div', 'vw-ai-line', 'Nothing it could name.'));
        list.forEach(x => {
          const line = el('div', 'vw-ai-line');
          line.append(el('b', null, x.common || x.name), ` · ${x.name} · ${num(x.count, 0)}` + (x.confidence != null ? ` · ${Math.round(x.confidence * 100)} % sure` : '') + (x.beneficial ? ' · beneficial' : ''));
          secAI.append(line);
        });
        if (photo.ai_total != null) secAI.append(el('div', 'hint', `${num(photo.ai_total, 0)} insects in all` + (photo.ai_quality && photo.ai_quality !== 'ok' ? ' · photo ' + photo.ai_quality.replace('_', ' ') : '')));
        if (photo.ai_notes) secAI.append(el('p', 'vw-ai-notes', photo.ai_notes));
      } else if (st === 'queued') secAI.append(el('div', 'hint', 'Asked — waiting for the answer.'));
      else if (st === 'failed') secAI.append(el('div', 'note bad', 'The AI could not answer: ' + (photo.ai_error || 'unknown error')));
      else secAI.append(el('div', 'hint', 'Not asked yet.'));
    }
    if (mayWrite) {
      const ask = el('button', 'btn btn-primary btn-sm', st === 'done' ? 'Ask the AI again' : 'Ask the AI');
      ask.title = 'Send this one photo to Claude (Anthropic) — about half a minute';
      ask.onclick = async () => {
        if (ctx.aiReady === false) { toast('Paste an Anthropic API key in Settings › Integrations first', 'bad'); return; }
        busy(ask, true, 'Asking… about half a minute');
        try {
          let res;
          if (photo.kind === 'observation') {
            await rpc('identify_observation', { p_id: photo.id });
            res = await fn('scout-photo', { observation_id: photo.id });
            if (!res?.ok) throw new Error(res?.error || 'no answer');
            Object.assign(photo, res.observation);
          } else {
            await rpc('identify_trap_species', { p_id: photo.id, p_force: true });
            res = await fn('trap-species', { reading_id: photo.id });
            if (!res?.ok) throw new Error(res?.error || 'no answer');
            Object.assign(photo, res.reading);
          }
          paintAI(); toast('The AI answered', 'ok'); ctx.onChange?.(photo);
        } catch (e) { paintAI(); toast(e.message, 'bad'); }
      };
      secAI.append(ask);
    }
  };
  paintAI();
  panel.append(secAI);

  // the cases (0097): add this photo to an open case of the zone, or open one from it
  const secCase = el('div');
  const paintCases = async () => {
    secCase.textContent = '';
    secCase.append(el('div', 'sec-title', 'Cases'));
    let list = [];
    try { list = ctx.openCases ? await ctx.openCases() : []; } catch { list = []; }
    const firstCode = (photo.tags || [])[0]?.code || (photo.ai?.findings || [])[0]?.code || null;
    const firstSev = (photo.tags || [])[0]?.severity ?? (photo.ai?.findings || [])[0]?.severity ?? 1;
    if (!list.length) secCase.append(el('div', 'hint', 'No open case in this zone.'));
    list.forEach(c => {
      const row = el('div', 'vw-case');
      const name = el('button', 'linkish', c.title); name.onclick = () => openCase(c.id, ctx.onChange);
      row.append(name);
      if (mayWrite) {
        const sev = selectBox([[1, 'slight'], [2, 'clear'], [3, 'severe'], [0, 'none left']], firstSev || 1);
        const add = el('button', 'btn btn-sm', 'Add to this case');
        add.onclick = async () => {
          busy(add, true, '…');
          try {
            await rpc('add_case_point', { p_case: c.id, p_kind: photo.kind, p_ref: photo.id, p_severity: Number(sev.value), p_count: null, p_note: null });
            busy(add, false, 'Added ✓'); toast('Added to the case — it is on its curve', 'ok'); ctx.onChange?.(photo);
          } catch (e) { busy(add, false, 'Add to this case'); toast(e.message, 'bad'); }
        };
        row.append(sev, add);
      }
      secCase.append(row);
    });
    if (mayWrite) {
      const open = el('button', 'btn btn-sm', 'Open a case from this photo…');
      open.onclick = () => newCase({ zone_id: ctx.zoneId || null, crop_id: photo.crop_id || ctx.cropId || null, crops: ctx.crops || [],
        from_kind: photo.kind, from_id: photo.id, code: firstCode, severity: firstSev || 1,
        onDone: () => { paintCases(); ctx.onChange?.(photo); } });
      secCase.append(open);
    }
  };
  if (photo.id) { paintCases(); panel.append(secCase); }

  // compare with another photo of the same zone
  const secCmp = el('div');
  secCmp.append(el('div', 'sec-title', 'Compare'));
  const cmpBtn = el('button', 'btn btn-sm', 'Compare with…');
  const cmpList = el('div', 'vw-cmp'); cmpList.hidden = true;
  let second = null;
  const closeCmp = el('button', 'btn btn-sm btn-ghost', 'Close the comparison'); closeCmp.hidden = true;
  closeCmp.onclick = () => { if (second) { second.pane.remove(); panes.splice(panes.indexOf(second), 1); second = null; } root.classList.remove('cmp'); closeCmp.hidden = true; fitAll(); };
  cmpBtn.onclick = async () => {
    if (!cmpList.hidden) { cmpList.hidden = true; return; }
    cmpList.hidden = false; cmpList.textContent = '';
    cmpList.append(el('div', 'hint', 'Reading the zone’s photos…'));
    let list = [];
    try { list = await ctx.zonePhotos?.() || []; } catch (e) { cmpList.textContent = ''; cmpList.append(el('div', 'note bad', e.message)); return; }
    cmpList.textContent = '';
    list = list.filter(p => !(p.kind === photo.kind && p.id === photo.id));
    if (!list.length) { cmpList.append(el('div', 'hint', 'No other photo of this zone in the last four months.')); return; }
    // by date, newest first; a trap's own earlier photos first when this is a trap
    const groups = new Map();
    list.forEach(p => { const d = String(p.taken_at).slice(0, 10); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(p); });
    [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([d, ps]) => {
      cmpList.append(el('div', 'vw-cmp-day', day(d + 'T12:00:00')));
      ps.sort((a, b) => (b.kind === 'trap' && b.code === photo.code) - (a.kind === 'trap' && a.code === photo.code)).forEach(p => {
        const row = el('button', 'vw-cmp-row');
        const im = el('img'); im.src = p.photo_data; im.alt = '';
        row.append(im, el('span', null, p.label || photoTitle(p)));
        row.onclick = () => {
          if (second) { second.pane.remove(); panes.splice(panes.indexOf(second), 1); }
          root.classList.add('cmp');
          second = makePane(p);
          closeCmp.hidden = false; cmpList.hidden = true;
          setTimeout(fitAll, 30);
        };
        cmpList.append(row);
      });
    });
  };
  secCmp.append(cmpBtn, ' ', closeCmp, cmpList);
  panel.append(secCmp);
  setTimeout(fitAll, 30);
  return { close };
}
