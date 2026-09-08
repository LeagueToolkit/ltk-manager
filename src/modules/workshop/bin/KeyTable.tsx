import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { m } from "@/i18n";

import { Swatch } from "./ColorMark";
import { CHANNELS, CHIP } from "./curveChannels";
import { colorHex, type ColorStop, type CurveKey, type ValueFamily } from "./valueRows";

interface KeyTableProps {
  keys: readonly CurveKey[];
  family: ValueFamily;
  /** The key the host has picked, which draws as the selected row. */
  selected?: number;
  /** Picking a row, where the host has something to pick. Absent leaves the rows inert. */
  onSelect?: (at: number) => void;
}

/**
 * The keys as rows, a time and a channel per column. "The three tabs" in
 * docs/ux/BIN_EDITOR.md.
 *
 * It is the form an edit takes, so it is the numbers themselves rather than a reading of
 * them: what a curve holds, in the order the file holds it. A host that picks keys of its
 * own hands the selection down, so its mark and this row are one choice.
 */
export function KeyTable({ keys, family, selected, onSelect }: KeyTableProps) {
  if (keys.length === 0) return <Empty />;

  const names = CHANNELS[family];
  return (
    <div
      data-ui="KeyTable"
      className="min-h-0 flex-1 overflow-auto font-mono text-code scrollbar-sm"
    >
      <table className="w-full border-separate border-spacing-0 text-left tabular-nums">
        <thead className="sticky top-0 bg-surface-900">
          <tr className="text-meta text-surface-400 select-none">
            <Head>{m.workshop_bin_curve_time_column()}</Head>
            {family === "color" && <Head />}
            {names.map((name, channel) => (
              /* DS-KIND-HUE: the column carries the hue its line draws in on the graph. */
              <Head
                key={name}
                className={names.length > 1 ? (CHIP[channel] ?? CHIP[0]) : undefined}
              >
                {name}
              </Head>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key, at) => (
            <tr
              key={at}
              aria-selected={onSelect === undefined ? undefined : at === selected}
              /* DS-VEIL */
              className={twMerge(
                "hover:bg-surface-veil-soft",
                onSelect !== undefined && "cursor-pointer",
                at === selected && onSelect !== undefined && "bg-surface-veil",
              )}
              onClick={onSelect === undefined ? undefined : () => onSelect(at)}
            >
              <Cell className="text-surface-400">{key.time.toFixed(3)}</Cell>
              {family === "color" && (
                <td className="px-1.5 py-0.5">
                  <ColorCell values={key.values} />
                </td>
              )}
              {names.map((name, channel) => (
                <Cell key={name}>{format(key.values[channel])}</Cell>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Head({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={twMerge("px-1.5 py-0.5 font-normal", className)}>{children}</th>;
}

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={twMerge("px-1.5 py-0.5 text-surface-200 select-text", className)}>{children}</td>
  );
}

/** A colour key's own swatch, so a row is read as a colour and not as four numbers. */
function ColorCell({ values }: { values: readonly number[] }) {
  const [r, g, b, a] = values;
  if (r === undefined || g === undefined || b === undefined || a === undefined) return null;
  const rgba: ColorStop["rgba"] = [r, g, b, a];
  return (
    <span className="flex items-center gap-1.5">
      <Swatch rgba={rgba} className="h-3 w-3" />
      <span className="text-surface-400 select-text">{colorHex(rgba)}</span>
    </span>
  );
}

function Empty() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-meta text-surface-500">
      {m.workshop_bin_curve_keys_empty()}
    </div>
  );
}

/** A channel a key does not carry draws nothing, which a short row is. */
function format(value: number | undefined): string {
  return value === undefined ? "" : String(Number(value.toFixed(4)));
}
