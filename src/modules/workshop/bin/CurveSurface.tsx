import { useMemo } from "react";

import { m } from "@/i18n";
import type { BinDocumentId } from "@/lib/tauri";

import { rowKey } from "./binRows";
import { CurveGraph } from "./CurveGraph";
import { useCurveDock } from "./curveTarget";
import { useValueMarks } from "./useValueMarks";

/**
 * The curve of whatever last targeted the dock. "The curve panel" in docs/ux/BIN_EDITOR.md.
 *
 * The host sizes it, because the same surface is the dock under a stack and a pane of the
 * shell (ADR-0031). It holds no target of its own, so a reader walking the emitter strip
 * compares every emitter's numbers against one open curve.
 */
export function CurveSurface({ document }: { document: BinDocumentId }) {
  const { target } = useCurveDock();
  const rows = useMemo(() => (target === null ? [] : [target.row]), [target]);
  const marks = useValueMarks(document, rows, "sparklines");
  const mark = target === null ? undefined : marks.get(rowKey(target.row));

  return (
    <section data-ui="CurveSurface" className="flex min-h-0 flex-1 flex-col gap-1">
      <span className="px-1 text-xs font-medium tracking-wide text-surface-400 uppercase">
        {m.workshop_bin_curve_pane_label()}
      </span>
      {target === null && <Untargeted />}
      {target !== null && (
        <>
          <span className="flex min-w-0 flex-col px-1 leading-tight">
            <span className="truncate text-surface-200">{target.chain}</span>
            <span className="truncate font-mono text-meta text-surface-500 select-text">
              {target.row.path}
            </span>
          </span>
          <CurveGraph
            key={rowKey(target.row)}
            keys={mark?.keys ?? []}
            family={mark?.family ?? "scalar"}
          />
        </>
      )}
    </section>
  );
}

/** The pane before anything targets it, which draws a line rather than an empty box. */
function Untargeted() {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full text-surface-700"
      >
        <polyline
          points="0,36 20,34 40,24 60,10 80,6 100,4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="relative text-meta text-surface-500">
        {m.workshop_bin_curve_pane_empty()}
      </span>
    </div>
  );
}
