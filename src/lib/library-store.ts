import { create } from "zustand";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

export const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "aac"] as const;
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export interface Track {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  extension: string;
  size: number | null;
  bpm: number | null;
  key: string | null;
  duration: string | null;
  analyzed: boolean;
}

export interface Library {
  id: string;
  name: string;
  createdAt: number;
  tracks: Track[];
}

interface LibraryMeta {
  id: string;
  name: string;
  createdAt: number;
  trackCount: number;
}

interface LibraryState {
  library: Library | null;
  lastLibraryMeta: LibraryMeta | null;
  hydrated: boolean;
  selectedIds: Set<string>;
  setLibrary: (lib: Library) => Promise<void>;
  hydrate: () => Promise<void>;
  restoreLast: () => Promise<boolean>;
  clearLibrary: () => Promise<void>;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
}

const IDB_LIBRARY_KEY = "tempokey:active-library";
const META_KEY = "tempokey:last-library-meta";

function isAudioFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return !!ext && (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export interface ImportProgress {
  phase: "scan" | "build" | "done";
  scanned: number;
  total: number;
}

export async function buildLibraryFromFiles(
  files: File[],
  onProgress?: (p: ImportProgress) => void,
): Promise<Library> {
  const audio = files.filter((f) => isAudioFile(f.name));
  const total = audio.length;
  onProgress?.({ phase: "scan", scanned: 0, total });

  const tracks: Track[] = new Array(total);
  for (let i = 0; i < total; i++) {
    const f = audio[i];
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    tracks[i] = {
      id: `${i}-${path}`,
      title: stripExt(f.name),
      fileName: f.name,
      filePath: path,
      extension: getExt(f.name),
      size: typeof f.size === "number" ? f.size : null,
      bpm: null,
      key: null,
      duration: null,
      analyzed: false,
    };
    if (i % 200 === 0) onProgress?.({ phase: "scan", scanned: i + 1, total });
  }
  onProgress?.({ phase: "build", scanned: total, total });

  // Derive folder name from common root segment of webkitRelativePath
  const firstPath = tracks[0]?.filePath ?? "";
  const folderName =
    firstPath.includes("/") ? firstPath.split("/")[0] : "Dossier importé";

  const lib: Library = {
    id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: folderName,
    createdAt: Date.now(),
    tracks,
  };
  onProgress?.({ phase: "done", scanned: total, total });
  return lib;
}

function metaOf(lib: Library): LibraryMeta {
  return { id: lib.id, name: lib.name, createdAt: lib.createdAt, trackCount: lib.tracks.length };
}

function loadMetaSync(): LibraryMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as LibraryMeta) : null;
  } catch {
    return null;
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: null,
  lastLibraryMeta: null,
  hydrated: false,
  selectedIds: new Set(),

  setLibrary: async (lib) => {
    const meta = metaOf(lib);
    try {
      await idbSet(IDB_LIBRARY_KEY, lib);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.error("[tempokey] persist failed", e);
    }
    set({ library: lib, lastLibraryMeta: meta, selectedIds: new Set() });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const meta = loadMetaSync();
    try {
      const lib = (await idbGet(IDB_LIBRARY_KEY)) as Library | undefined;
      set({
        library: lib ?? null,
        lastLibraryMeta: meta ?? (lib ? metaOf(lib) : null),
        hydrated: true,
      });
    } catch {
      set({ lastLibraryMeta: meta, hydrated: true });
    }
  },

  restoreLast: async () => {
    try {
      const lib = (await idbGet(IDB_LIBRARY_KEY)) as Library | undefined;
      if (!lib) return false;
      set({ library: lib, lastLibraryMeta: metaOf(lib), selectedIds: new Set() });
      return true;
    } catch {
      return false;
    }
  },

  clearLibrary: async () => {
    try {
      await idbDel(IDB_LIBRARY_KEY);
      localStorage.removeItem(META_KEY);
    } catch {}
    set({ library: null, lastLibraryMeta: null, selectedIds: new Set() });
  },

  toggleSelected: (id) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },
  clearSelection: () => set({ selectedIds: new Set() }),
}));