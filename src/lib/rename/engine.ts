import { useLibraryStore } from "@/lib/library-store";
import {
  ensurePermission,
  loadDirectoryHandle,
  resolveFileHandle,
  renameFileInPlace,
} from "./dir-handle";
import {
  loadHistory,
  pushOperation,
  markUndone,
  type RenameChange,
  type RenameOperation,
} from "./history";
import type { RenamePreviewItem } from "./templates";

export interface ApplyProgress {
  done: number;
  total: number;
  current?: string;
}

export interface ApplyResult {
  applied: RenameChange[];
  failed: Array<{ item: RenamePreviewItem; reason: string }>;
  operationId: string | null;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * Apply a previewed rename batch to the local filesystem and synchronise the library.
 * Aborts cleanly on permission denial; per-file failures are reported but do not stop the batch.
 */
export async function applyRename(
  template: string,
  items: RenamePreviewItem[],
  onProgress?: (p: ApplyProgress) => void,
): Promise<ApplyResult> {
  const changes = items.filter((i) => !i.unchanged);
  if (changes.length === 0) {
    return { applied: [], failed: [], operationId: null };
  }

  const lib = useLibraryStore.getState().library;
  if (!lib) throw new Error("Aucune bibliothèque active");

  const root = await loadDirectoryHandle(lib.id);
  if (!root) throw new Error("Aucun accès au dossier — autorisez l'accès au dossier d'abord.");
  const granted = await ensurePermission(root, "readwrite");
  if (!granted) throw new Error("Permission d'écriture refusée");

  const applied: RenameChange[] = [];
  const failed: ApplyResult["failed"] = [];
  const update = useLibraryStore.getState().updateTrack;

  let done = 0;
  for (const item of changes) {
    onProgress?.({ done, total: changes.length, current: item.oldName });
    const resolved = await resolveFileHandle(root, item.oldPath);
    if (!resolved) {
      failed.push({ item, reason: "Fichier introuvable" });
      done++;
      continue;
    }
    // Conflict guard: another file with the target name in the same folder
    try {
      const existing = await resolved.parent.getFileHandle(item.newName);
      if (existing && item.newName.toLowerCase() !== resolved.name.toLowerCase()) {
        failed.push({ item, reason: "Nom déjà utilisé" });
        done++;
        continue;
      }
    } catch {
      /* not found, good */
    }

    const ok = await renameFileInPlace(resolved.handle, item.newName);
    if (!ok) {
      failed.push({ item, reason: "Renommage refusé par le navigateur" });
      done++;
      continue;
    }

    update(item.trackId, {
      fileName: item.newName,
      filePath: item.newPath,
      title: stripExt(item.newName),
    });
    applied.push({
      trackId: item.trackId,
      oldPath: item.oldPath,
      newPath: item.newPath,
      oldName: item.oldName,
      newName: item.newName,
    });
    done++;
    onProgress?.({ done, total: changes.length, current: item.newName });
  }

  await useLibraryStore.getState().flush();

  let operationId: string | null = null;
  if (applied.length > 0) {
    const op: RenameOperation = {
      id: `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      libraryId: lib.id,
      libraryName: lib.name,
      template,
      at: Date.now(),
      changes: applied,
    };
    await pushOperation(op);
    operationId = op.id;
  }

  return { applied, failed, operationId };
}

export async function undoOperation(opId: string, onProgress?: (p: ApplyProgress) => void): Promise<ApplyResult> {
  const list = await loadHistory();
  const op = list.find((o) => o.id === opId);
  if (!op) throw new Error("Opération introuvable");
  if (op.undone) throw new Error("Opération déjà annulée");

  const lib = useLibraryStore.getState().library;
  const root = lib ? await loadDirectoryHandle(lib.id) : null;
  if (!root) throw new Error("Aucun accès au dossier — autorisez l'accès au dossier d'abord.");
  const granted = await ensurePermission(root, "readwrite");
  if (!granted) throw new Error("Permission d'écriture refusée");

  const applied: RenameChange[] = [];
  const failed: ApplyResult["failed"] = [];
  const update = useLibraryStore.getState().updateTrack;

  let done = 0;
  // Reverse rename: newPath -> oldPath/oldName
  for (const c of op.changes) {
    const reverseItem: RenamePreviewItem = {
      trackId: c.trackId,
      oldName: c.newName,
      newName: c.oldName,
      oldPath: c.newPath,
      newPath: c.oldPath,
      unchanged: false,
      conflict: false,
    };
    onProgress?.({ done, total: op.changes.length, current: c.newName });
    const resolved = await resolveFileHandle(root, c.newPath);
    if (!resolved) {
      failed.push({ item: reverseItem, reason: "Fichier introuvable" });
      done++;
      continue;
    }
    const ok = await renameFileInPlace(resolved.handle, c.oldName);
    if (!ok) {
      failed.push({ item: reverseItem, reason: "Renommage refusé par le navigateur" });
      done++;
      continue;
    }
    update(c.trackId, {
      fileName: c.oldName,
      filePath: c.oldPath,
      title: stripExt(c.oldName),
    });
    applied.push({
      trackId: c.trackId,
      oldPath: c.newPath,
      newPath: c.oldPath,
      oldName: c.newName,
      newName: c.oldName,
    });
    done++;
  }

  await useLibraryStore.getState().flush();
  await markUndone(op.id);
  return { applied, failed, operationId: op.id };
}