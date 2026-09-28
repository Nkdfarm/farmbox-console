// ═══════════════════════════════════════════════════════════════════════════
// Office › Customers — the customer book (migration 0131, console 0.7.143)
//
// Direct clients, super users who sell to their own circle, restaurants,
// retailers, communities and market agents: contact, route, channel, a price
// factor against the price book, terms, a credit limit, and a basket
// subscription for direct clients (the Sell page can take its count as the
// number of baskets). One book for sister units. Each row says what the
// customer took in the last 90 days and when they last had a delivery.
// ═══════════════════════════════════════════════════════════════════════════
import { openFast, rpc } from './api.js';
import { loading, el, pageHead, drawer, field, selectBox, toast, busy, pref } from './ui.js';

export const CUSTOMER_KINDS = [['direct', 'Direct client'], ['super_user', 'Super user'], ['restaurant', 'Restaurant'],
  ['retailer', 'Retailer'], ['community', 'Community'], ['market_agent', 'Market agent'], ['other', 'Other']];
const kindLabel = k => (CUSTOMER_KINDS.find(x => x[0] === k) || [k, k])[1];
const money = n => `R ${Math.round(Number(n || 0)).toLocaleString()}`;
const nice = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

let farm = null, mount = null, data = null, showInactive = false, kindFilter = '', q = '';

