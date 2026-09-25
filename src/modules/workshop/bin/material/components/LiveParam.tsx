import { useQueryClient } from "@tanstack/react-query";
import { createContext, use, useRef, useState } from "react";

import { Button, ColorPicker, NumberField, Popover } from "@/components";
import { m } from "@/i18n";
import type { SchemaParam } from "@/lib/tauri";
import type { HeldValue } from "@/modules/viewport";
import { twMerge } from "@/utils";

import { Swatch } from "../../values/components/ColorMark";
import { useHeldValueStore } from "../state/heldValue";
import { componentCount, paramDefault } from "../utils/declaredRows";

const AXES = ["X", "Y", "Z", "W"] as const;
const CHANNELS = ["R", "G", "B", "A"] as const;

/** What one scrubbed pixel moves a component by. */
const STEP = 0.01;
const FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 3 };

const READOUT = new Intl.NumberFormat(undefined, FORMAT);

/** The channel each component is drawn in, X red, Y green and Z blue as Riot draws them. The
    hover repeats it over the number field's own hover colour. */
const TINT = [
  "text-channel-1-text hover:text-channel-1-text",
  "text-channel-2-text hover:text-channel-2-text",
  "text-channel-3-text hover:text-channel-3-text",
  "text-channel-4-text hover:text-channel-4-text",
] as const;

/* One column per component the widest parameter writes, so a column holds one component down
   the table, and a seat after them for the swatch where the table holds a colour. A table too
   narrow for four puts two on a line. */
const COMPONENTS = "grid w-full max-w-md items-center gap-1";
const COLUMNS =
  "grid-cols-[repeat(2,minmax(3.25rem,1fr))] @min-md:grid-cols-[repeat(4,minmax(3.25rem,1fr))]";
const COLUMNS_WITH_SWATCH =
  "grid-cols-[repeat(2,minmax(3.25rem,1fr))_1.5rem] @min-md:grid-cols-[repeat(4,minmax(3.25rem,1fr))_1.5rem]";
/* The swatch rides the first line: its own seat while two channels share a line, else right
   after the colour's last channel, the fourth column after RGB and its own after RGBA. */
const SWATCH_SEAT = "col-start-3 row-start-1 flex items-center";
const SWATCH_COLUMN: Readonly<Record<number, string>> = {
  3: "@min-md:col-start-4",
  4: "@min-md:col-start-5",
};

/* DS-VEIL, DS-HOVER, DS-RADIUS. A component is the labelled readout's box, the letter on a rung
   above the value, and the shader's default is the same box with its surface taken away. */
const BOX = "flex min-w-0 items-stretch overflow-hidden rounded-sm border transition-colors";
const WRITTEN_BOX = "border-surface-veil";
const DEFAULT_BOX = "border-dashed border-surface-700";
const FIELD_BOX =
  "hover:border-accent-hover focus-within:border-solid focus-within:border-accent-500";

const LETTER = "flex items-center px-1 font-mono font-semibold lowercase select-none";
const WRITTEN_LETTER = "bg-surface-veil";
const DEFAULT_LETTER = "bg-transparent text-surface-500";
const SCRUB_LETTER = "hover:bg-surface-veil-strong";

const VALUE = "min-w-0 flex-1 truncate py-0.5 pr-1 pl-0.5 text-right font-mono tabular-nums";
const WRITTEN_VALUE = "bg-surface-veil-soft text-surface-200";
const DEFAULT_VALUE = "bg-transparent text-surface-500";

/* The number field's own edge and hover give way to the box's. */
const FIELD_INPUT =
  "w-0 flex-1 rounded-none border-0 text-mono-row focus:bg-surface-veil-soft focus:text-surface-100";
const WRITTEN_INPUT = "enabled:hover:bg-surface-veil-soft";
const DEFAULT_INPUT = "enabled:hover:bg-transparent";

/** The program reads a committed value reaches, which the preview draws once they answer. */
const PROGRAM_READS: ReadonlySet<unknown> = new Set(["material-program", "skin-programs"]);

/**
 * Whether the rows around a parameter hold a colour, so every row keeps the swatch's seat and
 * a component's column is one width down the table.
 */
export const SwatchLaneContext = createContext(false);

/** A parameter the colour control reads as a colour, by the rule of the material plan. */
export function isColor(param: SchemaParam): boolean {
  return /(color|tint)$/i.test(param.name) && componentCount(param.fields) >= 3;
}

export interface LiveParamProps {
  param: SchemaParam;
  /** The `StaticMaterialDef` the value is drawn on. */
  material: string;
  /** The components the material writes, or null where the shader's default draws. */
  stored: readonly number[] | null;
  /** Write the released value into the bin, answering whether it landed. */
  write: (values: number[]) => Promise<boolean>;
}

/**
 * One parameter's components as fields that scrub, drawn live while held and written on
 * release. A colour carries a swatch that opens a picker beside the fields. A parameter the
 * material leaves to the shader draws its default in muted fields, and editing one writes the
 * material's own value.
 *
 * "Live values" in docs/ux/BIN_EDITOR.md. The held value is let go once the program reads
 * the commit invalidated have answered, so the preview never draws the old value between.
 */
