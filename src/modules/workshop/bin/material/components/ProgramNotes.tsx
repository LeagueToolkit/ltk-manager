import { useQuery } from "@tanstack/react-query";

import { m } from "@/i18n";
import type { BinDocumentId, MaterialProgram, MaterialWarning } from "@/lib/tauri";

import { materialQueries } from "../api/materialQueries";
import { warningText } from "../utils/materialWarnings";

/** The warnings about the material as a whole. The rest mark their own row of the inspector. */
const MATERIAL_WARNINGS: ReadonlySet<MaterialWarning["kind"]> = new Set([
  "noShaderDefs",
  "noPass",
  "unresolvedShader",
]);

interface Note {
  readonly tone: "danger" | "muted";
  readonly text: string;
  readonly detail?: string;
}

function notesOf(program: MaterialProgram): Note[] {
  const notes: Note[] = [];

  for (const pass of program.passes) {
    if (pass.program.kind === "failed") {
      notes.push({
        tone: "danger",
        text: m.workshop_bin_material_program_failed_label(),
        detail: pass.program.reason,
      });
    }
  }
  const drawn = program.passes.some((pass) => pass.program.kind === "ready");
  if (!drawn && notes.length === 0) {
    notes.push({ tone: "danger", text: m.workshop_bin_material_preview_no_program_empty() });
  }

  for (const warning of program.warnings) {
    if (MATERIAL_WARNINGS.has(warning.kind)) {
      notes.push({ tone: "muted", text: warningText(warning) });
    }
  }
  if (program.animated) {
    notes.push({ tone: "muted", text: m.workshop_bin_material_animated_hint() });
  }
  return notes;
}

/**
 * Why the preview draws what it does, over its corner: a pass that did not build, and the
 * warnings about the material as a whole. Nothing where the material draws as written.
 */
export function ProgramNotes({
  document,
  entry,
}: {
  document: BinDocumentId;
  entry: string | null;
}) {
  const program = useQuery(materialQueries.program(document, entry)).data ?? null;
  const notes = program === null ? [] : notesOf(program);
  if (notes.length === 0) return null;

  return (
    <ul
      data-ui="ProgramNotes"
      /* DS-GLASS, DS-RADIUS */
      className="absolute top-2 left-2 z-10 flex max-w-[60%] flex-col gap-0.5 rounded-md bg-scrim px-2 py-1 text-meta backdrop-blur-sm"
    >
      {notes.map((note, at) => (
        <li key={at} className="flex min-w-0 flex-col">
          {/* DS-TEXT */}
          <span
            className={
              note.tone === "danger"
                ? "text-danger-text select-none"
                : "text-surface-300 select-none"
            }
          >
            {note.text}
          </span>
          {note.detail !== undefined && (
            <span
              className="truncate font-mono text-code text-surface-400 select-text"
              title={note.detail}
            >
              {note.detail}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
