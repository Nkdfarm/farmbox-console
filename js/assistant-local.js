// ═══════════════════════════════════════════════════════════════════════════
// The assistant's voice (console 0.11.02, owner 19 Nov 2026: "voice is nice, but the page is unresponsive ... put the button
// in the input block, capture the message, wait for the claude text, and when the text is written the voice reads in
// parallel; the microphone stops when the button is clicked a second time, 2 minutes at most; the middle mouse button
// starts it")
//
// One button in the question box, push-to-talk by clicks:
//   click   → it records (the microphone opens only now, and is released at the stop)
//   click   → it stops; Whisper writes down what was said; the text goes to the assistant like a typed question
//   the answer appears as text, and at that moment the voice (Kokoro, Heart) starts reading it, sentence by sentence,
//   while the text is on screen. A click while it reads stops it, and starts a new recording.
// A recording lasts 2 minutes at most (then it is sent as it is). The middle mouse button does the same as the click
// (assistant.js). Nothing here presses "Do it": a card is announced as waiting and stays a tap.
//
// Whisper base.en and Kokoro 82M (both Apache-2.0, quantised) run in a worker (assistant-local-worker.js), so the page
// stays alive; about 450 MB are downloaded the first time and kept by the browser (WebGPU: the graphics chip does the work;
// without it, a smaller 200 MB set on wasm, which is slow). Recording does not wait for them:
// they load while the person talks. Nothing leaves the computer. Chrome or Edge (a 16 kHz microphone context).
// ═══════════════════════════════════════════════════════════════════════════
import { el, toast, pref } from './ui.js';
import { spokenText } from './assistant-voice.js';

const URLS = {
  tf: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
  kokoro: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js',
};
const ASR_MODEL = 'onnx-community/whisper-base.en';
const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const VOICES = { af_heart: 'Heart (American)', af_bella: 'Bella (American)', af_nicole: 'Nicole (American)', bf_emma: 'Emma (British)' };
const READ_ALL_KEY = 'fbc_ai_read_all';   // this device reads every answer, typed questions too (Settings › Assistant)
export const readAllOn = () => pref.get(READ_ALL_KEY) === '1';
export const setReadAll = on => pref.set(READ_ALL_KEY, on ? '1' : '');
const VOICE_KEY = 'fbc_local_voice', READY_KEY = 'fbc_local_voice_ready2';   // the second: the models of 0.11.03 are larger, so the first set kept by a browser does not start a download in the background
export const localVoice = () => { const v = pref.get(VOICE_KEY); return VOICES[v] ? v : 'af_heart'; };

const CHUNK = 1600;            // the microphone is taken in 100 ms pieces of 16 kHz audio
const MAX_SECONDS = 120;       // a message is 2 minutes at most
const MIN_SAMPLES = 8000;      // under half a second is a click, not a message

// whisper sometimes "hears" silence as a caption: those, alone or repeated, are not questions
export const NOISE = /^(?:[\s.,!?-]*(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|thank(?:s| you)(?: for watching)?|you|bye))*[\s.,!?-]*$/i;
// sentences for the voice: a full stop inside a number ("21.5", "pH 5.8") is not the end of one
export const sentencesOf = t => (String(t).match(/(?:[^.!?]|[.!?]+(?!\s|$))+[.!?]*/g) || []).map(s => s.trim()).filter(s => /\w/.test(s));

