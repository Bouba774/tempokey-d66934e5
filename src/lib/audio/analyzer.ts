import { hashFile } from "./hash";
import { estimateBPM } from "./bpm";
import { estimateKey } from "./key";
import { toCamelot } from "./camelot";
import { getCachedAnalysis, setCachedAnalysis, type TrackAnalysis } from "./cache";

let ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (ctx) return ctx;
  const AC =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) throw new Error("Web Audio API non disponible");
  ctx = new AC();
  return ctx;
}

function decode(ac: AudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Safari may only support the callback form.
    try {
      const p = ac.decodeAudioData(buf, resolve, reject) as unknown as Promise<AudioBuffer> | undefined;
      if (p && typeof (p as Promise<AudioBuffer>).then === "function") {
        (p as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

function toMono(audio: AudioBuffer): Float32Array {
  const channels = audio.numberOfChannels;
  if (channels === 1) return audio.getChannelData(0);
  const len = audio.length;
  const out = new Float32Array(len);
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  const inv = 1 / channels;
  for (let i = 0; i < len; i++) out[i] *= inv;
  return out;
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function analyzeFile(file: File): Promise<TrackAnalysis> {
  const fileHash = await hashFile(file);
  const cached = await getCachedAnalysis(fileHash);
  if (cached) return cached;

  const buf = await file.arrayBuffer();
  const audio = await decode(getCtx(), buf);
  const mono = toMono(audio);

  // Yield to the UI thread between heavy passes.
  await new Promise<void>((r) => setTimeout(r, 0));
  const bpm = estimateBPM(mono, audio.sampleRate);

  await new Promise<void>((r) => setTimeout(r, 0));
  const keyRes = estimateKey(mono, audio.sampleRate);
  const camelot = keyRes ? toCamelot(keyRes) : null;

  const result: TrackAnalysis = {
    fileHash,
    bpm,
    key: keyRes?.label ?? null,
    camelot,
    durationSec: audio.duration,
    analyzedAt: Date.now(),
  };
  await setCachedAnalysis(result);
  return result;
}