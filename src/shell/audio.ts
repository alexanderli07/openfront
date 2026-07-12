// Web Audio notification sound — no asset shipped.
//
// The "lobby found" chime is synthesized at runtime (two short tones), so the
// userscript carries zero audio bytes and isn't subject to the page's missing
// media-src CSP. A custom base64 data-URL sound is still honored if one is set.
//
// The content engine constructs `new Audio(src)`; we shadow Audio with this so
// its .play() rings the chime. Surface: new Audio(src), .src, .preload,
// .currentTime, .volume, .loop, play(), pause().

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

function installGestureResume(): void {
  const resume = () => {
    if (ctx && ctx.state === "suspended") void ctx.resume();
  };
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", resume, opts);
  window.addEventListener("keydown", resume, opts);
}

// A short, friendly two-note chime.
function playChime(volume: number): void {
  const context = getCtx();
  const now = context.currentTime;
  const notes = [
    { freq: 880, start: 0, dur: 0.16 }, // A5
    { freq: 1318.5, start: 0.13, dur: 0.22 }, // E6
  ];
  for (const note of notes) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.value = note.freq;
    const t0 = now + note.start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.25 * volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    osc.connect(gain).connect(context.destination);
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const decodeCache = new Map<string, Promise<AudioBuffer | null>>();

function decodeCustom(src: string): Promise<AudioBuffer | null> {
  let cached = decodeCache.get(src);
  if (cached) return cached;
  cached = (async () => {
    const marker = ";base64,";
    const idx = src.indexOf(marker);
    if (!src.startsWith("data:") || idx < 0) return null;
    try {
      return await getCtx().decodeAudioData(base64ToArrayBuffer(src.slice(idx + marker.length)));
    } catch (error) {
      console.error("[ofh] custom sound decode failed:", error);
      return null;
    }
  })();
  decodeCache.set(src, cached);
  return cached;
}

export class WebAudioElement {
  src: string;
  preload = "auto";
  currentTime = 0;
  volume = 1;
  loop = false;

  constructor(src = "") {
    this.src = src;
  }

  async play(): Promise<void> {
    const context = getCtx();
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        /* needs a user gesture first — same as HTMLAudioElement */
      }
    }
    // A real base64 sound (custom upload) -> play it; otherwise the chime.
    const buffer = this.src.startsWith("data:") ? await decodeCustom(this.src) : null;
    if (buffer) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = this.volume;
      source.connect(gain).connect(context.destination);
      source.start(0);
    } else {
      playChime(this.volume);
    }
  }

  pause(): void {
    /* one-shot sounds; nothing to pause */
  }
}

/** Directly ring the chime (used by the popup's "test sound" button). */
export function ringChime(): void {
  const context = getCtx();
  if (context.state === "suspended") void context.resume();
  playChime(1);
}

export function installAudio(): typeof WebAudioElement {
  installGestureResume();
  return WebAudioElement;
}
