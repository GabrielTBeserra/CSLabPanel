export type SoundName = "click" | "ban" | "pick" | "join" | "notify" | "error" | "start";

const STORAGE_KEY = "cshome:muted";
let context: AudioContext | null = null;
let muted = localStorage.getItem(STORAGE_KEY) === "1";
const listeners = new Set<(value: boolean) => void>();

export const isMuted = () => muted;

export const setMuted = (value: boolean) => {
  muted = value;
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  listeners.forEach((listener) => listener(value));
};

export const onMutedChange = (listener: (value: boolean) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const tone = (ctx: AudioContext, freq: number, start: number, duration: number, type: OscillatorType, gain: number, slideTo?: number) => {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + duration);
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
};

const noise = (ctx: AudioContext, duration: number, gain: number) => {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  amp.gain.value = gain;
  src.buffer = buffer;
  src.connect(filter).connect(amp).connect(ctx.destination);
  src.start();
};

const SOUNDS: Record<SoundName, (ctx: AudioContext) => void> = {
  click: (ctx) => tone(ctx, 1400, 0, 0.04, "square", 0.04),
  ban: (ctx) => { noise(ctx, 0.25, 0.35); tone(ctx, 180, 0, 0.3, "sawtooth", 0.08, 60); },
  pick: (ctx) => { tone(ctx, 520, 0, 0.12, "triangle", 0.12); tone(ctx, 780, 0.09, 0.18, "triangle", 0.12); },
  join: (ctx) => { tone(ctx, 440, 0, 0.08, "sine", 0.1); tone(ctx, 660, 0.07, 0.12, "sine", 0.1); },
  notify: (ctx) => { tone(ctx, 880, 0, 0.1, "sine", 0.09); tone(ctx, 880, 0.16, 0.1, "sine", 0.09); },
  error: (ctx) => tone(ctx, 220, 0, 0.22, "square", 0.05, 140),
  start: (ctx) => { [0, 0.12, 0.24].forEach((t, i) => tone(ctx, 500 + i * 160, t, 0.12, "square", 0.05)); tone(ctx, 1100, 0.4, 0.35, "triangle", 0.1); },
};

export const play = (name: SoundName) => {
  if (muted) return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    SOUNDS[name](context);
  } catch {
    context = null;
  }
};
