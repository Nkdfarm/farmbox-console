// FarmNet commands: run, start irrigation / mixing, pause, resume, stop, setpoints
import { el, drawer, field, selectBox, toast, busy, confirmDrawer, loading, emptyState } from '../ui.js';
import { ask, bad, num, secs, show } from './shell.js';
import { runCommand, tagCmd } from '../registry.js';

// ═══ Commands to FarmNet ════════════════════════════════════════════════════
// each one a command of the registry (registry.js, console 0.18.00): checked, run, and heard by the operation log (P4)
async function run(ctx, action, args, changes, okText) {
  try {
    const r = await runCommand(action, changes == null ? args : { ...args, changes }, { actor: 'human', ctx });
    toast(`${okText} — FarmNet: ${r?.msg || 'OK'}`, 'ok');
  } catch (e) {
    toast(e.message, 'bad');
    return false;   // the caller keeps its drawer and what was typed
  }
  setTimeout(ctx.redraw, 1200);   // FarmNet takes a moment to show the new state
  return true;
}

export async function startIrrigation(ctx, c) {
  const d = drawer('Start an irrigation program', `${c.name} · by hand, now`);
  d.body.append(loading('Reading the programs…'));
  let list;
  try { list = await ask(ctx.farm, 'irrigation_manual', { id: c.id }) || []; } catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  if (!list.length) { d.body.append(el('div', 'note', 'FarmNet lists no program to start by hand.')); return; }
  const what = p => (p.SRC || []).map(s => `${s.NM}${s.FNM && s.FNM !== 'None' ? ' (' + s.FNM + ')' : ''}: ` +
    (s.VALVE || []).map(v => `${v.NM} ${secs(v.ATM ?? v.STM)}`).join(', ')).join(' · ');
  const sel = selectBox(list.map(p => [String(p.ID), p.NM]), String(list[0].ID));
  const info = el('div', 'hint');
  const paint = () => { info.textContent = what(list.find(p => String(p.ID) === sel.value) || {}); };
  sel.onchange = paint; paint();
  d.body.append(field('Program', sel), info);
  const go = tagCmd(el('button', 'btn btn-primary', 'Start…'), 'irrigation_program_start');
  go.onclick = async () => {
    if (go.disabled) return; go.disabled = true;
    const p = list.find(x => String(x.ID) === sel.value);
    if (!(await confirmDrawer('Start this program now?', `"${p.NM}" starts on ${c.name} at once — ${what(p)}.`, 'Start it'))) { go.disabled = false; return; }
    busy(go, true, 'Sending…');
    if (await run(ctx, 'irrigation_program_start', { id: c.id, proId: p.ID }, null, `Started "${p.NM}"`)) d.close();
    else { busy(go, false, 'Start…'); }
  };
  d.footer.append(go);
}

export async function startMixing(ctx, c, f) {
  const d = drawer('Start a mixing program', `${c.name} · ${f.name} · by hand, now`);
  d.body.append(loading('Reading the programs…'));
  let list;
  try { list = await ask(ctx.farm, 'fert_manual', { id: c.id, devId: f.id }) || []; } catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  if (!list.length) { d.body.append(el('div', 'note', 'FarmNet lists no mixing program for this mixer.')); return; }
  const sel = selectBox(list.map(p => [String(p.ID), `${p.NM} — recipe ${p.FNM || 'none'} → ${p.TNM || '—'}`]), String(list[0].ID));
  const mins = el('input', 'input'); mins.type = 'number'; mins.min = '1'; mins.max = '1440'; mins.step = '1'; mins.value = '10';
  d.body.append(field('Program', sel), field('Run time (minutes)', mins, 'Sent to FarmNet in seconds.'));
  const go = tagCmd(el('button', 'btn btn-primary', 'Start…'), 'fert_program_start');
  go.onclick = async () => {
    if (go.disabled) return;
    const p = list.find(x => String(x.ID) === sel.value), m = Math.round(Number(mins.value));
    if (!(m >= 1 && m <= 1440)) { toast('Run time: 1 to 1440 minutes', 'bad'); return; }
    go.disabled = true;
    if (!(await confirmDrawer('Start mixing now?', `"${p.NM}" starts on ${f.name} for ${m} min.`, 'Start it'))) { go.disabled = false; return; }
    busy(go, true, 'Sending…');
    if (await run(ctx, 'fert_program_start', { id: c.id, proId: p.ID, runTime: m * 60 }, null, `Started "${p.NM}"`)) d.close();
    else { busy(go, false, 'Start…'); }
  };
  d.footer.append(go);
}