export async function renderCustomers(container, currentFarm) {
  farm = currentFarm; mount = container;
  kindFilter = pref.get('fbc_customers_kind') || '';
  await load();
}
async function load(fresh = false) {
  const here = mount;
  await openFast([['customers', { p_farm: farm.id, p_inactive: showInactive }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the customer book…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}

function paint() {
  mount.textContent = '';
  const add = data.may_edit ? el('button', 'btn btn-primary', 'New customer') : null;
  if (add) add.onclick = () => editCustomer(null);
  const inact = el('button', 'btn btn-sm btn-ghost', showInactive ? 'Hide the inactive' : 'Show the inactive');
  inact.onclick = () => { showInactive = !showInactive; load(true); };
  mount.append(pageHead(null, 'Who the farm sells to: direct clients with a basket subscription, super users who sell to their own circle, restaurants, ' +
    'retailers, communities and market agents. One book for sister units; orders pick their customer from it.', inact, add));

  const all = data.customers || [];
  const sub = data.subscriptions || {};
  const tiles = el('div', 'tiles cu-tiles');
  const tile = (v, l, s) => { const t = el('div', 'tile'); const b = el('div', 'tile-body'); b.append(el('div', 'tile-value', v), el('div', 'tile-label', l)); if (s) b.append(el('div', 'tile-sub', s)); t.append(b); return t; };
  tiles.append(tile(String(all.filter(c => c.active).length), 'Customers', `${all.filter(c => c.kind === 'super_user').length} super users`),
               tile(String(sub.clients || 0), 'Basket subscriptions', `${Number(sub.kg || 0).toFixed(1)} kg a harvest day`),
               tile(money(all.reduce((a, c) => a + Number(c.revenue_90d || 0), 0)), 'Delivered, 90 days', `${Math.round(all.reduce((a, c) => a + Number(c.kg_90d || 0), 0)).toLocaleString()} kg`),
               tile(String(all.reduce((a, c) => a + Number(c.orders_open || 0), 0)), 'Open orders'));
  mount.append(tiles);

  const bar = el('div', 'row cu-bar');
  const search = el('input', 'input'); search.placeholder = 'Search name, route, phone…'; search.value = q;
  search.oninput = () => { q = search.value; paintList(); };
  const chips = el('div', 'cu-chips');
  [['', 'All'], ...CUSTOMER_KINDS].forEach(([k, label]) => {
    const n = k ? all.filter(c => c.kind === k).length : all.length;
    if (k && !n) return;
    const b = el('button', 'chip' + (kindFilter === k ? ' on' : ''), `${label} · ${n}`);
    b.onclick = () => { kindFilter = k; pref.set('fbc_customers_kind', k || null); paint(); };
    chips.append(b);
  });
  bar.append(search, chips);
  mount.append(bar);
  const list = el('div', 'card');
  mount.append(list);
  const paintList = () => {
    list.textContent = '';
    const s = q.trim().toLowerCase();
    const rows = all.filter(c => (!kindFilter || c.kind === kindFilter)
      && (!s || [c.name, c.route, c.phone, c.email, c.contact_person].some(x => String(x || '').toLowerCase().includes(s))));
    if (!rows.length) { list.append(el('div', 'empty', all.length ? 'No customer matches.' : (data.may_edit ? 'The book is empty. "New customer" adds the first.' : 'The book is empty.'))); return; }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Customer</th><th>Kind</th><th>Contact</th><th>Route</th><th>Basket</th><th class="num">kg · 90 d</th><th class="num">Revenue · 90 d</th><th>Last delivery</th><th></th></tr></thead>';
    const tb = el('tbody');
    rows.forEach(c => {
      const tr = el('tr', c.active ? null : 'off');
      const name = el('td'); name.append(el('b', null, c.name));
      if (c.referred_by_name) name.append(el('div', 'hint', `circle of ${c.referred_by_name}`));
      if (c.circle) name.append(el('div', 'hint', `${c.circle} in their circle`));
      const kind = el('td'); kind.append(el('span', 'pill ' + (c.kind === 'super_user' ? 'info' : ''), kindLabel(c.kind)));
      if (Number(c.price_factor) !== 1) kind.append(el('div', 'hint', `price × ${Number(c.price_factor)}`));
      tr.append(name, kind, el('td', 'hint', [c.contact_person, c.phone, c.email].filter(Boolean).join(' · ') || '—'),
                el('td', null, c.route || '—'),
                el('td', null, c.subscription_active ? `${Number(c.subscription_kg || 0)} kg` : '—'),
                el('td', 'num', Math.round(Number(c.kg_90d || 0)).toLocaleString()), el('td', 'num', money(c.revenue_90d)),
                el('td', 'hint', nice(c.last_delivery)));
      const act = el('td');
      if (data.may_edit) { const b = el('button', 'btn btn-sm btn-ghost', 'Edit'); b.onclick = () => editCustomer(c); act.append(b); }
      tr.append(act); tb.append(tr);
    });
    t.append(tb); list.append(t);
  };
  paintList();
}

export function editCustomer(c, onSaved) {
  const d = drawer(c ? c.name : 'New customer', 'Contact, how they buy, and a basket subscription for a direct client');
  const inp = (v, attrs = {}) => { const i = el('input', 'input'); Object.assign(i, attrs); i.value = v ?? ''; return i; };
  const kind = selectBox(CUSTOMER_KINDS, c?.kind || 'direct');
  const name = inp(c?.name, { placeholder: 'Name or business' });
  const person = inp(c?.contact_person), phone = inp(c?.phone, { type: 'tel' }), email = inp(c?.email, { type: 'email' });
  const address = inp(c?.address), route = inp(c?.route, { placeholder: 'e.g. Tuesday north' });
  const channel = selectBox([['direct', 'Direct price'], ['retail', 'Retail price']], c?.channel || 'direct');
  const factor = inp(c?.price_factor ?? 1, { type: 'number', step: '0.05', min: '0.1' });
  const terms = inp(c?.payment_terms_days, { type: 'number', min: '0', placeholder: 'days' });
  const credit = inp(c?.credit_limit, { type: 'number', min: '0', placeholder: 'R' });
  const subOn = el('input'); subOn.type = 'checkbox'; subOn.checked = !!c?.subscription_active;
  const subKg = inp(c?.subscription_kg, { type: 'number', step: '0.5', min: '0', placeholder: 'kg a harvest day' });
  const others = (data?.customers || []).filter(x => x.id !== c?.id && x.kind === 'super_user');
  const ref = selectBox([['', '—'], ...others.map(x => [x.id, x.name])], c?.referred_by || '');
  const notes = el('textarea', 'input'); notes.value = c?.notes || '';
  const active = el('input'); active.type = 'checkbox'; active.checked = c ? !!c.active : true;
  const g1 = el('div', 'grid2'); g1.append(field('Kind', kind), field('Name', name));
  const g2 = el('div', 'grid2'); g2.append(field('Contact person', person), field('Phone', phone));
  const g3 = el('div', 'grid2'); g3.append(field('Email', email), field('Route', route));
  const g4 = el('div', 'grid2'); g4.append(field('Price list', channel), field('Price factor', factor, '1 = the price book; 0.9 = 10% off'));
  const g5 = el('div', 'grid2'); g5.append(field('Payment terms', terms), field('Credit limit', credit));
  const sl = el('label', 'row'); sl.append(subOn, el('span', null, 'Basket subscription'));
  const g6 = el('div', 'grid2'); g6.append(field('Subscription', sl), field('Basket size', subKg));
  const al = el('label', 'row'); al.append(active, el('span', null, 'Active'));
  d.body.append(g1, g2, g3, field('Address', address), g4, g5, g6, field('In the circle of (super user)', ref), field('Notes', notes), al);
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      const saved = await rpc('save_customer', { p_farm: farm.id, p: { id: c?.id || null, kind: kind.value, name: name.value, contact_person: person.value,
        phone: phone.value, email: email.value, address: address.value, route: route.value, channel: channel.value, price_factor: factor.value,
        payment_terms_days: terms.value, credit_limit: credit.value, subscription_active: subOn.checked, subscription_kg: subKg.value,
        referred_by: ref.value || null, notes: notes.value, active: active.checked } });
      d.close();
      toast('Saved', 'ok');
      if (onSaved) onSaved(saved); else load(true);
    } catch (e) { busy(go, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}
