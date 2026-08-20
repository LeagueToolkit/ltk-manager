import { useEffect, useState } from "react";

import { api } from "@/lib/tauri";
/* The layout sub-barrel rather than the module barrel, for the same reason
   `@/stores/workshopEditor` does: the full barrel pulls the editor's
   components, whose imports circle back into workshop state. */
import { singleLeaf } from "@/modules/editor/layout";
import { EMPTY_EDITOR, type ProjectEditor, useWorkshopEditorStore } from "@/stores";

import type { ContentDocument } from "../documents";
import {
  parseEditorFile,
  type PersistedProjectEditor,
  sanitizeEditorState,
  serializeEditorFile,
} from "./editorFile";

/* The zustand persist key the store wrote before `.ltk/editor.json` existed.
   Read once to seed a project's first file, and never written or cleared, so
   rolling back to a build that still uses it loses nothing. */
const LEGACY_STORAGE_KEY = "ltk-workshop-documents";

const WRITE_DEBOUNCE_MS = 500;

/** What version 1 of the browser-storage store held per project: a flat strip. */
interface ProjectEditorV1 {
  open?: ContentDocument[];
  activeId?: string | null;
  selectedLayer?: string | null;
}

/**
 * Convert a v1 browser-storage state into the persisted shape: each strip
 * becomes one leaf carrying its ids.
 *
 * Exported so a test can hand it a stored blob directly rather than faking the
 * storage envelope around it.
 */
export function migrateFromV1(persisted: unknown): {
  byProject: Record<string, PersistedProjectEditor>;
} {
  const stored = (persisted as { byProject?: Record<string, ProjectEditorV1> } | null)?.byProject;

  const byProject: Record<string, PersistedProjectEditor> = {};
  for (const [path, editor] of Object.entries(stored ?? {})) {
    const open = editor.open ?? [];
    const layout = singleLeaf(
      open.map((document) => document.id),
      editor.activeId ?? null,
    );
    byProject[path] = {
      documents: Object.fromEntries(open.map((document) => [document.id, document])),
      layout,
      activeLeafId: layout.id,
      selectedLayer: editor.selectedLayer ?? null,
      // The old store had no ephemeral tab, so every migrated one is permanent.
      previewId: null,
    };
  }
  return { byProject };
}

/**
 * One project's entry out of the old browser-storage store, sanitised, or null.
 *
 * The zustand persist envelope was `{ state: { byProject }, version }`, with
 * version 2 entries already in the persisted shape and older ones a flat strip
 * that `migrateFromV1` converts.
 */
export function readLegacyEditorSeed(projectPath: string): PersistedProjectEditor | null {
  let envelope: unknown;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return null;
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof envelope !== "object" || envelope === null) return null;

  const { state, version } = envelope as { state?: unknown; version?: unknown };
  const stored = typeof version === "number" && version < 2 ? migrateFromV1(state) : state;
  const entry = (stored as { byProject?: Record<string, unknown> } | null | undefined)?.byProject?.[
    projectPath
  ];
  return entry === undefined ? null : sanitizeEditorState(entry);
}

function persistedSlice(editor: ProjectEditor | undefined): PersistedProjectEditor | null {
  if (!editor) return null;
  return {
    documents: editor.documents,
    layout: editor.layout,
    activeLeafId: editor.activeLeafId,
    selectedLayer: editor.selectedLayer,
    previewId: editor.previewId,
  };
}

/* Field-by-field identity is what separates a persisted change from a
   memory-only one: toggling a dirty flag makes a fresh editor object but keeps
   these references, and the tree ops keep them for a no-op action. */
function sameSlice(a: PersistedProjectEditor | null, b: PersistedProjectEditor | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.documents === b.documents &&
    a.layout === b.layout &&
    a.activeLeafId === b.activeLeafId &&
    a.selectedLayer === b.selectedLayer &&
    a.previewId === b.previewId
  );
}

/**
 * Keep one project's editor in step with its `.ltk/editor.json`.
 *
 * On mount it reads the file and hydrates the store, seeding from the old
 * browser-storage entry when no file exists yet. Once hydrated it writes the
 * persisted slice back on change, debounced, flushing the pending write on
 * unmount. A file from a newer build still mounts, as a fresh editor whose
 * writes are refused, so an older app never clobbers it.
 *
 * Returns whether the editor is safe to mount. Rendering it earlier would let
 * its bootstrap race the hydration and get overwritten by it.
 */
export function useEditorPersistence(projectPath: string): boolean {
  const [readyPath, setReadyPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: string | null = null;

    const schedule = (serialized: string) => {
      pending = serialized;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        void api.saveProjectEditorState(projectPath, serialized);
      }, WRITE_DEBOUNCE_MS);
    };

    /* A rename or delete drops the path from the store before this cleanup
       runs, and writing then would resurrect the old directory, so a pending
       write for a path the store no longer holds is discarded instead. */
    const flush = () => {
      if (timer !== null) clearTimeout(timer);
      if (pending !== null && projectPath in useWorkshopEditorStore.getState().byProject) {
        void api.saveProjectEditorState(projectPath, pending);
      }
      timer = null;
      pending = null;
    };

    const startWriting = () => {
      let last = persistedSlice(useWorkshopEditorStore.getState().byProject[projectPath]);
      unsubscribe = useWorkshopEditorStore.subscribe((state) => {
        const slice = persistedSlice(state.byProject[projectPath]);
        if (sameSlice(slice, last)) return;
        last = slice;
        if (slice) schedule(serializeEditorFile(slice));
      });
    };

    void (async () => {
      const read = await api.getProjectEditorState(projectPath);
      if (cancelled) return;

      /* An entry already in memory is newer than anything on disk - the file
         mirrors it - so a remount keeps it rather than re-hydrating over the
         fields that never persist. */
      const alreadyHeld = projectPath in useWorkshopEditorStore.getState().byProject;
      const raw = read.ok ? read.value : null;
      const parsed = raw === null ? null : parseEditorFile(raw);

      if (parsed?.kind === "newer") {
        if (!alreadyHeld) {
          useWorkshopEditorStore.getState().hydrateProject(projectPath, EMPTY_EDITOR);
        }
        setReadyPath(projectPath);
        return;
      }

      if (!alreadyHeld) {
        if (parsed?.kind === "ok") {
          useWorkshopEditorStore.getState().hydrateProject(projectPath, parsed.state);
        } else {
          const seed = readLegacyEditorSeed(projectPath);
          useWorkshopEditorStore.getState().hydrateProject(projectPath, seed ?? EMPTY_EDITOR);
          if (seed) schedule(serializeEditorFile(seed));
        }
      }
      startWriting();
      setReadyPath(projectPath);
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      flush();
    };
  }, [projectPath]);

  return readyPath === projectPath;
}