export function pause(ctx, c, f) {
  const what = f ? `mixing on ${f.name}` : `irrigation on ${c.name}`;
  const d = drawer('Pause ' + (f ? 'mixing' : 'irrigation'), what, { emergency: true });   // never locked by an AI build (P5)
  const mins = el('input', 'input'); mins.type = 'number'; mins.min = '1'; mins.max = '1440'; mins.step = '1'; mins.value = '30';
  d.body.append(field('For how long (minutes)', mins, 'It resumes by itself after this, or with Resume.'));
  const go = tagCmd(el('button', 'btn btn-primary', 'Pause…'), f ? 'fert_pause' : 'irrigation_pause');
  go.onclick = async () => {
    if (go.disabled) return;
    const m = Math.round(Number(mins.value));
    if (!(m >= 1 && m <= 1440)) { toast('1 to 1440 minutes', 'bad'); return; }
    go.disabled = true;
    if (!(await confirmDrawer('Pause now?', `Pause ${what} for ${m} min.`, 'Pause', false, { emergency: true }))) { go.disabled = false; return; }
    busy(go, true, 'Sending…');
    const ok = await (f ? run(ctx, 'fert_pause', { id: c.id, devId: f.id, pTime: m * 60 }, null, 'Paused')
                        : run(ctx, 'irrigation_pause', { id: c.id, pTime: m * 60 }, null, 'Paused'));
    if (ok) d.close(); else busy(go, false, 'Pause…');
  };
  d.footer.append(go);
}

// one confirm-then-send at a time: a double click on Resume or Stop opened two drawers and sent the command twice
let confirming = false;
export async function resume(ctx, c, f) {
  if (confirming) return;
  confirming = true;
  try {
    const what = f ? `mixing on ${f.name}` : `irrigation on ${c.name}`;
    if (!(await confirmDrawer('Resume now?', `Resume ${what}.`, 'Resume', false, { emergency: true }))) return;
    await (f ? run(ctx, 'fert_resume', { id: c.id, devId: f.id }, null, 'Resumed')     // FarmNet's pause for 0 s
             : run(ctx, 'irrigation_resume', { id: c.id }, null, 'Resumed'));
  } finally { confirming = false; }
}

export async function stop(ctx, c, f) {
  if (confirming) return;
  confirming = true;
  try {
    const what = f ? `the mixing that runs on ${f.name}` : `the irrigation that runs on ${c.name}`;
    if (!(await confirmDrawer('Stop the current run?', `Stop ${what} now. The programs stay as they are and start again at their next time.`, 'Stop it', true, { emergency: true }))) return;
    await (f ? run(ctx, 'fert_stop', { id: c.id, devId: f.id, type: 0 }, null, 'Stopped')
             : run(ctx, 'irrigation_stop', { id: c.id, type: 0 }, null, 'Stopped'));
  } finally { confirming = false; }
}

