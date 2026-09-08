import { useEffect, useMemo, useState } from "react";

import { SegmentedControl } from "@/components";
import { m } from "@/i18n";
import type { BinDocumentId } from "@/lib/tauri";

import { rowKey } from "./binRows";
import { CurveGraph } from "./CurveGraph";
import { type CurveTab, useCurveDock } from "./curveTarget";
import { KeyTable } from "./KeyTable";
import { ProbabilityPlot } from "./ProbabilityPlot";
import { useValueMarks } from "./useValueMarks";

/**
 * The curve of whatever last targeted the dock. "The curve panel" in docs/ux/BIN_EDITOR.md.
 *
 * The host sizes it, because the same surface is the dock under a stack and a pane of the
 * shell (ADR-0031). It holds no target of its own, so a reader walking the emitter strip
 * compares every emitter's numbers against one open curve.
 */
export function CurveSurface({
  document,
  named = true,
}: {
  document: BinDocumentId;
  /** False where the host already names the surface, as a pane's own strip does. */
  named?: boolean;
}) {
  const { target } = useCurveDock();
  const rows = useMemo(() => (target === null ? [] : [target.row]), [target]);
  const marks = useValueMarks(document, rows, "dock");
  const mark = target === null ? undefined : marks.get(rowKey(target.row));
  const [tab, setTab] = useState<CurveTab>("graph");

  /* An aim that names a reading switches to it, so a row's probability trigger lands on the
     tables rather than on whichever tab the dock was left on. */
  const asked = target?.tab;
  useEffect(() => {
    if (asked !== undefined) setTab(asked);
  }, [asked, target]);

  const keys = mark?.keys ?? [];
  const family = mark?.family ?? "scalar";
  const band = family === "color";

  /* The read lands after the mount, so a colour can be sitting on Table when it arrives. */
  const shown: CurveTab = band && tab === "table" ? "graph" : tab;

  return (
    <section data-ui="CurveSurface" className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        {named && (
          <span className="mr-auto px-1 text-xs font-medium tracking-wide text-surface-400 uppercase">
            {m.workshop_bin_curve_pane_label()}
          </span>
        )}
        {target !== null && (
          <SegmentedControl
            className="ml-auto"
            size="xs"
            aria-label={m.workshop_bin_curve_tab_label()}
            value={shown}
            onChange={setTab}
            options={[
              { value: "graph", label: m.workshop_bin_curve_tab_graph_label() },
              /* A colour's graph draws the keys under its ramp, so a tab of them repeats it. */
              ...(band
                ? []
                : [{ value: "table" as const, label: m.workshop_bin_curve_tab_table_label() }]),
              { value: "probability", label: m.workshop_bin_curve_tab_probability_label() },
            ]}
          />
        )}
      </div>
      {target === null && <Untargeted />}
      {target !== null && (
        <>
          <span className="flex min-w-0 flex-col px-1 leading-tight">
            <span className="truncate text-surface-200">{target.chain}</span>
            <span className="truncate font-mono text-meta text-surface-500 select-text">
              {target.row.path}
            </span>
          </span>
          {shown === "graph" && <CurveGraph key={rowKey(target.row)} keys={keys} family={family} />}
          {shown === "table" && <KeyTable keys={keys} family={family} />}
          {shown === "probability" && (
            <ProbabilityPlot key={rowKey(target.row)} tables={mark?.tables ?? []} family={family} />
          )}
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
