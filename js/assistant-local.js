// ═══════════════════════════════════════════════════════════════════════════
// The assistant's on-device voice — the second voice icon (owner, 19 Nov 2026: "try the on-device prototype, the browser
// voice is too metallic"; he chose the voice Heart from four samples)
//
// Everything runs in this browser; no account, no audio sent anywhere:
//   · hearing: Whisper base.en (Apache-2.0) through transformers.js 3.8.1 (Apache-2.0), quantised, on wasm
//   · speaking: Kokoro 82M (Apache-2.0) through kokoro-js 1.2.1, a natural female English voice, sentence by sentence
//   · listening for you: the microphone with the browser's echo cancellation, a simple loudness detector that finds where
//     you start and stop talking, and — while it speaks — the same detector to notice you talking over it, which cuts it off
// The models (about 200 MB) are fetched from the Hugging Face hub and the CDN the first time and kept by the browser.
// The two libraries are loaded only when this icon is first pressed (an exact version each, as for three.js).
//
// The brain is unchanged: what Whisper heard goes to the assistant like a typed question (assistant.js send), and the
// answer is read out by assistant-voice.js's spokenText. A card stays a tap: nothing here presses "Do it".
// Limits of the prototype: inference runs on the page's own thread (the page is not cross-origin isolated, so one wasm
// thread), so a sentence being made can delay the moment it notices you talking over it, and the page stutters a little;
// Chrome or Edge only (a 16 kHz microphone context); a headset is best. A worker is the next step.
// ═══════════════════════════════════════════════════════════════════════════
import { toast, pref } from './ui.js';
import { spokenText } from './assistant-voice.js';

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const ASR_MODEL = 'onnx-community/whisper-base.en';
const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const VOICES = { af_heart: 'Heart (American)', af_bella: 'Bella (American)', af_nicole: 'Nicole (American)', bf_emma: 'Emma (British)' };
const VOICE_KEY = 'fbc_local_voice';
export const localVoice = () => { const v = pref.get(VOICE_KEY); return VOICES[v] ? v : 'af_heart'; };

const CHUNK = 1600;            // 100 ms of 16 kHz audio
const START_CHUNKS = 2;        // loud for 200 ms: you started
const END_CHUNKS = 8;          // quiet for 800 ms: you stopped
const PREROLL = 4;             // the 400 ms before the start are kept (besides the two loud ones), so the first word is not clipped
const MIN_LOUD = 3;            // under 300 ms of loud sound is a cough or a click, not a question
const MAX_CHUNKS = 300;        // 30 s, Whisper's window

let models = null;             // { asr, tts } once loaded
let loading = null;
let failures = 0;              // a failed import is remembered by the browser for the page's life: a retry changes the address
let run = null;                // the running conversation

// the download, as one percentage over every file the two models fetch
function progress(note) {
  const files = new Map();
  return p => {
    if (p?.status !== 'progress' || !p.total) return;
    files.set(p.file, [p.loaded, p.total]);
    let l = 0, t = 0; files.forEach(([a, b]) => { l += a; t += b; });
    if (t) note('Loading the voice ' + Math.min(99, Math.round(100 * l / t)) + '%');
  };
}

async function load(note) {
  if (models) return models;
  if (loading) return loading;
  loading = (async () => {
    toast('Loading the on-device voice: the first time takes a few minutes (about 200 MB)', '');
    const bust = failures ? '?r=' + failures : '';
    try {
      const [tf, kk] = await Promise.all([import(TRANSFORMERS + bust), import(KOKORO + bust)]);
      tf.env.allowLocalModels = false;
      const cb = progress(note);
      const [asr, tts] = await Promise.all([
        tf.pipeline('automatic-speech-recognition', ASR_MODEL, { dtype: 'q8', device: 'wasm', progress_callback: cb }),
        kk.KokoroTTS.from_pretrained(TTS_MODEL, { dtype: 'q8', device: 'wasm', progress_callback: cb }),
      ]);
      models = { asr, tts };
      return models;
    } catch (e) { failures++; throw e; }
  })();
  try { return await loading; } finally { loading = null; }
}

