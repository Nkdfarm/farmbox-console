// ═══════════════════════════════════════════════════════════════════════════
// What the assistant reads out (console 0.11.02). The browser's own voice and its two buttons were taken out on 19 Nov 2026
// (owner: "too metallic"); the voice is on-device, in assistant-local.js, which asks for this text.
// ═══════════════════════════════════════════════════════════════════════════

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
