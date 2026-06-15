import { createStore, get as idbGet, set as idbSet } from "idb-keyval";

export interface TrackAnalysis {
  fileHash: string;
  bpm: number | null;
  key: string | null;     // human label, e.g. "A minor"
  camelot: string | null; // e.g. "8A"
  durationSec: number;
  analyzedAt: number;
}

const store = createStore("tempokey-analysis", "cache");

export async function getCachedAnalysis(fileHash: string): Promise<TrackAnalysis | null> {
  try {
    const v = (await idbGet(fileHash, store)) as TrackAnalysis | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

export async function setCachedAnalysis(a: TrackAnalysis): Promise<void> {
  try {
    await idbSet(a.fileHash, a, store);
  } catch {
    // ignore – analysis cache is non-critical
  }
}