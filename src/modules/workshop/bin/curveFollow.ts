import { useEffect, useRef } from "react";

import { type CurveTarget, useCurveDock } from "./curveTarget";
import { emitterRows, fieldChain } from "./emitterCards";
import type { EmitterCardData } from "./emitterTypes";

/** Where the curve pane aims, and the field it waits for while no emitter has one to aim. */
export interface Followed {
  readonly target: CurveTarget | null;
  /** The field's path under an emitter, from the last aim the next emitter could not take. */
  readonly held: string | null;
}

/**
 * Where the curve pane aims once the reader moves from emitter `from` to `to`.
 *
 * The same field of `to` where the pane follows one of `from`'s fields, or the field it
 * held, per "The dock" in docs/ux/BIN_EDITOR.md. A `to` without the field lets go of the
 * target and holds the field. Any other target stays. The followed aim names no reading,
 * so the pane stays on the one it is on.
 */
export function followed(
  target: CurveTarget | null,
  held: string | null,
  from: EmitterCardData | undefined,
  to: EmitterCardData | undefined,
): Followed {
  if (from === undefined || to === undefined || from.key === to.key) return { target, held };
  const field = target === null ? held : fieldOf(target, from);
  if (field === null) return { target, held: null };

  const path = to.row.path + field;
  const row = emitterRows(to).find((each) => each.path === path);
  if (row === undefined) return { target: null, held: field };
  return { target: { row, chain: fieldChain(to, row) }, held: null };
}

/** The path of `target` under `card`'s own element, or null where it sits elsewhere. */
function fieldOf(target: CurveTarget, card: EmitterCardData): string | null {
  const own = card.row.path;
  if (target.row.entry !== card.row.entry || !target.row.path.startsWith(`${own}.`)) return null;
  return target.row.path.slice(own.length);
}

/** Keep the curve pane on its field as the selected emitter changes. */
export function useCurveFollow(card: EmitterCardData | undefined): void {
  const { target, aim, clear } = useCurveDock();
  const last = useRef(card);
  const held = useRef<string | null>(null);

  useEffect(() => {
    /* A card still reading stands between two that have landed, and the follow spans it. */
    if (card === undefined) return;
    const from = last.current;
    last.current = card;
    const next = followed(target, held.current, from, card);
    held.current = next.held;
    if (next.target === target) return;
    if (next.target === null) clear();
    else aim(next.target);
  }, [card, target, aim, clear]);
}
