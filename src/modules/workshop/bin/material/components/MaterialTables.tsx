import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { type ReactNode, use } from "react";

import { Checkbox, type DataTableColumn } from "@/components";
import { m } from "@/i18n";
import type { BinRow, SchemaParam, SchemaSwitch, SchemaTexture } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { Cell, fieldsOf, type WidgetProps } from "../../classes/components/ClassCells";
import { nameHash } from "../../shared/utils/binHash";
import { RowValue } from "../../tree/components/BinRow";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { rowKey } from "../../tree/utils/binRows";
import {
  useElementField,
  useEntryWrite,
  useMaterialEntry,
  useOverride,
} from "../hooks/useEntryEdits";
import { useDeclaredNames, useSchema, useTextureWarnings } from "../hooks/useShaderSchema";
import { type ListKind, TableContext } from "../state/declaredTable";
import { type DeclaredRow, paramDefault } from "../utils/declaredRows";
import { setField } from "../utils/entryEdits";
import { DeclaredCell, Heading } from "./DeclaredRow";
import { DeclaredTable } from "./DeclaredTable";
import { isColor, LiveParam, ParamReadout, SwatchLaneContext } from "./LiveParam";
import { DEFAULT_BOX, FIELD, Unset, VALUE_WIDTH, ValueCell } from "./MaterialCells";

const PARAMS: ListKind = {
  list: nameHash("paramValues"),
  className: "StaticMaterialShaderParamDef",
  nameField: FIELD.name,
};
const SAMPLERS: ListKind = {
  list: nameHash("samplerValues"),
  className: "StaticMaterialShaderSamplerDef",
  nameField: FIELD.textureName,
};
const SWITCHES: ListKind = {
  list: nameHash("switches"),
  className: "StaticMaterialSwitchDef",
  nameField: FIELD.name,
};

const ADDRESSES = ["addressU", "addressV", "addressW"] as const;

/* An address mode is a small integer, so its box needs none of a scalar's room. */
const ADDRESS_WIDTH = "flex min-w-0 items-center [--bin-scalar-width:2rem]";
const SWITCH_BOX = "flex shrink-0 items-center";
/* A parameter the shader does not declare draws in the tree's own leaf editor. */
const UNDECLARED_PARAM = "flex min-w-0 flex-1 items-center [--bin-component-width:3rem]";

/* The column that takes the room the others spare. */
const FILL = "w-full";
/* The same, for a column whose content cuts itself to the room it is given, down to enough to
   read a file name. A narrower pane scrolls the table instead. */
const FILL_CUT = "w-full max-w-0 min-w-28";

/**
 * The shader's default for a row the material does not set, muted, and a press that adds
 * the material's own entry holding it.
 */
function Inherited({
  className,
  onOverride,
  children,
}: {
  className: string;
  onOverride: (() => void) | null;
  children: ReactNode;
}) {
  const text = <span className="truncate">{children}</span>;
  if (onOverride === null) {
    return (
      <span className={className} title={m.workshop_bin_material_shader_default_label()}>
        <span className={DEFAULT_BOX}>{text}</span>
      </span>
    );
  }

  return (
    <span className={className}>
      {/* DS-HOVER */}
      <button
        type="button"
        className={twMerge(
          DEFAULT_BOX,
          "cursor-pointer hover:border-accent-hover hover:text-surface-300",
        )}
        title={m.workshop_bin_material_inherit_action()}
        onClick={onOverride}
      >
        {text}
      </button>
    </span>
  );
}

function ParamValue({ row }: { row: DeclaredRow<SchemaParam> }) {
  if (row.element !== null) return <WrittenParam element={row.element} param={row.declared} />;
  if (row.declared === null) return null;
  return <InheritedParam name={row.name} param={row.declared} />;
}

/** A declared parameter the material leaves to the shader, whose edit adds the entry. */
function InheritedParam({ name, param }: { name: string; param: SchemaParam }) {
  const override = useOverride();
  const material = useMaterialEntry();
  if (override === null) {
    return <ParamReadout param={param} values={paramDefault(param)} inherited />;
  }

  return (
    <LiveParam
      param={param}
      material={material}
      stored={null}
      write={(values) =>
        override(name, (at) => setField(at, FIELD.value, { type: "vector", values }))
      }
    />
  );
}

