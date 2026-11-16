// The photo viewer's shared parts: chips, risk words, signed URLs and small helpers (split from viewer.js, 16 Nov 2026)
import { api, URL_BASE, me } from '../api.js';
import { el, num, avatar, g1Face, farmWhen } from '../ui.js';

export const when = farmWhen;
export const day = ts => ts ? new Date(ts).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
export const SEV = ['none', 'slight', 'clear', 'severe'];
export const partLabel = p => ({ leaf: 'leaf', fruit: 'fruit', head: 'head', root: 'root', stem: 'stem', whole: 'whole plant', other: 'other' })[p] || p || '';

// a signed URL (one hour) for a full photo in the private evidence bucket
export async function fullPhotoUrl(path) {
  if (!path) return null;
  try {
    const res = await api('/storage/v1/object/sign/evidence/' + path, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }), quiet: true });
    return res?.signedURL ? URL_BASE + '/storage/v1' + res.signedURL : null;
  } catch { return null; }
}

export const photoTitle = p => p.kind === 'trap'
  ? `Trap ${p.code}` + (p.total != null ? ` · ${num(p.total, 0)} insects` : '')
  : `${p.crop || 'Plant'} · ${partLabel(p.part)}`;

// the tags on a photo, the person's and the AI's, as one list of chips
// `short` (the report's cards, 0.7.214, owner 4 Oct 2026: "just the AI summary with 3 colours, the complete AI report
// only when clicking"): an AI finding is its first words — "Powdery mildew · slight" — in its risk colour (below),
// the whole sentence on hover; the viewer shows everything.
const shortName = s => { const t = String(s || '').split(/\s*[(,;:]|\s+[—–-]\s+/)[0].trim(); return t.length > 26 ? t.slice(0, 25).trimEnd() + '…' : t; };
// One risk scale for every chip, the person's and the AI's (0.7.261, owner 15 Oct 2026: "yellow (low risk), red (risk
// high) and green (no risks). remove the blue and grey"): until then a chip took the colour of its kind (pest amber,
// disease red, disorder blue, beneficial green, none grey). Now: nothing or a beneficial green, slight yellow, clear or
// severe red; the kind stays in the words. A tag without a severity is slight (tag_photo's default).
export const RISK_WORD = { green: 'no risk', yellow: 'low risk', red: 'high risk' };
export const riskOf = (severity, kind) => kind === 'beneficial' || Number(severity) === 0 ? 'green'
  : Number(severity ?? 1) >= 2 ? 'red' : 'yellow';
// the person's note as a chip of the same scale, their small face inside on the left (0239): the colour is theirs —
// beside the AI's chips it shows where the two read the photo differently. A note filed by hand ("Recovered by …")
// says nothing about the crop: it stays a line of text.
export function noteChip(p, short = false) {
  const text = String(p.note || '').trim();
  // a list that does not carry the reading (a case, "The AI found something"): the note stays text
  if (!text || !('note_level' in p) || (!p.note_level && /^Recovered by\b/.test(text))) return null;
  const lvl = RISK_WORD[p.note_level] ? p.note_level : 'yellow';
  const c = el('span', `vw-tag vw-note r-${lvl}`);
  if (p.by || p.worker_id) c.append(avatar({ worker_id: p.worker_id || null, name: p.by || '' }, 'xs'));
  c.append(el('span', 'vw-note-text' + (short ? ' clamp' : ''), text));
  c.title = `${p.by ? p.by + ': ' : ''}${text} (${p.note_level ? RISK_WORD[lvl] : 'no risk chosen'})`;
  return c;
}
// the AI's reading in the same block as a person's note, the robot's face in place of theirs (0.7.273, owner 22 Oct
// 2026: "use the same visual block used for human for ai as well just with the robot avatar"); "AI:" stays on hover
function aiNote(text, lvl, title, short) {
  const c = el('span', `vw-tag vw-note ai r-${lvl}`);
  c.append(g1Face('xs', 'The AI'), el('span', 'vw-note-text' + (short ? ' clamp' : ''), text));
  c.title = title || `AI: ${text}`;
  return c;
}
// the AI's findings as ONE block, the most serious first and the block in the colour of the worst (0.7.275, owner 22
// Oct 2026: "the AI notes in only one to be more visual, with first information according with gravity"): red before
// yellow before green, then the higher severity, then the AI's own order
const RISK_RANK = { red: 3, yellow: 2, green: 1 };
export const byGravity = all => all.map((x, i) => ({ x, i, lvl: riskOf(x.severity, x.kind) }))
  .sort((a, b) => (RISK_RANK[b.lvl] - RISK_RANK[a.lvl]) || (Number(b.x.severity ?? 1) - Number(a.x.severity ?? 1)) || a.i - b.i);
// a trap's insects the same way: the pests before the beneficial ones, the most counted first
export const insectsByGravity = sp => sp.map((x, i) => ({ x, i }))
  .sort((a, b) => (!!a.x.beneficial - !!b.x.beneficial) || (Number(b.x.count ?? 0) - Number(a.x.count ?? 0)) || a.i - b.i).map(o => o.x);
export function tagChips(p, short = false) {
  const box = el('div', 'vw-chips');
  (p.tags || []).forEach(t => box.append(el('span', 'vw-tag r-' + riskOf(t.severity, t.kind), `${t.label || t.code}${t.severity != null ? ' · ' + SEV[t.severity] : ''}`)));
  if (p.kind === 'observation' && p.ai_status === 'done') {
    const all = byGravity(p.ai?.findings || []);
    if (!all.length && p.ai?.healthy !== false) box.append(aiNote('Healthy', 'green', 'AI: healthy', short));
    if (all.length) {
      const sev = x => x.severity != null ? ' · ' + SEV[x.severity] : '';
      // under a picture (short) each finding's first words, two lines at most; every finding in full on hover
      const text = all.map(({ x }) => `${short ? shortName(x.name || x.code) : (x.name || x.code)}${sev(x)}`).join(', ');
      box.append(aiNote(text, all[0].lvl, all.map(({ x }) => `AI: ${x.name || x.code}${sev(x)}`).join('\n'), short));
    }
  }
  // insects on a trap: a pest seen, low risk by itself — the trap's own figure against the limits says more
  if (p.kind === 'trap' && p.ai_status === 'done' && Array.isArray(p.species) && p.species.length) {
    const sp = insectsByGravity(p.species);
    box.append(aiNote(sp.map(x => `${x.common || x.name} ${x.count ?? ''}`.trim()).join(', '), sp.some(x => !x.beneficial) ? 'yellow' : 'green',
                      sp.map(x => `AI: ${x.common || x.name}${x.name && x.common && x.name !== x.common ? ' (' + x.name + ')' : ''} ${x.count ?? ''}`.trim()).join('\n'), short));
  }
  return box;
}

// ── the team's notes on a photo (0.7.269) ──
let meId = null, meAt = 0;           // the signed-in person, asked again after a minute (a sign-out and in)
export const whoAmI = async () => { if (meId && Date.now() - meAt < 60000) return meId; try { meId = (await me())?.id || null; meAt = Date.now(); } catch { meId = null; } return meId; };
export const signedUrl = async path => {
  try {
    const r = await api('/storage/v1/object/sign/evidence/' + path.split('/').map(encodeURIComponent).join('/'),
                        { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }), quiet: true });
    return r?.signedURL ? URL_BASE + '/storage/v1' + r.signedURL : null;
  } catch { return null; }
};
export const errWord = e => String(e?.message || e).replace(/^\d+ /, '');
export const riskSelect = () => {
  const s = el('select', 'vw-note-risk');
  [['green', 'Green · no risk'], ['yellow', 'Yellow · low risk'], ['red', 'Red · high risk']].forEach(([v, w]) => { const o = el('option', null, w); o.value = v; s.append(o); });
  s.value = 'yellow'; s.dataset.level = 'yellow'; s.onchange = () => { s.dataset.level = s.value; };
  return s;
};
// under a report photo, the start of its comment flow (0.7.280, owner 23 Oct 2026: "rule is to show up to the 3 first
// comments"): after the AI's comment and the note of who took the photo (`used` of them shown), the team's first
// comments, oldest first — three blocks at most in all
export const CARD_COMMENTS = 3;
export function firstComments(p, used) {
  const room = CARD_COMMENTS - used;
  if (room <= 0 || !Array.isArray(p?.notes)) return [];
  return p.notes.slice().sort((a, b) => (new Date(a.at).getTime() || 0) - (new Date(b.at).getTime() || 0)).slice(0, room).map(n => {
    const text = String(n.body || n.transcript || '').trim() || 'Voice note';
    const lvl = RISK_WORD[n.level] ? n.level : 'yellow';
    const c = el('span', `vw-tag vw-note r-${lvl}`);
    if (n.by || n.worker_id) c.append(avatar({ worker_id: n.worker_id || null, name: n.by || '' }, 'xs'));
    c.append(el('span', 'vw-note-text clamp', text));
    c.title = `${n.by ? n.by + ': ' : ''}${text}`;
    return c;
  });
}
// the AI's blocks among a photo's chips (tagChips): one since 0.7.275, none when it has not read the photo
export const aiBlocks = box => box ? box.querySelectorAll('.vw-note.ai').length : 0;
// The photo as a post (0.7.271, 0250; owner 22 Oct 2026: "Naked Heart shows the same thread, votes and verified answer
// on each photo"), as a comment flow since 0.7.279 (0261; owner 23 Oct 2026: "this part has to be as a comments flow in
// the social … first comment by ai (summarized in one line …), second comment is the human note done by the user take
// the pic, other comments by users … like, dislike and pensive … same approach for the naked heart"): read with
// dg_photo_thread — the verified diagnosis on top when a manager or the agronomist has marked one, then the AI's reading
// in one line (the whole of it is "The AI" further down), the note of who took the photo, and everybody's comments and
// questions in time order with the AI's answers indented under the comment they answer; each with like, dislike and
// not sure. "Ask the AI" under my own comment sends that comment (photo-chat, brief) — never by itself; "More detail"
// under an answer asks for the long one. After every change the photo's social and notes are the thread's, and the page
// underneath is told (ctx.onChange).
export const firstWord = s => s ? String(s).trim().split(/\s+/)[0] : '';
// the reactions, the one place with emoji (owner 23 Oct 2026: "for general design and gui I prefer the minimalist icon,
// for the reactions the classic small emoji are better")
export const REACTS = [['like', '👍', 'Like'], ['dislike', '👎', 'Dislike'], ['pensive', '🤔', 'Not sure']];
export const firstSentence = s => { const t = String(s || '').replace(/\s+/g, ' ').trim(), m = t.match(/^.+?[.!?](?=\s|$)/); const x = (m ? m[0] : t).trim(); return x.length > 160 ? x.slice(0, 157).trimEnd() + '…' : x; };
export function verifiedBlock(v) {
  const lvl = RISK_WORD[v.level] ? v.level : 'yellow';
  const box = el('div', `vw-verified r-${lvl}`);
  box.append(el('div', 'vw-verified-h', '✓ Verified diagnosis'), el('div', 'vw-verified-body', v.body || 'A voice note'),
             el('div', 'hint', [v.by ? 'by ' + v.by : null, v.verified_by ? 'verified by ' + v.verified_by : null, v.at ? when(v.at) : null]
                                 .filter(Boolean).join(' · ')));
  box.title = `${RISK_WORD[lvl]} — it stands above the AI's reading`;
  return box;
}
