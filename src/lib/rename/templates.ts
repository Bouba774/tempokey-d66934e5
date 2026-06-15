import type { Track } from "@/lib/library-store";

export type TemplateId =
  | "num2"
  | "num3"
  | "num4"
  | "bpm"
  | "bpm-key"
  | "dj-order"
  | "custom";

export interface TemplateOption {
  id: TemplateId;
  label: string;
  description: string;
  example: string;
}

export const TEMPLATES: TemplateOption[] = [
  { id: "num3", label: "Numérotation 001", description: "Préfixe à 3 chiffres", example: "001 - Track.mp3" },
  { id: "num2", label: "Numérotation 01", description: "Préfixe à 2 chiffres", example: "01 - Track.mp3" },
  { id: "num4", label: "Numérotation 0001", description: "Préfixe à 4 chiffres", example: "0001 - Track.mp3" },
  { id: "bpm", label: "BPM", description: "Préfixe BPM", example: "128 BPM - Track.mp3" },
  { id: "bpm-key", label: "BPM + Key", description: "Préfixe BPM et tonalité Camelot", example: "128 BPM - 8A - Track.mp3" },
  { id: "dj-order", label: "Ordre DJ", description: "Trié par BPM avec numérotation", example: "001 - 128 BPM - 8A - Track.mp3" },
  { id: "custom", label: "Personnalisé", description: "Format avec variables", example: "{ORDER} - {BPM} - {KEY} - {TITLE}" },
];

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

export function sanitizeName(name: string): string {
  return name.replace(FORBIDDEN, "_").replace(/\s+/g, " ").trim();
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

function formatBpm(t: Track): string {
  return t.bpm != null ? `${Math.round(t.bpm)} BPM` : "—";
}

function formatCamelot(t: Track): string {
  return t.camelot ?? "—";
}

function formatKey(t: Track): string {
  return t.camelot ?? t.key ?? "—";
}

function formatDuration(t: Track): string {
  return t.duration ?? "—";
}

interface OrderingResult {
  ordered: Track[];
  orderById: Map<string, number>;
}

/**
 * Determine display order. We *always* preserve the caller's input order so
 * the renaming respects the global active order chosen elsewhere in the app
 * (Auto Mix Order, Harmonic Mixing, Set Builder, manual reorder, etc.).
 */
function orderTracks(_template: TemplateId, tracks: Track[]): OrderingResult {
  const ordered = tracks.slice();
  const orderById = new Map<string, number>();
  ordered.forEach((t, i) => orderById.set(t.id, i + 1));
  return { ordered, orderById };
}

function widthForCount(n: number): number {
  if (n < 100) return 2;
  if (n < 1000) return 3;
  if (n < 10000) return 4;
  return Math.max(4, String(n).length);
}

/** Compute the new base name (without extension) for one track given a template. */
function buildName(
  template: TemplateId,
  customFormat: string,
  t: Track,
  order: number,
  total: number,
): string {
  const width = widthForCount(total);
  switch (template) {
    case "num2":
      return `${pad(order, 2)} - ${t.title}`;
    case "num3":
      return `${pad(order, 3)} - ${t.title}`;
    case "num4":
      return `${pad(order, 4)} - ${t.title}`;
    case "bpm":
      return `${formatBpm(t)} - ${t.title}`;
    case "bpm-key":
      return `${formatBpm(t)} - ${formatCamelot(t)} - ${t.title}`;
    case "dj-order":
      return `${pad(order, Math.max(3, width))} - ${formatBpm(t)} - ${formatCamelot(t)} - ${t.title}`;
    case "custom": {
      const w = Math.max(3, width);
      return customFormat
        .replace(/\{ORDER\}/g, pad(order, w))
        .replace(/\{BPM\}/g, formatBpm(t))
        .replace(/\{CAMELOT\}/g, formatCamelot(t))
        .replace(/\{KEY\}/g, formatKey(t))
        .replace(/\{TITLE\}/g, t.title)
        .replace(/\{DURATION\}/g, formatDuration(t));
    }
  }
}

export interface RenamePreviewItem {
  trackId: string;
  oldName: string;
  newName: string;
  oldPath: string;
  newPath: string;
  unchanged: boolean;
  conflict: boolean;
}

export interface PreviewResult {
  items: RenamePreviewItem[];
  changeCount: number;
  conflictCount: number;
}

/** Build a full preview (no I/O). Conflict detection is internal to the batch + parent folder. */
export function buildPreview(
  template: TemplateId,
  customFormat: string,
  tracks: Track[],
): PreviewResult {
  if (tracks.length === 0) return { items: [], changeCount: 0, conflictCount: 0 };

  const { ordered, orderById } = orderTracks(template, tracks);
  const total = ordered.length;

  // Group by parent folder to detect intra-batch collisions per directory.
  const usedPerDir = new Map<string, Set<string>>();
  const items: RenamePreviewItem[] = [];

  // Iterate in the order supplied by the caller (= active library order).
  const seq = ordered;



  for (const t of seq) {
    const order = orderById.get(t.id) ?? 1;
    const ext = t.extension ? `.${t.extension}` : "";
    const rawBase = buildName(template, customFormat, t, order, total);
    const base = sanitizeName(rawBase) || t.title;
    const desiredName = `${base}${ext}`;

    const slashIdx = t.filePath.lastIndexOf("/");
    const dir = slashIdx > 0 ? t.filePath.slice(0, slashIdx) : "";
    const used = usedPerDir.get(dir) ?? new Set<string>();

    // Auto-suffix on collision within this batch
    let finalName = desiredName;
    if (used.has(finalName.toLowerCase()) && finalName.toLowerCase() !== t.fileName.toLowerCase()) {
      let i = 1;
      while (used.has(`${base}_${i}${ext}`.toLowerCase())) i++;
      finalName = `${base}_${i}${ext}`;
    }
    used.add(finalName.toLowerCase());
    usedPerDir.set(dir, used);

    const newPath = dir ? `${dir}/${finalName}` : finalName;
    items.push({
      trackId: t.id,
      oldName: t.fileName,
      newName: finalName,
      oldPath: t.filePath,
      newPath,
      unchanged: finalName === t.fileName,
      conflict: false,
    });
  }

  const changeCount = items.filter((i) => !i.unchanged).length;
  return { items, changeCount, conflictCount: 0 };
}