/**
 * A parameter the material has an entry for, drawn live while a field of it is held. An entry
 * the shader does not declare takes the tree's leaf editor, having no preview to draw live.
 */
function WrittenParam({ element, param }: { element: BinRow; param: SchemaParam | null }) {
  const material = useMaterialEntry();
  const value = useElementField(element, FIELD.value);
  const edit = use(LeafEditContext);
  const writeEntry = useEntryWrite();
  const vector = value?.value.type === "vector" ? value.value : null;
  const fallback = <ValueCell element={element} field={FIELD.value} className={UNDECLARED_PARAM} />;
  if (value !== undefined && vector === null) return fallback;

  if (edit === null || writeEntry === null) {
    if (vector !== null) {
      return (
        <Cell row={value} className={VALUE_WIDTH}>
          <ParamReadout param={param} values={vector.values} inherited={false} />
        </Cell>
      );
    }
    if (param === null) return fallback;
    return <ParamReadout param={param} values={paramDefault(param)} inherited />;
  }
  if (param === null) return fallback;

  const write = async (values: number[]) => {
    if (value === undefined) {
      return writeEntry(element, FIELD.value, { type: "vector", values });
    }
    return (await edit.commit(value, { ok: true, leaf: { type: "vector", values } })) !== false;
  };

  return (
    <Cell row={value} className={VALUE_WIDTH}>
      <LiveParam
        param={param}
        material={material}
        stored={vector === null ? null : vector.values.map((each) => each ?? 0)}
        write={write}
      />
    </Cell>
  );
}

function TexturePath({ row }: { row: DeclaredRow<SchemaTexture> }) {
  const override = useOverride();
  if (row.element !== null) {
    return <ValueCell element={row.element} field={FIELD.texturePath} className={VALUE_WIDTH} />;
  }

  return (
    <Inherited
      className={VALUE_WIDTH}
      onOverride={override && (() => void override(row.name, () => []))}
    >
      {row.declared?.default ?? m.workshop_bin_material_no_texture_label()}
    </Inherited>
  );
}

/** Whether a sampler writes none of its address modes, which then read `default` once. */
function useAddressesUnset(row: DeclaredRow<SchemaTexture>): boolean {
  const pages = use(TableContext)?.pages;
  if (row.element === null) return true;

  const fields = fieldsOf(pages?.get(rowKey(row.element)));
  return ADDRESSES.every((address) => fields(FIELD[address]) === undefined);
}

/**
 * One address mode of a sampler. A sampler that writes none of the three draws one `default`
 * across their columns.
 */
function AddressCell({ row, at }: { row: DeclaredRow<SchemaTexture>; at: number }) {
  const unset = useAddressesUnset(row);
  const address = ADDRESSES[at];
  if (unset && at > 0) return null;
  if (unset || row.element === null || address === undefined) {
    return (
      <DeclaredCell colSpan={ADDRESSES.length}>
        <Unset className={ADDRESS_WIDTH} />
      </DeclaredCell>
    );
  }

  return (
    <DeclaredCell>
      <ValueCell element={row.element} field={FIELD[address]} className={ADDRESS_WIDTH} />
    </DeclaredCell>
  );
}

/**
 * Whether a switch is on: the entry's own `on`, an entry that leaves it unwritten reading as
 * on, or the shader's default. Only the entry's own value is not muted.
 */
function SwitchOn({ row }: { row: DeclaredRow<SchemaSwitch> }) {
  const compiled = row.declared !== null && !row.declared.runtime;

  return (
    <span className={twMerge(VALUE_WIDTH, "gap-1.5")}>
      {row.element !== null && <EntrySwitch row={row} element={row.element} />}
      {row.element === null && <DefaultSwitch row={row} on={row.declared?.onByDefault ?? false} />}
      {compiled && (
        <ArrowsClockwiseIcon
          aria-label={m.workshop_bin_material_compiled_switch_hint()}
          className="h-3 w-3 shrink-0 text-surface-500"
        >
          <title>{m.workshop_bin_material_compiled_switch_hint()}</title>
        </ArrowsClockwiseIcon>
      )}
    </span>
  );
}