const TAP = `class Tap extends AudioWorkletProcessor {
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

const MIC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const TITLES = {
  idle: 'Talk to it: click to record, click again to send (2 minutes at most). The middle mouse button does the same. Nothing leaves this computer; the first use downloads about 450 MB',
  loading: 'Opening the microphone…',
  recording: 'Recording: click to stop and send',
  transcribing: 'Writing down what you said: click to cancel',
  thinking: 'The assistant is answering: click to cancel the voice',
  speaking: 'Reading the answer: click to stop it and record again',
  preparing: 'Preparing the voice: click to cancel',
};
// the first sentence is the one that is waited for: when it is long, its first clause goes out alone
const lead = ss => {
  const [a, ...rest] = ss;
  if (!a || a.length < 90) return ss;
  const i = a.slice(30).search(/[,;:] /);
  return i < 0 ? ss : [a.slice(0, 30 + i + 1), a.slice(30 + i + 2), ...rest];
};
const clock = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// → { button, note, toggle(), cancel(), warm(), destroy() }
// ask(text) → Promise<{ reply, cards } | null>, the assistant's answer to what was said
export function createMic({ ask }) {
  let state = 'idle', run = null;            // run: the message in hand; a new one, or a cancel, makes the old one stand down
  let worker = null, ready = null, failReady = null, loadNote = '';
  let seq = 0, rec = null, speech = null, out = null;
  const waits = new Map();

  const button = el('button', 'btn btn-sm btn-ghost ai-mic');
  button.type = 'button'; button.innerHTML = MIC; button.setAttribute('aria-label', 'Talk to the assistant');
  const note = el('span', 'ai-vnote');
  const paintNote = t => { note.textContent = t || ''; };
  const set = (s, text = '') => {
    state = s; button.dataset.state = s === 'idle' ? '' : s; button.title = TITLES[s];
    button.setAttribute('aria-pressed', String(s === 'recording'));
    paintNote(text || (s === 'idle' ? '' : loadNote));
  };

  // ── the worker ──────────────────────────────────────────────────────────────────────────────────────────────────
  function boot() {
    if (ready) return ready;
    let ok, bad;
    ready = new Promise((a, b) => { ok = a; bad = b; failReady = b; });
    ready.catch(() => { /* reported where it is awaited */ });
    const w = (worker = new Worker(new URL('./assistant-local-worker.js', import.meta.url), { type: 'module' }));
    w.onmessage = ({ data: m }) => {
      if (w !== worker) return;
      if (m.type === 'progress') { loadNote = 'Loading the voice ' + m.pct + '%'; if (state !== 'recording' && state !== 'speaking' && state !== 'thinking') paintNote(loadNote); }
      else if (m.type === 'ready') { loadNote = ''; if (m.mode === 'wasm') toast('This browser has no graphics acceleration for the voice: it will be slow', ''); if (state === 'idle') paintNote(''); try { localStorage.setItem(READY_KEY, '1'); } catch { /* none */ } ok(); }
      else if (m.type === 'text') { waits.get(m.id)?.(m.text); }
      else if (m.type === 'audio') playChunk(m);
      else if (m.type === 'done') { if (speech?.id === m.id) { speech.complete = true; finishSpeech(); } }
      else if (m.type === 'error') {
        if (m.of === 'load') { bad(new Error(m.message)); drop(); }
        else if (m.of === 'transcribe') waits.get(m.id)?.(null);
        else if (m.of === 'speak' && speech?.id === m.id) { toast('The voice could not read that: ' + m.message, 'bad'); speech.complete = true; finishSpeech(); }
      }
    };
    w.onerror = e => { if (w === worker) { bad(new Error(e.message || 'The voice worker failed')); drop(); } };
    w.postMessage({ type: 'load', urls: URLS, asr: ASR_MODEL, tts: TTS_MODEL });
    return ready;
  }
  function drop() {   // the worker is gone: the next press starts a new one (a failed import is only forgotten that way)
    try { worker?.terminate(); } catch { /* none */ }
    worker = null; ready = null; loadNote = '';
    failReady?.(new Error('stopped')); failReady = null;
    if (state === 'idle') paintNote('');
    waits.forEach(r => r(null)); waits.clear();
  }

  // ── recording ───────────────────────────────────────────────────────────────────────────────────────────────────
  async function startRecording() {
    set('loading');
    const mine = run = Symbol();
    boot().catch(e => { if (e.message !== 'stopped') toast('The voice could not load: ' + e.message, 'bad'); });   // the models load while the person talks
    let stream, mic;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) throw new Error('This browser cannot record here: use Chrome or Edge');
      out ||= new AudioContext();   // made in the click, so the browser lets it play later
      out.resume().catch(() => { /* none */ });
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
        .catch(e => { throw new Error(e?.name === 'NotFoundError' ? 'No microphone was found' : e?.name === 'NotReadableError' ? 'The microphone is in use by another app' : 'The microphone is blocked for this site'); });
      if (run !== mine) { stream.getTracks().forEach(t => t.stop()); return; }
      mic = new AudioContext({ sampleRate: 16000 });
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
      try { await mic.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (run !== mine) { stream.getTracks().forEach(t => t.stop()); mic.close().catch(() => {}); return; }
      const node = new AudioWorkletNode(mic, 'tap'), mute = mic.createGain();
      mute.gain.value = 0;   // the tap is pulled by the graph only when it reaches the destination
      mic.createMediaStreamSource(stream).connect(node);
      node.connect(mute).connect(mic.destination);
      const chunks = [];
      node.port.onmessage = e => { chunks.push(e.data); if (chunks.length >= MAX_SECONDS * 10) stopRecording(true, true); };
      const t0 = Date.now();
      const tick = setInterval(() => { if (state === 'recording') paintNote('● ' + clock((Date.now() - t0) / 1000) + ' / 2:00'); }, 250);
      rec = { stream, mic, node, chunks, tick, mine };
      set('recording', '● 0:00 / 2:00');
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop()); try { mic?.close(); } catch { /* none */ }
      if (run === mine) { run = null; set('idle'); toast(e.message || 'The microphone did not start', 'bad'); }
    }
  }

  function releaseRecording() {
    const r = rec; rec = null;
    if (!r) return null;
    clearInterval(r.tick);
    try { r.node.port.onmessage = null; r.node.disconnect(); } catch { /* none */ }
    try { r.stream.getTracks().forEach(t => t.stop()); } catch { /* none */ }
    try { r.mic.close().catch(() => {}); } catch { /* none */ }
    return r;
  }

  async function stopRecording(send, auto = false) {
    const r = releaseRecording();
    if (!r) return;
    if (!send) { set('idle'); return; }
    if (auto) toast('Two minutes: sending what you said', '');
    const audio = new Float32Array(r.chunks.length * CHUNK);
    r.chunks.forEach((c, i) => audio.set(c, i * CHUNK));
    await handle(r.mine, audio);
  }

  // ── what was said → text → the assistant → the voice ────────────────────────────────────────────────────────────────
  async function handle(mine, audio) {
    if (audio.length < MIN_SAMPLES) { run = null; set('idle'); toast('Too short: click, talk, click again', ''); return; }
    set('transcribing', loadNote || 'Writing down what you said…');
    try { await boot(); } catch (e) { if (run === mine) { run = null; set('idle'); toast('The voice could not load: ' + e.message, 'bad'); } return; }
    if (run !== mine) return;
    set('transcribing', 'Writing down what you said…');
    const id = ++seq;
    const text = await new Promise(res => { waits.set(id, res); worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]); });
    waits.delete(id);
    if (run !== mine) return;
    if (text === null) { run = null; set('idle'); toast('The voice could not write that down', 'bad'); return; }
    if (!text || NOISE.test(text)) { run = null; set('idle'); toast('I did not catch that', ''); return; }
    set('thinking', 'Thinking…');
    let r = null;
    try { r = await ask(text); } catch { /* the panel already says what went wrong */ }
    if (run !== mine) return;
    if (r?.reply || r?.cards) await speak(spokenText(r.reply, r.cards), mine);
    if (run === mine) { run = null; set('idle'); }
  }

  // ── speaking: the text is already on screen; the voice follows it sentence by sentence ──────────────────────────────
  function speak(text, mine) {
    return new Promise(done => {
      if (!worker || !sentencesOf(text).length) { done(); return; }
      const id = ++seq;
      speech = { id, mine, next: 0, sources: [], complete: false, done };
      set('speaking', 'Reading… click to stop');
      worker.postMessage({ type: 'speak', id, sentences: lead(sentencesOf(text)), voice: localVoice() });
    });
  }
  function playChunk(m) {
    if (!speech || speech.id !== m.id || !out) return;
    const buf = out.createBuffer(1, m.audio.length, m.rate);
    buf.copyToChannel(m.audio, 0);
    const src = out.createBufferSource();
    src.buffer = buf; src.connect(out.destination);
    const at = Math.max(out.currentTime + 0.05, speech.next);
    src.start(at); speech.next = at + buf.duration;
    speech.sources.push(src);
    src.onended = () => { if (speech?.id === m.id) { speech.sources = speech.sources.filter(s => s !== src); finishSpeech(); } };
  }
  function finishSpeech() {
    if (speech?.complete && !speech.sources.length) { const d = speech.done; speech = null; d(); }
  }
  function stopSpeech() {
    const s = speech; speech = null;
    if (!s) return;
    try { worker?.postMessage({ type: 'cancel', id: s.id }); } catch { /* none */ }
    s.sources.forEach(x => { try { x.onended = null; x.stop(); } catch { /* ended */ } });
    s.done();
  }

  // ── the button ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function cancel() {   // the band closed, another page, another FarmBox, a new chat: nothing recorded or read goes on
    run = null;
    releaseRecording(); stopSpeech();
    set('idle');
  }
  function toggle() {
    if (state === 'recording') { stopRecording(true); return; }
    if (state === 'speaking') { stopSpeech(); run = null; startRecording(); return; }   // click over the voice: it stops, and you talk
    if (state === 'transcribing' || state === 'thinking' || state === 'loading' || state === 'preparing') { cancel(); return; }
    if (state === 'idle') startRecording();
  }
  button.onclick = toggle;

  // an answer read aloud without a spoken question: its own button, or every answer when this device asks for it
  function read(text, cards = 0, full = false) {
    if (state === 'speaking') { stopSpeech(); run = null; set('idle'); return; }   // the same button again stops it
    if (state !== 'idle') return;   // not over a recording, nor while a spoken question is on its way
    const t = spokenText(text, cards, full);
    if (!t) return;
    try { out ||= new AudioContext(); out.resume().catch(() => { /* none */ }); } catch { return; }
    const mine = run = Symbol();
    set('preparing', loadNote || 'Preparing the voice…');
    boot().then(async () => {
      if (run !== mine) return;
      await speak(t, mine);
      if (run === mine) { run = null; set('idle'); }
    }).catch(e => { if (run === mine) { run = null; set('idle'); if (e.message !== 'stopped') toast('The voice could not load: ' + e.message, 'bad'); } });
  }

  return {
    button, note, toggle, cancel, read,
    warm() { let was = false; try { was = !!localStorage.getItem(READY_KEY); } catch { /* none */ } if (!worker && was) boot().catch(() => { /* heard again at the first press */ }); },
    hush() { if (state === 'speaking' || state === 'preparing') { stopSpeech(); run = null; set('idle'); } },   // a typed question: the old answer stops being read
    destroy() { cancel(); drop(); try { out?.close().catch(() => {}); } catch { /* none */ } out = null; },
  };
}
