// The product drawer's facts block: what the catalogue says (split from product.js, 16 Nov 2026)
import { el, table } from '../ui.js';
import { CONF, FIELD, day } from './fields.js';

// ── what the catalogue says ──
export function factsBlock(ctx, pr, label) {
  const { p, opts } = ctx;
  const w = el('div');
  const facts = el('dl', 'tr-facts');
  const fact = (k, v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return; facts.append(el('dt', null, k), el('dd', null, Array.isArray(v) ? v.join(', ') : String(v))); };
  fact('Active', pr.active_ingredient); fact('Formulation', pr.formulation); fact('Resistance group', pr.moa_group);
  fact('Registration (Act 36 of 1947)', pr.reg_no);
  fact('Against', (pr.targets || []).map(label)); fact('As the source names them', pr.targets_text);
  fact('Crops on the label', pr.crops);
  fact('Rate', pr.rate_text);
  fact('Worked out as', pr.rate_value != null && pr.rate_per ? `${pr.rate_value} ${pr.rate_unit || ''} per ${pr.rate_per}` : 'not a figure the console can multiply — measure from the label');
  fact('Spray volume', pr.water_l_per_ha != null ? pr.water_l_per_ha + ' L/ha' : null);
  const range = (lo, hi, unit) => lo != null && hi != null ? `${lo}–${hi} ${unit}` : hi != null ? `at most ${hi} ${unit}` : lo != null ? `at least ${lo} ${unit}` : null;
  fact('Spray volume on the label', range(pr.water_l_min, pr.water_l_max, 'L/ha'));
  fact('Per hectare', range(pr.dose_min_per_ha, pr.dose_max_per_ha, (pr.rate_unit || '') + '/ha'));
  fact('Withholding period', pr.phi_days != null ? pr.phi_days + ' days (the longest of its crops)' : 'not found — read the label');
  fact('Re-entry', pr.rei_hours != null ? pr.rei_hours + ' h' : null);
  fact('At most', pr.max_applications != null ? pr.max_applications + ' applications' : null);
  fact('Usual interval', pr.interval_days != null ? pr.interval_days + ' days' : null);
  fact('Packs', pr.pack_sizes); fact('Storage', pr.storage); fact('Keeps', pr.shelf_life_days != null ? pr.shelf_life_days + ' days' : null);
  fact('Works when', pr.conditions); fact('Compatibility', pr.compatibility); fact('Protection', pr.ppe); fact('Notes', pr.notes);
  fact('Used by', p.programs ? `${p.programs} program${p.programs === 1 ? '' : 's'} of the library` : null);
  w.append(facts);
  if ((pr.per_crop || []).length) {
    w.append(el('div', 'pd-hlabel', 'Crop by crop, as the label says'));
    w.append(table([{ key: 'crop', label: 'Crop' }, { key: 'targets_text', label: 'Against' }, { key: 'rate_text', label: 'Rate' },
      { key: 'phi_days', label: 'Withholding', align: 'right', fmt: v => v == null ? '?' : v + ' d' }], pr.per_crop));
  }
  if (pr.group_id) w.prepend(el('div', 'hint', `Our own product — seen by ${[opts.farmName || 'this unit', ...(ctx.det.sisters || [])].join(', ')} only.`));
  const st = el('div', 'note ' + (pr.verified_at ? 'ok' : 'warn'), pr.verified_at
    ? `Validated against the label by ${pr.verified_name || 'the franchisor'} on ${day(pr.verified_at)}.`
    : pr.group_id ? 'A product of our own, not validated against its label yet: add its photos and have the AI read them, or edit it.'
    : `Read from ${CONF[pr.confidence] || pr.confidence}; nobody has validated it against the label yet. The label on the pack is the law — this page is a copy.`);
  w.append(st);
  // what this unit and its sisters corrected is theirs: the other franchise farms keep the catalogue's figures (0263)
  const here = [opts.farmName || 'this unit', ...(ctx.det.sisters || [])].join(', ');
  if ((pr.corrected || []).length) w.append(el('div', 'hint', `Changed for ${here}: ${pr.corrected.map(f => FIELD[f] || f).join(', ')}. The other farms of the franchise keep the catalogue's figures.`));
  else if (ctx.det.may_label) w.append(el('div', 'hint', `What you validate here holds for ${here} — the other farms of the franchise keep the catalogue's figures.`));
  const links = el('div', 'tr-links');
  [pr.label_url, ...(pr.source_urls || [])].filter((u, i, a) => u && /^https?:\/\//i.test(u) && a.indexOf(u) === i).forEach((u, i) => {
    const a = el('a', null, i === 0 && pr.label_url ? 'Label' : (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'source'; } })());
    a.href = u; a.target = '_blank'; a.rel = 'noopener'; links.append(a);
  });
  if (links.childElementCount) w.append(el('div', 'pd-hlabel', 'Read from'), links);
  return w;
}
