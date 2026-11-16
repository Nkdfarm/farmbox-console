// The product drawer's side effects on beneficials block (split from product.js, 16 Nov 2026)
import { rpc } from '../api.js';
import { el, drawer, toast, busy, input, field, selectBox, table, loading, confirmDrawer } from '../ui.js';
import { EFFECT, EFFECT_PILL, day, errText } from './fields.js';

// ── the history ──
// ── Side effects on beneficials (0267): read on their own, so the drawer opens without waiting for them ──
export function effectsBlock(ctx, pr) {
  const { farm } = ctx;
  const ben = pr.kind === 'beneficial';
  const w = el('section', 'lb-sec lb-effects');
  const head = el('div', 'lb-head');
  head.append(el('div', 'pd-hlabel', ben ? 'Sprays known to touch it' : 'Side effects on beneficials'));
  const body = el('div');
  w.append(head, body);
  body.append(loading('Reading the side effects…'));
  const paintFx = fx => {
    body.textContent = '';
    head.querySelectorAll('button').forEach(b => b.remove());
    const may = !ben && (fx.may_change || fx.may_catalogue);
    const rows = ben ? fx.on_this : fx.as_spray;
    if (!rows.length) {
      body.append(el('div', 'hint', ben ? 'No spray has a side effect recorded on it yet.'
        : 'None recorded yet. Where beneficials are released, the treatment\'s preview says "not known yet" for a chemical, mineral or adjuvant spray.'));
    } else {
      body.append(table([
        { key: ben ? 'product' : 'beneficial', label: ben ? 'Spray' : 'Beneficial', fmt: (v, r) => {
          const s = el('span');
          s.append(v || el('i', null, `${r.species} (every product)`));
          if (r.own) s.append(' ', el('span', 'pill info', 'ours'));
          return s;
        } },
        { key: 'rating', label: 'Effect', fmt: v => el('span', 'pill ' + (EFFECT_PILL[v] || 'info'), EFFECT[v] || v) },
        { key: 'persistence_days', label: 'Lasts', align: 'right', fmt: v => v == null ? '—' : v + ' d' },
        { key: 'source', label: 'Read in', fmt: (v, r) => [v, r.note].filter(Boolean).join(' · ') || '—' },
        { key: 'checked_at', label: 'By', fmt: (v, r) => [r.checked_name, v ? day(v) : null].filter(Boolean).join(', ') },
        ...(may ? [{ key: 'id', label: '', fmt: (v, r) => {
          if (r.own ? !fx.may_change : !fx.may_catalogue) return '';
          const b = el('span');
          const ed = el('button', 'btn btn-sm btn-ghost', 'Change');
          ed.onclick = () => effectForm(fx, r);
          const rm = el('button', 'btn btn-sm btn-ghost', 'Remove');
          rm.onclick = async () => {
            if (!await confirmDrawer('Remove this side effect?', `${r.beneficial || r.species}: ${EFFECT[r.rating] || r.rating}${r.own ? '' : ' — the catalogue\'s, for every farm'}.`, 'Remove', true)) return;
            busy(rm, true, 'Removing…');
            try { paintFx(await rpc('remove_side_effect', { p_farm: farm.id, p_id: r.id })); toast('Removed', 'ok'); }
            catch (e) { busy(rm, false); toast(errText(e), 'bad'); }
          };
          b.append(ed, rm);
          return b;
        } }] : []),
      ], rows));
    }
    if (may) {
      const add = el('button', 'btn btn-sm', 'Add a side effect');
      add.onclick = () => effectForm(fx, null);
      head.append(add);
    }
  };
  // one side effect: a beneficial product or every product of its species, the effect, how long, where it was read
  const effectForm = (fx, r) => {
    const e = drawer(r ? 'Change a side effect' : 'Add a side effect', `${pr.name} on a beneficial`);
    const species = [...new Set(fx.beneficials.map(b => b.species).filter(Boolean))].sort();
    const who = selectBox([['', 'Choose…'], ...fx.beneficials.map(b => [b.id, b.name + (b.species ? ` — ${b.species}` : '')]),
      ...species.map(s => ['sp:' + s, `Every product of ${s}`])], r ? (r.beneficial_id || 'sp:' + r.species) : '');
    const rating = selectBox(Object.entries(EFFECT), r?.rating || 'harmful');
    const days = input({ type: 'number', min: 0, max: 365, step: 1, value: r?.persistence_days ?? '' });
    const source = input({ placeholder: 'e.g. the supplier\'s side-effects list, 2026; the label', value: r?.source || '' });
    const note = el('textarea'); note.rows = 2; note.value = r?.note || '';
    const cat = input({ type: 'checkbox' });
    const cw = el('label', 'lb-check');
    cw.append(cat, el('span', null, 'For the catalogue: every farm sees it'));
    e.body.append(field('Beneficial', who), field('Effect', rating), field('It lasts, days', days), field('Read in', source), field('Note', note));
    if (!r && fx.may_catalogue && fx.may_change) e.body.append(cw);
    if (!r && !fx.may_change) cat.checked = true;
    const save = el('button', 'btn btn-primary', 'Save');
    save.onclick = async () => {
      if (!who.value) { toast('Choose the beneficial', 'bad'); return; }
      const sp = who.value.startsWith('sp:') ? who.value.slice(3) : null;
      busy(save, true, 'Saving…');
      try {
        paintFx(await rpc('save_side_effect', { p_farm: farm.id, p: { id: r?.id, product_id: pr.id, beneficial_id: sp ? null : who.value, species: sp,
          rating: rating.value, persistence_days: days.value, source: source.value, note: note.value, catalogue: r ? !r.own : cat.checked } }));
        toast('Saved', 'ok');
        e.close();
      } catch (er) { busy(save, false); toast(errText(er), 'bad'); }
    };
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = e.close;
    e.footer.append(save, el('span', 'spacer'), cancel);
  };
  rpc('product_side_effects', { p_farm: farm.id, p_product: pr.id }).then(paintFx)
    .catch(e => { body.textContent = ''; body.append(el('div', 'note bad', errText(e))); });
  return w;
}
