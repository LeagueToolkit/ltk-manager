import { type ReactNode, useCallback, useMemo, useState } from "react";

import { FieldDiscardContext, Grid, IconButton, Inline, Readout } from "@/components";
import { m } from "@/i18n";

import type { GizmoTool, MapTool } from "../state/mapScene";
import { toolEntry, TRANSFORM_TOOLS } from "../utils/mapTools";
import {
  axisText,
  parseAxis,
  type TransformParts,
  transformOf,
  transformParts,
} from "../utils/placeableSpace";

const AXES = ["X", "Y", "Z"] as const;

/** The label column, matched to the inspector's other label columns, then one column per axis. */
const COLUMNS = "5.5rem repeat(3, minmax(0, 1fr))";

const ROWS: readonly {
  part: keyof TransformParts;
  label: () => string;
  step: number;
}[] = [
  {
    part: "position",
    label: m.workshop_bin_map_transform_position_label,
    step: 1,
  },
  {
    part: "rotation",
    label: m.workshop_bin_map_transform_rotation_label,
    step: 1,
  },
  {
    part: "scale",
    label: m.workshop_bin_map_transform_scale_label,
    step: 0.1,
  },
];

/** The viewport tool, which the row buttons show pressed and set. */
export interface TransformTools {
  readonly current: MapTool;
  readonly pick: (tool: GizmoTool) => void;
}

export interface TransformFieldsProps {
  /** Column major in the engine's space. */
  readonly transform: readonly (number | null)[];
  readonly disabled?: boolean;
  /** Draws a button beside each row label that picks the row's gizmo tool. Absent, no buttons. */
  readonly tools?: TransformTools;
  /** Takes the transform a typed value makes, column major. */
  readonly onCommit: (transform: number[]) => void;
}

/** The parts of `parts` with the `axis` of `part` set to `value`. */
function withAxis(
  parts: TransformParts,
  part: keyof TransformParts,
  axis: number,
  value: number,
): TransformParts {
  const next = [...parts[part]] as [number, number, number];
  next[axis] = value;
  return { ...parts, [part]: next };
}

/**
 * The position, rotation in degrees and scale of a transform, each axis a `Readout` with its
 * channel sash, the field the VFX inspector edits a vector in. A typed or stepped value applies on
 * Enter or when the field loses focus, and text that is no number marks the field until Escape.
 * Per "Transform space" in docs/ux/MAP_EDITOR.md.
 */
export function TransformFields({
  transform,
  disabled = false,
  tools,
  onCommit,
}: TransformFieldsProps) {
  const parts = useMemo(() => transformParts(transform), [transform]);
  /* The parts the last commit sent, shown until the transform reads back, so a field committed
     before then builds on the one committed before it. */
  const [sent, setSent] = useState<{ source: TransformParts; parts: TransformParts } | null>(null);
  const [refused, setRefused] = useState<{ source: TransformParts; field: string } | null>(null);
  const shown = sent?.source === parts ? sent.parts : parts;
  const refusedField = refused?.source === parts ? refused.field : null;
  const dropRefusal = useCallback(() => setRefused(null), []);

  const commit = (part: keyof TransformParts, axis: number, text: string) => {
    const value = parseAxis(text);
    if (value === null) {
      setRefused({ source: parts, field: `${part}${axis}` });
      return;
    }

    setRefused(null);
    if (value === shown[part][axis]) return;

    const next = withAxis(shown, part, axis, value);
    setSent({ source: parts, parts: next });
    onCommit(transformOf(next));
  };

  return (
    <FieldDiscardContext value={dropRefusal}>
      <Grid data-ui="TransformFields" columns={COLUMNS} gap={1} align="center">
        {ROWS.map(({ part, label, step }) => (
          <TransformRow
            key={part}
            label={label()}
            tool={TRANSFORM_TOOLS[part]}
            tools={tools}
            disabled={disabled}
          >
            {AXES.map((axis, at) => (
              <Readout
                key={axis}
                value={axisText(shown[part][at])}
                label={axis}
                channel={at}
                step={step}
                aria-label={`${label()} ${axis}`}
                className="flex-1"
                invalid={refusedField === `${part}${at}`}
                onCommit={disabled ? undefined : (text) => commit(part, at, text)}
              />
            ))}
          </TransformRow>
        ))}
      </Grid>
    </FieldDiscardContext>
  );
}

interface TransformRowProps {
  readonly label: string;
  readonly tool: GizmoTool;
  readonly tools: TransformTools | undefined;
  readonly disabled: boolean;
  readonly children: ReactNode;
}

/** One row's label, with the button of its gizmo tool when `tools` is given, then its fields. */
function TransformRow({ label, tool, tools, disabled, children }: TransformRowProps) {
  const { icon: Glyph, label: toolLabel } = toolEntry(tool);

  return (
    <>
      <Inline gap={1} justify="between">
        <span className="min-w-0 truncate text-meta text-surface-400 select-none">{label}</span>
        {tools !== undefined && (
          <IconButton
            size="row"
            icon={<Glyph />}
            label={toolLabel()}
            pressed={tools.current === tool}
            disabled={disabled}
            onClick={() => tools.pick(tool)}
          />
        )}
      </Inline>
      {children}
    </>
  );
}
