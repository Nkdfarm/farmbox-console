// ═══════════════════════════════════════════════════════════════════════════
// What the assistant reads out (console 0.11.02). The browser's own voice and its two buttons were taken out on 19 Nov 2026
// (owner: "too metallic"); the voice is on-device, in assistant-local.js, which asks for this text.
// ═══════════════════════════════════════════════════════════════════════════

// what is read out: the words, not the marks; the long answer is cut at a sentence and the rest stays on screen
// full: the person pressed Read aloud on that answer, so all of it is read (up to about two minutes)
export function spokenText(text, cards = 0, full = false) {
  const cap = full ? 1500 : 350;
  let t = String(text || '')
    .replace(/\[\[([^\]]+)\]\]/g, (_, x) => x.split('|').map(s => s.trim()).join(', ') + '.')   // figures: "70 planned, 18 done."
    .replace(/[\u{1F534}\u{1F7E0}\u{1F7E1}\u{1F7E2}\u{1F535}\u2753]\uFE0F?/gu, '')   // the coloured markers
    .replace(/\s—\s/g, ': ')
    .replace(/```[\s\S]*?```/g, ' ').replace(/[*`#_>|]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  let cut = false;
  if (t.length > cap) {   // read by itself: about half a minute of speech, the rest is on screen (owner, 19 Nov 2026: it took too long to read)
    const end = Math.max(t.lastIndexOf('. ', cap), t.lastIndexOf('? ', cap), t.lastIndexOf('! ', cap));
    t = t.slice(0, end > 120 ? end + 1 : cap); cut = true;
  }
  if (cut) t += ' The rest is on screen.';
  if (cards) t += cards === 1 ? ' One card is waiting for you on screen.' : ` ${cards} cards are waiting for you on screen.`;
  return t;
}
