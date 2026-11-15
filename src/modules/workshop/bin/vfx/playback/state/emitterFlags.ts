import { use, useCallback, useMemo } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api, type PropertyEdit } from "@/lib/tauri";

import { nameHash } from "../../../shared/utils/binHash";
import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import type { EmitterModel, SystemModel } from "../../engine/model/model";

/** `VfxEmitterDefinitionData.disabled`. */
const DISABLED = nameHash("disabled");

/** The two emitter lists, by whether an emitter is simple. */
const LIST = {
  complex: nameHash("complexEmitterDefinitionData").slice(2),
  simple: nameHash("simpleEmitterDefinitionData").slice(2),
} as const;

const NONE: ReadonlySet<number> = new Set();

/** The emitters whose `disabled` flag is set, and the write that sets the flags of a new set. */
export interface EmitterFlags {
  /** The indices of the system's emitters that set `disabled`. An engine gate is not counted. */
  readonly disabled: ReadonlySet<number>;
  /** False if the document takes no edit, so the flags cannot be written. */
  readonly writable: boolean;
  /** Writes `disabled` on every emitter whose membership in `next` differs, as one edit. */
  readonly write: (next: ReadonlySet<number>) => void;
}

/**
 * Returns the `disabled` flags of `system`'s emitters, and their write.
 *
 * An emitter that the engine leaves out for another reason, such as its importance at the
 * effects quality, is not counted: its own flag is not what hides it. A refused write shows a
 * toast and changes nothing.
 */
export function useEmitterFlags(system: SystemModel | null, entry: string): EmitterFlags {
  const edit = use(LeafEditContext);
  const toast = useToast();
  const send = edit?.send;
  const landed = edit?.landed;

  const disabled = useMemo(
    () =>
      system === null
        ? NONE
        : new Set(system.emitters.filter(setsDisabled).map((emitter) => emitter.index)),
    [system],
  );

  const write = useCallback(
    (next: ReadonlySet<number>) => {
      if (system === null || send === undefined || landed === undefined) return;

      const edits = flagEdits(system.emitters, entry, disabled, next);
      if (edits.length === 0) return;

      void send((id) => api.bin.edit(id, { kind: "editProperties", edits })).then(
        ({ result, id }) => {
          if (result.ok) {
            landed(id);
            return;
          }
          toast.failure(m.workshop_bin_edit_refused_title(), result.error);
        },
      );
    },
    [system, entry, disabled, send, landed, toast],
  );

  return { disabled, writable: send !== undefined && landed !== undefined, write };
}

/**
 * Returns one edit per emitter of `emitters` whose membership in `next` differs from `held`,
 * each writing `disabled` as its membership in `next`.
 */
export function flagEdits(
  emitters: readonly EmitterModel[],
  entry: string,
  held: ReadonlySet<number>,
  next: ReadonlySet<number>,
): PropertyEdit[] {
  return emitters
    .filter((emitter) => next.has(emitter.index) !== held.has(emitter.index))
    .map((emitter) => flagEdit(entry, emitter, next.has(emitter.index)));
}

/** Returns true if `emitter` sets its own `disabled` flag. */
export function setsDisabled(emitter: EmitterModel): boolean {
  /* The flag is the engine's first test, so an emitter that sets it names no other gate. */
  return emitter.disabled && emitter.culled === null;
}

/** Returns the edit that writes `value` into `emitter`'s `disabled`, adding the field if absent. */
function flagEdit(entry: string, emitter: EmitterModel, value: boolean): PropertyEdit {
  return {
    entry,
    holder: `${emitter.simple ? LIST.simple : LIST.complex}[${emitter.listIndex}]`,
    field: DISABLED,
    edits: [{ type: "setLeaf", path: "", value: { type: "bool", value } }],
  };
}