// the microphone as 100 ms chunks of 16 kHz mono floats
const WORKLET = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    for (let i = 0; i < x.length; i++) {
      this.buf[this.n++] = x[i];
      if (this.n === ${CHUNK}) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('tap', Tap);`;

const rms = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); };

// whisper sometimes "hears" silence as a caption: those, alone or repeated, are not questions
export const NOISE = /^(?:[\s.,!?-]*(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|thank(?:s| you)(?: for watching)?|you|bye))*[\s.,!?-]*$/i;
// sentences for the voice: a full stop inside a number ("21.5", "pH 5.8") is not the end of one
export const sentencesOf = t => (String(t).match(/(?:[^.!?]|[.!?]+(?!\s|$))+[.!?]*/g) || []).map(s => s.trim()).filter(s => /\w/.test(s));

export async function startLocal(ctl) {
  if (run) stopLocal();
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) throw new Error('This browser cannot do on-device voice: use Chrome or Edge');
  ctl.set('loading');
  const my = (run = { state: 'loading', sources: [], next: 0, turn: 0 });
  const alive = () => run === my;
  // a stop at any moment (during the permission prompt, the download, the setup) lands in stopLocal, which releases
  // whatever the run holds so far; a run that was stopped says nothing more
  try {
    my.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      .catch(() => { throw new Error('The microphone is blocked for this site'); });
    if (!alive()) { my.stream.getTracks().forEach(t => t.stop()); return; }
    await load(t => ctl.note?.(t));
    if (!alive()) return;
    my.mic = new AudioContext({ sampleRate: 16000 });
    my.out = new AudioContext();               // where the voice is played
    const mic = my.mic, out = my.out;
    await Promise.all([mic.resume(), out.resume()]);   // the autoplay rules: a context made after a few awaits may start suspended
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try { await mic.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    if (!alive()) return;
    const node = new AudioWorkletNode(mic, 'tap');
    const mute = mic.createGain(); mute.gain.value = 0;   // the tap is pulled by the graph only when it reaches the destination
    mic.createMediaStreamSource(my.stream).connect(node);
    node.connect(mute).connect(mic.destination);
    my.node = node;
    ctl.note?.('');
    if (!localStorage.getItem('fbc_local_voice_ready')) { try { localStorage.setItem('fbc_local_voice_ready', '1'); } catch { /* none */ } toast('On-device voice ready: just talk', 'ok'); }

    let floor = 0.004, loud = 0, quiet = 0, voiced = 0, speech = [], recent = [];
    const setState = s => { if (!alive()) return; my.state = s; ctl.set(s); };

    // ── speaking: sentence by sentence, the next one made while the last is played ─────────────────────────────────────
    function cutSpeech() {
      my.sources.forEach(s => { try { s.onended = null; s.stop(); } catch { /* ended */ } });
      my.sources = []; my.next = 0; my.speakId = null;
    }
    async function speak(text) {
      const id = my.speakId = Symbol();
      let last = null;
      try {
        for (const sentence of sentencesOf(text)) {
          if (!alive() || my.speakId !== id) return;
          const a = await models.tts.generate(sentence, { voice: localVoice() });
          if (!alive() || my.speakId !== id) return;
          if (!a?.audio?.length) continue;
          const buf = out.createBuffer(1, a.audio.length, a.sampling_rate);
          buf.copyToChannel(a.audio, 0);
          const src = out.createBufferSource();
          src.buffer = buf; src.connect(out.destination);
          const at = Math.max(out.currentTime + 0.05, my.next);
          src.start(at); my.next = at + buf.duration;
          my.sources.push(src); last = src;
        }
      } catch { if (my.speakId === id) cutSpeech(); return; }   // a sentence that failed: stop all of it, so the rest is not played into the microphone as if it were you
      if (!last) return;
      await new Promise(done => { last.onended = () => done(); });   // cutSpeech clears onended: a cut voice never gets here
      if (my.speakId === id) { my.speakId = null; my.sources = []; }
    }

    // ── what you said ───────────────────────────────────────────────────────────────────────────────────────────────────
    async function heardYou(chunks) {
      const turn = ++my.turn;                      // a newer turn (you talked again) makes this one stand down
      const mine = () => alive() && my.turn === turn;
      setState('thinking');
      const audio = new Float32Array(chunks.length * CHUNK);
      chunks.forEach((c, i) => audio.set(c, i * CHUNK));
      let text = '';
      try { text = ((await models.asr(audio)).text || '').trim(); } catch { /* nothing heard */ }
      if (!mine()) return;
      if (!text || NOISE.test(text)) { setState('listening'); return; }
      ctl.heard?.(text, true);
      let r = null;
      try { r = await ctl.ask(text); } catch { /* the panel already says what went wrong */ }
      if (!mine()) return;
      if (r?.reply || r?.cards) {
        setState('speaking');
        await speak(spokenText(r.reply, r.cards));
        if (!mine()) return;
      }
      if (my.state !== 'capturing') setState('listening');   // not when you already started talking over it
    }

    // ── listening ───────────────────────────────────────────────────────────────────────────────────────────────────────
    node.port.onmessage = e => {
      if (!alive()) return;
      const c = e.data, level = rms(c), s = my.state;
      if (s === 'thinking' || s === 'loading') return;
      // while it speaks, its own voice leaks into the microphone a little: a higher bar to count as you
      const bar = Math.max(0.02, floor * 3) * (s === 'speaking' ? 2.5 : 1);
      if (s === 'capturing') {
        speech.push(c);
        if (level >= bar) voiced++;
        quiet = level < bar * 0.7 ? quiet + 1 : 0;
        if (quiet >= END_CHUNKS || speech.length >= MAX_CHUNKS) {
          const got = speech.slice(0, speech.length - Math.max(0, quiet - 2)), enough = voiced >= MIN_LOUD;
          speech = []; quiet = 0; loud = 0; voiced = 0;
          if (!enough) { setState('listening'); return; }
          heardYou(got);
        }
        return;
      }
      if (level >= bar) loud++; else { loud = 0; if (s === 'listening') floor = floor * 0.95 + level * 0.05; }
      recent.push(c); if (recent.length > PREROLL + START_CHUNKS) recent.shift();
      if (loud >= START_CHUNKS) {
        if (s === 'speaking') { cutSpeech(); my.turn++; }     // you talked over it: it stops at once, and its turn is over
        speech = recent.slice(); recent = []; voiced = loud; loud = 0; quiet = 0;
        setState('capturing');
      }
    };

    setState('listening');
  } catch (e) {
    if (!alive()) return;          // stopped meanwhile: nothing to report
    stopLocal();
    throw new Error(e?.message?.startsWith('The microphone') || e?.message?.startsWith('This browser') ? e.message : 'The on-device voice could not start: ' + (e?.message || e));
  }
}

export function stopLocal() {
  const r = run; run = null;
  if (!r) return;
  try { r.sources.forEach(s => { s.onended = null; s.stop(); }); } catch { /* none */ }
  try { if (r.node) { r.node.port.onmessage = null; r.node.disconnect(); } } catch { /* none */ }
  try { r.stream?.getTracks().forEach(t => t.stop()); } catch { /* none */ }
  [r.mic, r.out].forEach(c => { try { c?.close().catch(() => { /* closed already */ }); } catch { /* none */ } });
}
