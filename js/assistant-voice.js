// ═══════════════════════════════════════════════════════════════════════════
// The assistant's voice — two ways to talk to it (owner, 19 Nov 2026: "browser and real time both, two different icons,
// English, female")
//
//  · Browser voice: the browser's own speech recognition and speech synthesis. Free and nothing of ours is involved, but
//    Chrome and Edge send the audio to their own speech service (Google's, Microsoft's) to recognise it. It takes turns: it listens, the assistant answers, it speaks, it listens again. It cannot be interrupted by
//    speaking over it (the microphone would hear the speaker), a tap on the icon stops it.
//  · On-device voice (the second icon): Whisper for hearing and Kokoro for a natural female voice, both running in the
//    browser (assistant-local.js), you can talk over it. No account; the first use downloads about 200 MB.
//
// Neither of them presses "Do it": a card is read out as "a card is waiting" and stays a tap on the screen.
// ═══════════════════════════════════════════════════════════════════════════
import { el, toast } from './ui.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const browserVoiceOK = () => !!SR && typeof speechSynthesis !== 'undefined';

// the two icons: a microphone, and sound waves
const MIC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const WAVES = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/></svg>';

// ── the voice that speaks: a female English one ─────────────────────────────────────────────────────────────────────
// the names of the female English voices the common systems ship (Windows, macOS, Android, Chrome's own)
const FEMALE = /\b(aria|jenny|sonia|libby|leah|zira|hazel|susan|samantha|karen|moira|tessa|serena|fiona|victoria|allison|ava|nicky|kate|stephanie|catherine|natasha|clara|emma|amy|joanna|salli|kendra|kimberly|female)\b/i;
const MALE = /\b(david|mark|george|james|daniel|richard|guy|ryan|luke|alex|fred|thomas|oliver|brian|male)\b/i;
const rank = v => (FEMALE.test(v.name) ? 0 : MALE.test(v.name) ? 8 : 4)
  + (/natural|neural|online/i.test(v.name) ? 0 : 2)
  + (/^en[-_]za/i.test(v.lang) ? 0 : /^en[-_]gb/i.test(v.lang) ? 1 : /^en[-_]us/i.test(v.lang) ? 1 : 2);
export function pickVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  const vs = speechSynthesis.getVoices().filter(v => /^en([-_]|$)/i.test(v.lang));
  return vs.sort((a, b) => rank(a) - rank(b))[0] || null;
}

