// ═══════════════════════════════════════════════════════════════════════════
// The on-device voice's worker (console 0.11.02, owner 19 Nov 2026: "the page is unresponsive")
//
// Whisper (hearing) and Kokoro (speaking) run HERE, off the page's thread, so the page stays alive while they work.
// assistant-local.js owns it and talks to it by messages:
//   → { type:'load', which:'asr'|'tts', urls, asr, tts, device? }
//                                                  ← { type:'progress', which, pct } … { type:'ready', which, mode } | { type:'error', of:'load', which, message }
//   → { type:'transcribe', id, audio }             ← { type:'text', id, text }      (audio: 16 kHz mono floats, up to 2 minutes)
//   → { type:'speak', id, sentences, voice }       ← { type:'audio', id, audio, rate } for each sentence, then { type:'done', id }
//   → { type:'cancel', id }                          the rest of that speech is not made
// The two models load SEPARATELY (console 0.11.07, owner 20 Nov 2026: "loading the voice after an update is very long"):
// reading an answer aloud needs only Kokoro, so it no longer waits for Whisper and its warm-up; a spoken question loads
// Whisper first and Kokoro while the assistant thinks.
// The libraries come from jsdelivr at an exact version (Apache-2.0), the models from the Hugging Face hub; the browser
// keeps them after the first time.
//
// On the graphics chip when the browser has WebGPU (measured 19 Nov 2026 on the owner's laptop, Intel Xe, in Chrome: Kokoro
// made 1 s of speech in 5 s on wasm and in 0.5 s on WebGPU; Whisper wrote down 12.8 s in 14.5 s on wasm, 4.2 s on WebGPU).
// That path needs the larger models (Kokoro fp32 326 MB, Whisper encoder fp32 and decoder q4: about 450 MB in all); without
// WebGPU, or if it fails, the small quantised ones on wasm (about 200 MB), which are slow. The first run on the chip compiles
// its programs (about 5 s), so a warm-up is done before 'ready'.
// ═══════════════════════════════════════════════════════════════════════════
let asr = null, tts = null, gpuAsked = null;
const modes = { asr: 'wasm', tts: 'wasm' };
const loading = { asr: null, tts: null };
const failures = { asr: 0, tts: 0 };   // the browser remembers a failed import for the worker's life: a new address each time
const cancelled = new Set();

const hasGpu = m => gpuAsked ||= (async () => {
  if (m.device) return false;
  try { return !!(await navigator.gpu?.requestAdapter()); } catch { return false; }
})();

async function build(which, m) {
  const bust = failures[which] ? '?r=' + failures[which] : '';
  const [tf, kk] = await Promise.all([import(m.urls.tf + bust), which === 'tts' ? import(m.urls.kokoro + bust) : null]);
  tf.env.allowLocalModels = false;
  const files = new Map();
  let best = 0;
  const progress_callback = p => {
    if (p?.status !== 'progress' || !p.total) return;
    files.set(p.file, [p.loaded, p.total]);
    let l = 0, t = 0; files.forEach(([a, b]) => { l += a; t += b; });
    // files are found as the model is read, so the total grows: the figure only ever goes up
    if (t) { best = Math.max(best, Math.min(99, Math.round(100 * l / t))); postMessage({ type: 'progress', which, pct: best }); }
  };
  const make = async gpu => {
    if (which === 'asr') {
      const a = await tf.pipeline('automatic-speech-recognition', m.asr, gpu
        ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }
        : { device: m.device || 'wasm', dtype: 'q8', progress_callback });
      if (gpu) await a(new Float32Array(16000));   // the first run compiles: not under the person's first question
      return a;
    }
    const t = await kk.KokoroTTS.from_pretrained(m.tts, gpu
      ? { device: 'webgpu', dtype: 'fp32', progress_callback }
      : { device: m.device || 'wasm', dtype: 'q8', progress_callback });
    if (gpu) await t.generate('Hello.', { voice: 'af_heart' });
    return t;
  };
  const gpu = await hasGpu(m);
  let got, mode = gpu ? 'webgpu' : 'wasm';
  try { got = await make(gpu); }
  catch (e) { if (!gpu) throw e; got = await make(false); mode = 'wasm'; }   // the chip refused: the slow way, but it works
  if (which === 'asr') asr = got; else tts = got;
  modes[which] = mode;
}

async function load(which, m) {
  if (which !== 'asr' && which !== 'tts') throw new Error('Unknown part of the voice: ' + which);
  if (which === 'asr' ? asr : tts) return;
  if (!loading[which]) {
    loading[which] = build(which, m).catch(e => { failures[which]++; throw e; }).finally(() => { loading[which] = null; });
  }
  await loading[which];
}

onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') { await load(m.which, m); postMessage({ type: 'ready', which: m.which, mode: modes[m.which] }); }
    else if (m.type === 'cancel') cancelled.add(m.id);
    else if (m.type === 'transcribe') {
      if (!asr) throw new Error('The hearing part of the voice is not loaded');
      // a long message is read in 30 s windows that overlap by 5 s
      const r = await asr(m.audio, { chunk_length_s: 30, stride_length_s: 5 });
      postMessage({ type: 'text', id: m.id, text: String(r?.text || '').trim() });
    } else if (m.type === 'speak') {
      if (!tts) throw new Error('The speaking part of the voice is not loaded');
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
    postMessage({ type: 'error', id: m.id, of: m.type, which: m.which, message: String(e?.message || e) });
  }
};