function EntrySwitch({ row, element }: { row: DeclaredRow<SchemaSwitch>; element: BinRow }) {
  const own = useElementField(element, FIELD.on);
  if (own === undefined) return <DefaultSwitch row={row} on />;

  return (
    <Cell row={own} className={SWITCH_BOX}>
      <RowValue row={own} />
    </Cell>
  );
}

/** A muted box for a value the material does not write, which writes it once toggled. */
function DefaultSwitch({ row, on }: { row: DeclaredRow<SchemaSwitch>; on: boolean }) {
  const set = useSetSwitch(row);

  return (
    <span className={SWITCH_BOX} title={m.workshop_bin_material_shader_default_label()}>
      <Checkbox
        size="sm"
        className="opacity-50"
        checked={on}
        disabled={set === null}
        aria-label={row.name}
        onCheckedChange={(checked) => set?.(checked)}
      />
    </span>
  );
}

/** Write a switch's `on`: into its entry where one exists, else into a new entry. */
function useSetSwitch(row: DeclaredRow<SchemaSwitch>): ((on: boolean) => void) | null {
  const writeEntry = useEntryWrite();
  const override = useOverride();
  const element = row.element;

  if (element !== null) {
    if (writeEntry === null) return null;
    return (on) => void writeEntry(element, FIELD.on, { type: "bool", value: on });
  }

  if (override === null) return null;
  return (on) =>
    void override(row.name, (at) => setField(at, FIELD.on, { type: "bool", value: on }));
}

const PARAM_COLUMNS: DataTableColumn<DeclaredRow<SchemaParam>>[] = [
  {
    id: "value",
    header: () => <Heading className={FILL}>{m.workshop_bin_material_value_label()}</Heading>,
    cell: ({ row }) => (
      <DeclaredCell className={FILL}>
        <ParamValue row={row.original} />
      </DeclaredCell>
    ),
  },
];

const SAMPLER_COLUMNS: DataTableColumn<DeclaredRow<SchemaTexture>>[] = [
  {
    id: "texture",
    header: () => <Heading className={FILL}>{m.workshop_bin_material_texture_label()}</Heading>,
    cell: ({ row }) => (
      <DeclaredCell className={FILL_CUT}>
        <TexturePath row={row.original} />
      </DeclaredCell>
    ),
  },
  ...ADDRESSES.map((address, at): DataTableColumn<DeclaredRow<SchemaTexture>> => ({
    id: address,
    header: () => <Heading>{address.slice(-1)}</Heading>,
    cell: ({ row }) => <AddressCell row={row.original} at={at} />,
  })),
];

const SWITCH_COLUMNS: DataTableColumn<DeclaredRow<SchemaSwitch>>[] = [
  {
    id: "on",
    header: () => <Heading className={FILL}>{m.workshop_bin_material_on_label()}</Heading>,
    cell: ({ row }) => (
      <DeclaredCell className={FILL}>
        <SwitchOn row={row.original} />
      </DeclaredCell>
    ),
  },
];

/** `paramValues` as a table of every parameter the shader declares, and its value. */
export function MaterialParams(props: WidgetProps) {
  const schema = useSchema(props.view);
  const names = useDeclaredNames(props.view);
  return (
    <SwatchLaneContext value={schema?.params.some(isColor) ?? false}>
      <DeclaredTable
        {...props}
        kind={PARAMS}
        declarations={schema?.params ?? null}
        names={names}
        columns={PARAM_COLUMNS}
      />
    </SwatchLaneContext>
  );
}

/** `samplerValues` as a table of every texture the shader declares, its path and address modes. */
export function MaterialSamplers(props: WidgetProps) {
  const schema = useSchema(props.view);
  const names = useDeclaredNames(props.view);
  const warnings = useTextureWarnings(props.view);
  return (
    <DeclaredTable
      {...props}
      kind={SAMPLERS}
      declarations={schema?.textures ?? null}
      names={names}
      columns={SAMPLER_COLUMNS}
      warnings={warnings}
    />
  );
}

/** `switches` as a table of every switch the shader declares, and whether it is on. */
export function MaterialSwitches(props: WidgetProps) {
  const schema = useSchema(props.view);
  const names = useDeclaredNames(props.view);
  return (
    <DeclaredTable
      {...props}
      kind={SWITCHES}
      declarations={schema?.switches ?? null}
      names={names}
      columns={SWITCH_COLUMNS}
    />
  );
}
