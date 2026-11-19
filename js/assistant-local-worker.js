// ═══════════════════════════════════════════════════════════════════════════
// The on-device voice's worker (console 0.11.02, owner 19 Nov 2026: "the page is unresponsive")
//
// Whisper (hearing) and Kokoro (speaking) run HERE, off the page's thread, so the page stays alive while they work.
// assistant-local.js owns it and talks to it by messages:
//   → { type:'load', urls, asr, tts, device? }              ← { type:'progress', pct } … { type:'ready' } | { type:'error', message }
//   → { type:'transcribe', id, audio }             ← { type:'text', id, text }      (audio: 16 kHz mono floats, up to 2 minutes)
//   → { type:'speak', id, sentences, voice }       ← { type:'audio', id, audio, rate } for each sentence, then { type:'done', id }
//   → { type:'cancel', id }                          the rest of that speech is not made
// The libraries come from jsdelivr at an exact version (Apache-2.0), the models from the Hugging Face hub; the browser
// keeps them after the first time.
//
// On the graphics chip when the browser has WebGPU (measured 19 Nov 2026 on the owner's laptop, Intel Xe, in Chrome: Kokoro
// made 1 s of speech in 5 s on wasm and in 0.5 s on WebGPU; Whisper wrote down 12.8 s in 14.5 s on wasm, 4.2 s on WebGPU).
// That path needs the larger models (Kokoro fp32 326 MB, Whisper encoder fp32 and decoder q4: about 450 MB in all); without
// WebGPU, or if it fails, the small quantised ones on wasm (about 200 MB), which are slow. The first run on the chip compiles
// its programs (about 5 s), so a warm-up is done before 'ready'.
// ═══════════════════════════════════════════════════════════════════════════
let asr = null, tts = null, loading = null, failures = 0, mode = 'wasm';
const cancelled = new Set();

async function load(m) {
  if (asr && tts) return;
  if (loading) return loading;
  loading = (async () => {
    const bust = failures ? '?r=' + failures : '';   // the browser remembers a failed import for the worker's life
    try {
      const [tf, kk] = await Promise.all([import(m.urls.tf + bust), import(m.urls.kokoro + bust)]);
      tf.env.allowLocalModels = false;
      const files = new Map();
      let best = 0;
      const progress_callback = p => {
        if (p?.status !== 'progress' || !p.total) return;
        files.set(p.file, [p.loaded, p.total]);
        let l = 0, t = 0; files.forEach(([a, b]) => { l += a; t += b; });
        // files are found as the models are read, so the total grows: the figure only ever goes up
        if (t) { best = Math.max(best, Math.min(99, Math.round(100 * l / t))); postMessage({ type: 'progress', pct: best }); }
      };
      const build = async gpu => {
        const [a, t] = await Promise.all([
          tf.pipeline('automatic-speech-recognition', m.asr, gpu
            ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }
            : { device: m.device || 'wasm', dtype: 'q8', progress_callback }),
          kk.KokoroTTS.from_pretrained(m.tts, gpu
            ? { device: 'webgpu', dtype: 'fp32', progress_callback }
            : { device: m.device || 'wasm', dtype: 'q8', progress_callback }),
        ]);
        if (gpu) { await t.generate('Hello.', { voice: 'af_heart' }); await a(new Float32Array(16000)); }   // the first run compiles: not under the person's first question
        return [a, t];
      };
      let gpu = false;
      if (!m.device) { try { gpu = !!(await navigator.gpu?.requestAdapter()); } catch { gpu = false; } }
      try { [asr, tts] = await build(gpu); mode = gpu ? 'webgpu' : 'wasm'; }
      catch (e) { if (!gpu) throw e; [asr, tts] = await build(false); mode = 'wasm'; }   // the chip refused: the slow way, but it works
    } catch (e) { failures++; throw e; }
  })();
  try { await loading; } finally { loading = null; }
}

onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') { await load(m); postMessage({ type: 'ready', mode }); }
    else if (m.type === 'cancel') cancelled.add(m.id);
    else if (m.type === 'transcribe') {
      // a long message is read in 30 s windows that overlap by 5 s
      const r = await asr(m.audio, { chunk_length_s: 30, stride_length_s: 5 });
      postMessage({ type: 'text', id: m.id, text: String(r?.text || '').trim() });
    } else if (m.type === 'speak') {
      for (const s of m.sentences) {
        if (cancelled.has(m.id)) break;
        const a = await tts.generate(s, { voice: m.voice, speed: 1.1 });
        if (cancelled.has(m.id)) break;
        if (a?.audio?.length) postMessage({ type: 'audio', id: m.id, audio: a.audio, rate: a.sampling_rate });
      }
      cancelled.delete(m.id);
      postMessage({ type: 'done', id: m.id });
    }
  } catch (e) {
    postMessage({ type: 'error', id: m.id, of: m.type, message: String(e?.message || e) });
  }
};
