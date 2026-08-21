import type { Evidence, EvidenceCode } from "@/lib/tauri";

interface EvidenceTimelineProps {
  evidence: Evidence[];
}

/**
 * The lines the verdict rests on, in the order the backend gives them, each
 * with its source and its time. A coded line carries the table's reading
 * under it.
 */
export function EvidenceTimeline({ evidence }: EvidenceTimelineProps) {
  if (evidence.length === 0) {
    return <p className="text-xs text-surface-500">Nothing was recorded for this game.</p>;
  }

  return (
    <ol
      data-ui="EvidenceTimeline"
      className="flex flex-col divide-y divide-surface-800 rounded-lg border border-surface-700/50 bg-surface-900/95 font-mono text-xs"
    >
      {evidence.map((row, index) => (
        <li
          key={`${row.at}-${row.source}-${index}`}
          className="grid grid-cols-[4.5rem_3.5rem_minmax(0,1fr)] gap-x-3 px-3 py-2"
        >
          <span className="text-surface-400 tabular-nums">{row.at}</span>
          <span className="text-surface-500">{row.source}</span>
          <span className="break-all text-surface-200">{row.line}</span>
          {row.code && (
            <span className="col-start-3 mt-0.5 break-words">
              <CodeReading code={row.code} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * What the table says about the code, or the code alone when it has no row.
 *
 * The row's evidence mark is not drawn. How firm a reading is says how well
 * the manager knows its own code table, and stamping that on every line read
 * as a severity the line does not carry.
 */
function CodeReading({ code }: { code: EvidenceCode }) {
  if (!code.meaning) return <span className="text-surface-400">{code.id}</span>;
  return <span className="text-surface-300">{code.meaning}</span>;
}
