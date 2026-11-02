import { m } from "@/i18n";
import type { BinDocumentId, MaterialProgram, MaterialWarning } from "@/lib/tauri";

import { useMaterialProgram } from "../hooks/useMaterialProgram";
import { warningText } from "../utils/materialWarnings";

/** The warnings about the material as a whole. The rest mark their own row of the inspector. */
const MATERIAL_WARNINGS: ReadonlySet<MaterialWarning["kind"]> = new Set([
  "noShaderDefs",
  "noPass",
  "unresolvedShader",
  "nearestPermutation",
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
  shader = false,
}: {
  document: BinDocumentId;
  entry: string | null;
  /** `true` if `entry` is a `CustomShaderDef`, read with the preview material and defines. */
  shader?: boolean;
}) {
  const program = useMaterialProgram(document, entry, shader).data ?? null;
  const notes = program === null ? [] : notesOf(program);
  if (notes.length === 0) return null;

  return (
    <ul
      data-ui="ProgramNotes"
      /* DS-GLASS, DS-RADIUS. `top-11` clears the rail of `MaterialViewport`, which the notes overlay from `MaterialPreview`. */
      className="absolute top-11 left-2 z-10 flex max-w-[60%] flex-col gap-0.5 rounded-md bg-scrim px-2 py-1 text-meta backdrop-blur-sm"
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
              className="line-clamp-3 font-mono text-code break-all text-surface-400 select-text"
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