// what is read out: the words, not the marks; the long answer is cut at a sentence and the rest stays on screen
export function spokenText(text, cards = 0) {
  let t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*`#_>|]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  let cut = false;
  if (t.length > 600) {
    const end = Math.max(t.lastIndexOf('. ', 600), t.lastIndexOf('? ', 600), t.lastIndexOf('! ', 600));
    t = t.slice(0, end > 200 ? end + 1 : 600); cut = true;
  }
  if (cut) t += ' The rest is on screen.';
  if (cards) t += cards === 1 ? ' One card is waiting for you on screen.' : ` ${cards} cards are waiting for you on screen.`;
  return t;
}

// ── the controller ──────────────────────────────────────────────────────────────────────────────────────────────────
// cb.ask(text) → Promise<{ reply, cards } | null>   the assistant's answer to what was said
// cb.heard(text, final)                              what is being heard, for the question box
// cb.state(name)                                     'off' | 'listening' | 'thinking' | 'speaking'
// cb.realtime  { start(ctl), stop() }                the realtime service, when there is one
export function createVoice(cb) {
  let kind = 'off';       // 'off' | 'browser' | 'realtime'
  let state = 'off';
  let rec = null, silent = 0, token = 0;
  const set = s => { state = s; cb.state?.(kind, s); if (s === 'off') cb.note?.(''); };

  function stopAll() {
    token++;
    try { rec?.abort(); } catch { /* already over */ }
    rec = null;
    try { speechSynthesis?.cancel(); } catch { /* no speech */ }
    try { cb.realtime?.stop?.(); } catch { /* not running */ }
    kind = 'off'; silent = 0; set('off');
  }

  function speak(text, my) {
    return new Promise(done => {
      if (!text || my !== token) { done(); return; }
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-ZA';
      u.rate = 1.02; u.pitch = 1.05;
      let over = false;
      const end = () => { if (over) return; over = true; clearTimeout(dog); done(); };
      u.onend = u.onerror = end;
      // Chrome sometimes never reports the end of a long or network voice: give up after a reading time's worth
      const dog = setTimeout(() => { try { speechSynthesis.cancel(); } catch { /* none */ } end(); }, 4000 + text.length * 90);
      speechSynthesis.cancel();
      setTimeout(() => { if (over || my !== token) { end(); return; } speechSynthesis.speak(u); }, 60);   // a speak right after a cancel is dropped by Chrome
    });
  }

  function listen(my) {
    if (my !== token) return;
    let final = '';
    rec = new SR();
    rec.lang = 'en-ZA'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = e => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) final = t; }
      cb.heard?.(t, !!final);
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('The microphone is blocked for this site', 'bad'); stopAll(); }
      else if (e.error === 'network') { toast('Browser voice needs a connection to the browser\'s speech service', 'bad'); stopAll(); }
    };
    rec.onend = async () => {
      if (my !== token || kind !== 'browser') return;
      const said = final.trim();
      if (!said) {   // silence: listen again, and after a few quiet rounds hand the microphone back
        if (++silent >= 3) { toast('Voice off: nobody spoke', ''); stopAll(); return; }
        listen(my); return;
      }
      silent = 0;
      set('thinking');
      let r = null;
      try { r = await cb.ask(said); } catch { /* the panel already says what went wrong */ }
      if (my !== token) return;
      if (r?.reply || r?.cards) { set('speaking'); await speak(spokenText(r.reply, r.cards), my); }
      if (my === token && kind === 'browser') { set('listening'); listen(my); }
    };
    try { rec.start(); set('listening'); } catch { toast('The microphone could not start', 'bad'); stopAll(); }
  }

  return {
    get kind() { return kind; },
    get state() { return state; },
    // a tap on the browser icon: on, or off (and the assistant stops talking)
    toggleBrowser() {
      if (kind === 'browser') { stopAll(); return; }
      if (!browserVoiceOK()) { toast('This browser has no speech recognition: use Chrome or Edge', 'bad'); return; }
      stopAll();
      kind = 'browser'; silent = 0;
      speechSynthesis.getVoices();   // some browsers load their voices only when asked
      listen(token);
    },
    async toggleRealtime() {
      if (kind === 'realtime') { stopAll(); return; }
      if (!cb.realtime) { toast('The on-device voice is not available', ''); return; }
      stopAll();
      kind = 'realtime'; set('loading');   // the icon answers at once; the first press has a download behind it
      try { await cb.realtime.start({ set, stop: () => stopAll(), ask: cb.ask, heard: cb.heard, note: cb.note }); }
      catch (e) { toast(e.message || 'Realtime voice did not start', 'bad'); stopAll(); }
    },
    stop: stopAll,
  };
}

// the two buttons, drawn and kept in step with the voice
export function voiceButtons(voice, { realtime }) {
  const wrap = el('div', 'ai-voice');
  const mk = (cls, icon, title, onclick) => {
    const b = el('button', 'btn btn-sm btn-ghost ai-vbtn ' + cls);
    b.type = 'button'; b.innerHTML = icon; b.title = title; b.setAttribute('aria-label', title); b.setAttribute('aria-pressed', 'false');
    b.onclick = onclick;
    return b;
  };
  const b1 = mk('browser', MIC, 'Talk to it: browser voice — it listens, answers aloud, listens again. A tap stops it. The browser sends the audio to its own speech service', () => voice.toggleBrowser());
  const b2 = mk('realtime', WAVES, realtime ? 'Talk to it: on-device voice — natural, you can talk over it, nothing leaves this computer. The first use downloads about 200 MB' : 'On-device voice — not available', () => voice.toggleRealtime());
  if (!realtime) b2.classList.add('soon');
  const note = el('span', 'ai-vnote');
  wrap.append(b1, b2, note);
  wrap.note = t => { note.textContent = t || ''; };
  wrap.paint = (kind, state) => {
    [[b1, 'browser'], [b2, 'realtime']].forEach(([b, k]) => {
      const on = kind === k && state !== 'off';
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      b.dataset.state = on ? state : '';
    });
  };
  return wrap;
}
