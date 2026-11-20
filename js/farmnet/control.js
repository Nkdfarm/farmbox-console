// FarmNet Irrigation, Mixing and Climate pages
import { el } from '../ui.js';
import { setpoints } from './commands.js';
import { mixerButtons } from './overview.js';
import { DAY_SPANS, ask, bad, btn, card, centres, link, nextOf, num, page, range, soft, spanPicker, table, unit } from './shell.js';

// Irrigation is a page of its own since 20 Nov 2026: irrigation.js (the water's way, today's clock, the recipes)

// ═══ Mixing ═════════════════════════════════════════════════════════════════
export async function renderFnMixing(mount, farm, _app, quiet) {
  const go = () => renderFnMixing(mount, farm, null, true);
  await page(mount, farm, 'Mixing: each mixer live, its programs, its runs, and the recipes FarmNet holds.', async (ctx, body) => {
    const { at } = spanPicker('fbc_fn_mix_span', DAY_SPANS, go);
    const cl = await centres(farm);
    const mixers = cl.flatMap(c => (c.status.v?.fertList || []).map(f => ({ c, f })));
    const [per, recipes] = await Promise.all([
      Promise.all(mixers.map(({ c, f }) => Promise.all([
        soft(ask(farm, 'fert_programs', { id: c.id, devId: f.id })),
        soft(ask(farm, 'fert_records', { id: c.id, devId: f.id, ...range(at) })),
      ]))),
      Promise.all(cl.map(c => soft(ask(farm, 'formulas', { id: c.id })))),
    ]);
    cl.filter(c => c.status.e).forEach(c => body.append(bad(`${c.name}: ${c.status.e}`)));
    if (!mixers.length && !cl.some(c => c.status.e)) body.append(el('div', 'note', 'FarmNet lists no mixer.'));
    mixers.forEach(({ c, f }, i) => {
      const [programs, records] = per[i];
      const k = card(`${f.name} — ${c.name}`);
      k.append(unit('Now', !!f.run, f.dataList, ctx.may ? mixerButtons(ctx, c, f) : null, nextOf(f)));
      k.append(el('h4', 'fc-sub', 'Mixing programs'));
      if (programs.e) k.append(bad(programs.e));
      else k.append(table(['Program', 'Mode', 'Recipe', 'Into'], (programs.v || []).map(p => [p.NM, p.MD, p.FNM, p.ST])));
      const recs = records.v?.record || [];
      const vol = recs.reduce((a, r) => a + (num(r.VLM) || 0), 0);
      const sub = el('div', 'fc-head fc-subhead');
      sub.append(el('h4', 'fc-sub', `Runs · ${recs.length} · ${vol.toFixed(2)} m³`), el('div', 'spacer'), spanPicker('fbc_fn_mix_span', DAY_SPANS, go).seg);
      k.append(sub);
      if (records.e) k.append(bad(records.e));
      else k.append(table(['Program', 'Mode', 'Recipe', 'Start', 'End', 'Volume m³', 'How it ended'],
        recs.slice().sort((a, b) => String(b.ST).localeCompare(String(a.ST))).slice(0, 200).map(r => [r.NM, r.MD, r.FNM, r.ST, r.ET, r.VLM, r.SC]), [5]));
      body.append(k);
    });
    cl.forEach((c, i) => {
      const k = card(`Recipes — ${c.name}`, link('#/farmnet/irrigation', 'Open the recipes…'));
      if (recipes[i].e) k.append(bad(recipes[i].e));
      else k.append(table(['Recipe', 'What it holds'], (recipes[i].v || []).map(r => [r.NM, String(r.INF || '').replace(/\s+/g, ' ').trim()])));
      k.append(el('div', 'hint', 'Each recipe is drawn, and changed by the farm admin and farm manager, on the Irrigation tab.'));
      body.append(k);
    });
  }, { commands: true, quiet });
}

// ═══ Climate ════════════════════════════════════════════════════════════════
export async function renderFnClimate(mount, farm) {
  await page(mount, farm, 'Climate: each zone\'s devices and their state, and the setpoints FarmNet works to.', async (ctx, body) => {
    const zs = await ask(farm, 'zones') || [];
    const st = await Promise.all(zs.map(z => soft(ask(farm, 'climate_status', { id: z.id }))));
    if (!zs.length) body.append(el('div', 'note', 'FarmNet lists no climate zone.'));
    const grid = el('div', 'cx-zones');
    zs.forEach((z, i) => {
      const k = el('div', 'card card-pad cx-zone');
      const head = el('div', 'fc-head');
      head.append(el('h3', null, z.name), el('div', 'spacer'), btn(ctx.may ? 'Setpoints…' : 'Settings…', () => setpoints(ctx, z, st[i].v)));
      k.append(head);
      if (st[i].e) { k.append(bad(st[i].e)); grid.append(k); return; }
      (st[i].v?.typeList || []).forEach(t => {
        const g = el('div', 'cx-kind'); g.append(el('div', 'cx-kind-label', t.typeName));
        const row = el('div', 'fc-devs');
        (t.devList || []).forEach(dv => {
          const on = Number(dv.value) > 0;
          row.append(el('span', 'pill ' + (on ? 'ok' : ''), `${dv.name} ${on ? (Number(dv.value) === 1 ? 'on' : dv.value + '%') : 'off'}`));
        });
        g.append(row); k.append(g);
      });
      grid.append(k);
    });
    body.append(grid);
  }, { commands: true });
}