export function LiveParam({ param, material, stored, write }: LiveParamProps) {
  const client = useQueryClient();
  const hold = useHeldValueStore((state) => state.hold);
  const release = useHeldValueStore((state) => state.release);
  const [draft, setDraft] = useState<number[] | null>(null);
  /* The commit fires in the same event as the last scrub step, before a render hands it the draft. */
  const latest = useRef<number[] | null>(null);

  const inherited = stored === null && draft === null;
  const shown = draft ?? stored ?? paramDefault(param);
  const count = Math.min(shown.length, Math.max(1, componentCount(param.fields)));
  const color = isColor(param);
  const labels = color ? CHANNELS : AXES;
  const lane = use(SwatchLaneContext);

  const heldOf = (values: readonly number[]): HeldValue => ({
    material,
    physical: param.physical,
    fields: param.fields,
    value: values,
  });

  const change = (values: number[]) => {
    latest.current = values;
    setDraft(values);
    hold(heldOf(values));
  };

  const commit = async () => {
    const values = latest.current;
    if (values === null) return;
    latest.current = null;
    await write(values);
    await client.invalidateQueries(
      { predicate: (query) => PROGRAM_READS.has(query.queryKey[0]) },
      { cancelRefetch: false },
    );
    release(heldOf(values));
    setDraft(null);
  };

  const componentAt = (at: number, next: number | null) => {
    if (next === null) return;
    const base = latest.current ?? [...shown];
    change(base.map((value, index) => (index === at ? next : value)));
  };

  return (
    /* The number field commits on blur and on a scrub's release, and Enter commits here as
       every other field of the inspector does. */
    <span
      className={twMerge(COMPONENTS, lane ? COLUMNS_WITH_SWATCH : COLUMNS)}
      title={inherited ? m.workshop_bin_material_shader_default_label() : undefined}
      onKeyDown={(event) => {
        if (event.key === "Enter") void commit();
      }}
    >
      {shown.slice(0, count).map((value, at) => (
        <NumberField
          key={labels[at]}
          value={value}
          step={STEP}
          format={FORMAT}
          scrub={labels[at]}
          aria-label={m.workshop_bin_material_component_label({
            name: param.name,
            component: labels[at],
          })}
          rootClassName={twMerge(BOX, FIELD_BOX, inherited ? DEFAULT_BOX : WRITTEN_BOX)}
          scrubClassName={twMerge(
            LETTER,
            SCRUB_LETTER,
            inherited ? DEFAULT_LETTER : twMerge(WRITTEN_LETTER, TINT[at]),
          )}
          className={twMerge(
            VALUE,
            FIELD_INPUT,
            inherited ? DEFAULT_VALUE : WRITTEN_VALUE,
            inherited ? DEFAULT_INPUT : WRITTEN_INPUT,
          )}
          onValueChange={(next) => componentAt(at, next)}
          onValueCommitted={() => void commit()}
        />
      ))}
      {color && (
        <span className={twMerge(SWATCH_SEAT, SWATCH_COLUMN[count])}>
          <ColorSwatch
            label={param.name}
            values={shown}
            muted={inherited}
            onChange={(rgb) =>
              change((latest.current ?? [...shown]).map((value, index) => rgb[index] ?? value))
            }
            onClose={() => void commit()}
          />
        </span>
      )}
    </span>
  );
}

export interface ParamReadoutProps {
  /**
   * The declaration, which names the components and marks a colour. Null for an entry the
   * shader does not declare.
   */
  param: SchemaParam | null;
  /** The components to draw. A NaN crosses IPC as null. */
  values: readonly (number | null)[];
  /** The values are the shader's default rather than the material's own. */
  inherited: boolean;
}

/** One parameter's components as read-only boxes, laid out as the live fields are. */
export function ParamReadout({ param, values, inherited }: ParamReadoutProps) {
  const count =
    param === null
      ? values.length
      : Math.min(values.length, Math.max(1, componentCount(param.fields)));
  const color = param !== null && isColor(param);
  const labels = color ? CHANNELS : AXES;
  const lane = use(SwatchLaneContext);

  return (
    <span
      className={twMerge(COMPONENTS, lane ? COLUMNS_WITH_SWATCH : COLUMNS)}
      title={inherited ? m.workshop_bin_material_shader_default_label() : undefined}
    >
      {values.slice(0, count).map((value, at) => (
        <span key={labels[at]} className={twMerge(BOX, inherited ? DEFAULT_BOX : WRITTEN_BOX)}>
          <span
            aria-hidden
            className={twMerge(
              LETTER,
              inherited ? DEFAULT_LETTER : twMerge(WRITTEN_LETTER, TINT[at]),
            )}
          >
            {labels[at]}
          </span>
          <span
            className={twMerge(VALUE, "select-text", inherited ? DEFAULT_VALUE : WRITTEN_VALUE)}
            title={String(value)}
          >
            {value === null ? String(value) : READOUT.format(value)}
          </span>
        </span>
      ))}
      {color && (
        <span className={twMerge(SWATCH_SEAT, SWATCH_COLUMN[count])}>
          <Swatch
            rgba={[values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, 1]}
            className={twMerge("h-4 w-4", inherited && "opacity-50")}
          />
        </span>
      )}
    </span>
  );
}

/** The colour's swatch, which opens a picker held live until it closes. */
function ColorSwatch({
  label,
  values,
  muted,
  onChange,
  onClose,
}: {
  label: string;
  values: readonly number[];
  muted: boolean;
  onChange: (rgb: readonly [number, number, number]) => void;
  onClose: () => void;
}) {
  const rgb: readonly [number, number, number] = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];

  return (
    <Popover.Root onOpenChange={(open) => !open && onClose()}>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            aria-label={label}
            left={
              <Swatch rgba={[...rgb, 1]} className={twMerge("h-4 w-4", muted && "opacity-50")} />
            }
          />
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="left" align="center" sideOffset={12}>
          <Popover.Popup data-ui="LiveParam:picker" aria-label={label} className="w-60 p-3">
            <ColorPicker value={rgb} label={label} onValueChange={onChange} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