export async function setpoints(ctx, z, st) {
  const types = (st?.typeList || []).map(t => [String(t.typeId), t.typeName]);
  const d = drawer(ctx.may ? 'Climate setpoints' : 'Climate settings', `${z.name} · as FarmNet holds them`);
  if (!types.length) { d.body.append(el('div', 'note', 'FarmNet lists no device in this zone.')); return; }
  const sel = selectBox(types, types[0][0]);
  const box = el('div');
  d.body.append(field('Device type', sel), box);
  // inputs belong to the device type that was read last: a quick second choice must not mix two trees
  let tree = [], inputs = [], typeId = null, seq = 0;
  const load = async () => {
    const mine = ++seq, t = Number(sel.value);
    box.textContent = ''; box.append(loading('Reading the parameters…'));
    inputs = []; typeId = null;
    let got;
    try { got = (await ask(ctx.farm, 'climate_params', { ghId: z.id, typeId: t }))?.funList || []; }
    catch (e) { if (mine === seq) { box.textContent = ''; box.append(bad(e.message)); } return; }
    if (mine !== seq) return;
    tree = got; typeId = t;
    box.textContent = '';
    tree.forEach(fun => (fun.devList || []).forEach(dev => {
      const ps = (dev.paramList || []).filter(p => p.SF !== 0);
      if (!ps.length) return;
      const sec = el('div', 'fc-params');
      sec.append(el('div', 'cx-kind-label', `${dev.name} · ${fun.name}`));
      ps.forEach(p => {
        const row = el('div', 'fc-param');
        row.append(el('span', null, p.N));
        const editable = ctx.may && p.EEN !== false;
        if (!editable) {
          const opt = (p.CLT || []).find(o => String(o.V) === String(num(p.V)));
          row.append(el('b', null, opt ? opt.N : show(p.V, p.U)));
        } else if ((p.CLT || []).length) {
          const s = selectBox(p.CLT.map(o => [String(o.V), o.N]), String(num(p.V)));
          inputs.push({ fun, dev, p, read: () => Number(s.value) });
          row.append(s);
        } else {
          const i = el('input', 'input'); i.type = 'number';
          i.value = String(num(p.V) ?? ''); if (num(p.L) !== null) i.min = String(num(p.L)); if (num(p.H) !== null) i.max = String(num(p.H));
          i.step = Number.isInteger(p.D) && p.D > 0 ? String(10 ** -p.D) : '1';
          const u = el('span', 'hint', `${p.U || ''} (${num(p.L) ?? '…'} – ${num(p.H) ?? '…'})`);
          inputs.push({ fun, dev, p, read: () => (i.value.trim() === '' ? num(p.V) : Number(i.value)) });   // emptied = unchanged, not 0
          row.append(i, u);
        }
        sec.append(row);
      });
      box.append(sec);
    }));
    if (!box.childNodes.length) box.append(emptyState('No parameter shown for this device type.'));
  };
  sel.onchange = load;
  await load();
  if (!ctx.may) return;
  const save = tagCmd(el('button', 'btn btn-primary', 'Save…'), 'climate_set');
  save.onclick = async () => {
    if (save.disabled) return;
    if (typeId === null) { toast('The parameters are still being read'); return; }
    const changes = inputs.filter(x => Number.isFinite(x.read()) && x.read() !== num(x.p.V))
      .map(x => ({ funId: x.fun.id, devId: x.dev.id, param: x.p.N, value: x.read(), from: num(x.p.V), unit: x.p.U || '', dev: x.dev.name }));
    if (!changes.length) { toast('Nothing changed'); return; }
    // the limits are FarmNet's own (L … H); the function checks them again before sending
    const out = inputs.find(x => changes.some(c => c.param === x.p.N && c.devId === x.dev.id && c.funId === x.fun.id)
      && ((num(x.p.L) !== null && x.read() < num(x.p.L)) || (num(x.p.H) !== null && x.read() > num(x.p.H))));
    if (out) { toast(`${out.p.N} must be between ${num(out.p.L)} and ${num(out.p.H)}`, 'bad'); return; }
    const list = changes.map(c => `${c.dev} ${c.param}: ${c.from} → ${c.value} ${c.unit}`.trim()).join(' · ');
    save.disabled = true;
    const sentType = typeId;
    if (!(await confirmDrawer(`Change ${changes.length} setpoint${changes.length === 1 ? '' : 's'} on FarmNet?`, `${z.name} — ${list}`, 'Change them'))) { save.disabled = false; return; }
    busy(save, true, 'Sending…');
    const sent = await run(ctx, 'climate_set', { ghId: z.id, typeId: sentType },
      changes.map(({ funId, devId, param, value }) => ({ funId, devId, param, value })), `${changes.length} setpoint${changes.length === 1 ? '' : 's'} changed`);
    if (sent) d.close(); else { busy(save, false, 'Save…'); }
  };
  d.footer.append(save);
}
