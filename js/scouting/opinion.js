// Scouting page: the AI opinion card of a zone
import { rpc, fn } from '../api.js';
import { el, toast, busy, shortDay, farmWhen } from '../ui.js';
import { paint } from './paint.js';
import { S, cur } from './state.js';

// ── the AI's opinion on the chosen zone, at the top of its report (0180) ──
const STATUS = { ok: ['ok', 'OK'], watch: ['warn', 'Watch'], act: ['bad', 'Act now'] };
const TREND_AI = { better: ['ok', '▼ getting better'], stable: ['', '– stable'], worse: ['bad', '▲ getting worse'], unclear: ['', '? trend unclear'] };
export function opinionCard(u = cur(), compact = false) {
  const card = el(compact ? 'details' : 'div', compact ? 'pd-ai compact' : 'card card-pad pd-ai');
  if (!u) return card;
  const op = (S.opinions || []).find(o => o.unit_id === u.unit_id);
  const ask = el('button', 'btn btn-sm' + (op ? '' : ' btn-primary'), op ? '✦ Ask again' : '✦ Ask the AI');
  ask.title = `Sends what was recorded in ${u.zone} over the last 30 days — the counts, the notes, the cases and the AI notes, no photo — for an opinion on the situation and the trend`;
  ask.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    busy(ask, true, 'The AI is reading 30 days…');
    try {
      const r = await fn('zone-opinion', { farm_id: S.farm.id, zone_id: u.zone_id, system_id: u.system_id || null, force: true });
      if (!r?.ok) throw new Error(r?.error || 'no answer');
      S.opinions = await rpc('zone_opinions', { p_farm: S.farm.id });
      paint();
    } catch (err) { busy(ask, false, op ? '✦ Ask again' : '✦ Ask the AI'); toast('AI opinion: ' + String(err.message || err).replace(/^\d+ /, '').slice(0, 160), 'bad'); }
  };
  const [sc, sw] = op ? (STATUS[op.status] || ['', op.status]) : [];
  const [tc, tw] = op ? (TREND_AI[op.trend] || ['', op.trend]) : [];
  const head = el(compact ? 'summary' : 'div', 'pd-ai-head');
  head.append(el('b', null, '✦ AI opinion'));
  if (compact && op) head.append(el('span', 'pill ' + sc, sw), el('span', 'pill ' + tc, tw), el('span', 'pd-ai-headline', op.headline));
  else head.append(el('span', 'hint', op ? `${u.zone} · the last 30 days` : `${u.zone} · not asked yet — it reads the last 30 days`));
  head.append(el('span', 'spacer'), ask);
  card.append(head);
  if (!op) {
    if (!compact) card.append(el('div', 'hint', 'Nothing asked yet for this zone. The AI reads the traps, the photos\' tags and AI notes, the cases and treatments and the scouting notes of 30 days, and says how things stand and where they are going. It proposes; you decide.'));
    return card;
  }
  const body = el('div', 'pd-ai-body');
  if (!compact) {
    const line = el('div', 'pd-ai-line');
    line.append(el('span', 'pill ' + sc, sw), el('span', 'pill ' + tc, tw), el('b', null, op.headline));
    body.append(line);
  }
  if ((op.points || []).length) {
    const ul = el('ul', 'pd-ai-points');
    op.points.forEach(p => { const li = el('li'); li.append(el('span', null, p.text || String(p))); if (p.basis) li.append(el('div', 'hint', p.basis)); ul.append(li); });
    body.append(ul);
  }
  if ((op.next_checks || []).length) {
    body.append(el('div', 'pd-hlabel', 'Next'));
    const ol = el('ol', 'pd-ai-next');
    op.next_checks.forEach(t => ol.append(el('li', null, t)));
    body.append(ol);
  }
  if ((op.missing || []).length) {
    const d = el('details', 'pd-ai-missing');
    const sm = el('summary', null, `What was missing (${op.missing.length})`);
    const ul = el('ul');
    op.missing.forEach(t => ul.append(el('li', null, t)));
    d.append(sm, ul);
    body.append(d);
  }
  const st = op.stats || {};
  const read = [st.trap_readings ? `${st.trap_readings} trap readings` : null, st.plant_health ? `${st.plant_health} health photos` : null,
                st.growth ? `${st.growth} growth photos` : null, st.cases ? `${st.cases} cases` : null].filter(Boolean).join(', ');
  const foot = [`Asked ${farmWhen(op.created_at)}`, op.by,
                op.confidence != null ? `confidence ${Math.round(op.confidence * 100)} %` : null, read ? 'read ' + read : null,
                op.previous ? `before: ${(STATUS[op.previous.status] || [, op.previous.status])[1]} on ${shortDay(op.previous.day)}` : null].filter(Boolean).join(' · ');
  body.append(el('div', 'hint pd-ai-foot', foot + ' · The AI proposes; you decide.'));
  if (String(op.day) < String(S.over.today)) body.append(el('div', 'hint', 'This opinion is from an earlier day — ask again for today.'));
  card.append(body);
  return card;
}
