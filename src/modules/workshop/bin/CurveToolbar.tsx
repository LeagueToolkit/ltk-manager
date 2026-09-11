import { WarningCircleIcon } from "@phosphor-icons/react";
import { twMerge } from "tailwind-merge";

import { Code, SegmentedControl, Tooltip } from "@/components";
import { m } from "@/i18n";

import { ChancePin } from "./ChancePin";
import { CHANNELS, CHIP } from "./curveChannels";
import type { CurveTab } from "./curveTarget";
import { drawsSpread, isRandom, type RandomDraw, rerollsEveryFrame } from "./randomDraw";
import type { ValueFamily } from "./valueRows";

/** The field a value's tables sit under, which the chip names as the file does. */
const TABLES_FIELD = "probabilityTables";

interface CurveToolbarProps {
  family: ValueFamily;
  /** How many channels the value holds. */
  width: number;
  /** The channels the chips turned off. */
  muted: ReadonlySet<number>;
  onToggle: (channel: number) => void;
  draw: RandomDraw | null;
  /** The hash the value sits under, which says whether it re-rolls every frame. */
  field: string | null;
  tab: CurveTab;
  /** The value has keys for a Table to list. */
  tabled: boolean;
  onTab: (tab: CurveTab) => void;
}

/** Every control of the dock in one row: chips, the tables and their faults, the pin, the tabs. */
export function CurveToolbar({
  family,
  width,
  muted,
  onToggle,
  draw,
  field,
  tab,
  tabled,
  onTab,
}: CurveToolbarProps) {
  const names = CHANNELS[family];
  const chips =
    family === "vector" && width > 1 ? Array.from({ length: width }, (_, at) => at) : [];
  const spread = drawsSpread(draw);
  const flickers =
    spread && rerollsEveryFrame(field) && draw.channels.some((each) => isRandom(each.shape));

  return (
    <div
      data-ui="CurveToolbar"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 select-none"
    >
      {chips.length > 0 && (
        <span className="flex gap-0.5">
          {chips.map((channel) => (
            <button
              key={channel}
              type="button"
              aria-pressed={!muted.has(channel)}
              /* DS-RADIUS, DS-VEIL, DS-TEXT */
              className={twMerge(
                "cursor-pointer rounded-sm px-1.5 font-mono text-meta font-semibold hover:bg-surface-veil",
                muted.has(channel) ? "text-surface-600" : (CHIP[channel] ?? CHIP[0]),
              )}
              onClick={() => onToggle(channel)}
            >
              {names[channel] ?? String(channel)}
            </button>
          ))}
        </span>
      )}
      {draw !== null && (
        <Tooltip content={m.workshop_bin_random_tables_hint()}>
          <span
            tabIndex={0}
            /* DS-CODE-CHIP */
            className="flex cursor-help rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
          >
            <Code>{TABLES_FIELD}</Code>
          </span>
        </Tooltip>
      )}
      {flickers && (
        <Fault
          tone="warning"
          label={m.workshop_bin_random_flicker_label()}
          hint={m.workshop_bin_random_flicker_hint()}
        />
      )}
      {draw?.broken === true && (
        <Fault
          tone="danger"
          label={m.workshop_bin_random_broken_label()}
          hint={m.workshop_bin_random_broken_hint()}
        />
      )}
      <span className="ml-auto flex items-center gap-3">
        {spread && <ChancePin />}
        <SegmentedControl
          size="xs"
          aria-label={m.workshop_bin_curve_tab_label()}
          value={tab}
          onChange={onTab}
          options={[
            { value: "graph", label: m.workshop_bin_curve_tab_graph_label() },
            ...(tabled
              ? [{ value: "table" as const, label: m.workshop_bin_curve_tab_table_label() }]
              : []),
          ]}
        />
      </span>
    </div>
  );
}

/** A fault of the tables, its word in the row and its reason on hover. */
function Fault({ tone, label, hint }: { tone: "warning" | "danger"; label: string; hint: string }) {
  return (
    <Tooltip content={hint}>
      <span
        tabIndex={0}
        /* DS-TEXT */
        className={twMerge(
          "flex cursor-help items-center gap-1 text-meta outline-none focus-visible:ring-1 focus-visible:ring-accent-500",
          tone === "warning" ? "text-warning-text" : "text-danger-text",
        )}
      >
        <WarningCircleIcon weight="bold" className="h-3.5 w-3.5 shrink-0" />
        {label}
      </span>
    </Tooltip>
  );
}
