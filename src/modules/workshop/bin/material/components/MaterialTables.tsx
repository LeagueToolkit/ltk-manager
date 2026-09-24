import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, use } from "react";

import { Checkbox, type DataTableColumn } from "@/components";
import { m } from "@/i18n";
import type {
  BinRow,
  MaterialWarning,
  SchemaParam,
  SchemaSwitch,
  SchemaTexture,
  ShaderSchema,
} from "@/lib/tauri";
import { twMerge } from "@/utils";

import {
  Cell,
  elementsOf,
  TableRows,
  type ViewContext,
  type WidgetProps,
} from "../../classes/components/ClassCells";
import { nameHash } from "../../shared/utils/binHash";
import { RowValue } from "../../tree/components/BinRow";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { materialQueries } from "../api/materialQueries";
import {
  useElementField,
  useEntryWrite,
  useMaterialEntry,
  useOverride,
} from "../hooks/useEntryEdits";
import type { ListKind } from "../state/declaredTable";
import { componentCount, type DeclaredRow, paramDefault } from "../utils/declaredRows";
import { setField } from "../utils/entryEdits";
import { warningText } from "../utils/materialWarnings";
import { actionsColumn, Heading, NAME_WIDTH, nameColumn } from "./DeclaredRow";
import { DeclaredTable } from "./DeclaredTable";
import { LiveParam } from "./LiveParam";

/** The fields of the three material list classes, by hash. */
const FIELD = {
  name: nameHash("name"),
  value: nameHash("value"),
  on: nameHash("on"),
  textureName: nameHash("TextureName"),
  texturePath: nameHash("texturePath"),
  addressU: nameHash("addressU"),
  addressV: nameHash("addressV"),
  addressW: nameHash("addressW"),
} as const;

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

const VALUE_WIDTH = "flex min-w-0 flex-1 items-center";
const ADDRESS_WIDTH = "flex w-16 shrink-0 items-center";
const SWITCH_BOX = "flex shrink-0 items-center";

/** The warnings the program read raises about one texture, which mark its row. */
const TEXTURE_WARNINGS: ReadonlySet<MaterialWarning["kind"]> = new Set([
  "stringTexturePath",
  "textureNotFound",
  "noTexturePath",
]);

function useProgram(view: ViewContext) {
  return useQuery(materialQueries.program(view.document, view.entry || null)).data ?? null;
}

/** The pass shader's declarations, once the program read answers them. */
function useSchema(view: ViewContext): ShaderSchema | null {
  return useProgram(view)?.passes.find((each) => each.pass.schema !== null)?.pass.schema ?? null;
}

/** What the program read warns about each texture, by its name. */
function useTextureWarnings(view: ViewContext): ReadonlyMap<string, string> {
  const warnings = useProgram(view)?.warnings ?? [];
  const byName = new Map<string, string>();
  for (const warning of warnings) {
    if (TEXTURE_WARNINGS.has(warning.kind) && "name" in warning) {
      byName.set(warning.name, warningText(warning));
    }
  }
  return byName;
}

/* DS-RADIUS. The shape of a written field with its surface taken away, which is how every
   value the shader supplies reads. */
const DEFAULT_BOX =
  "flex min-w-0 items-center rounded-sm border border-dashed border-surface-700 px-1 py-0.5 font-mono text-xs text-surface-500";

/** An entry that leaves `field` unwritten, which the shader's default then fills. */
function Unset({ className }: { className: string }) {
  return (
    <span className={className}>
      <span className={twMerge(DEFAULT_BOX, "select-none")}>
        {m.workshop_bin_material_default_label()}
      </span>
    </span>
  );
}

/** The editable value of `field` under `element`, or its default where it is unwritten. */
function ValueCell({
  element,
  field,
  className,
}: {
  element: BinRow;
  field: string;
  className: string;
}) {
  const row = useElementField(element, field);
  if (row === undefined) return <Unset className={className} />;
  return (
    <Cell row={row} className={className}>
      <RowValue row={row} />
    </Cell>
  );
}

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

/** A default written as the components its mask selects. */
function paramText(param: SchemaParam): string {
  return paramDefault(param)
    .slice(0, Math.max(1, componentCount(param.fields)))
    .map((value) => String(Number(value.toFixed(3))))
    .join(", ");
}

function ParamValue({ row }: { row: DeclaredRow<SchemaParam> }) {
  if (row.element !== null && row.declared !== null) {
    return <SetParam element={row.element} param={row.declared} />;
  }
  if (row.element !== null) {
    return <ValueCell element={row.element} field={FIELD.value} className={VALUE_WIDTH} />;
  }
  if (row.declared === null) return <span className={VALUE_WIDTH} />;
  return <InheritedParam name={row.name} param={row.declared} />;
}

/** A declared parameter the material leaves to the shader, whose edit adds the entry. */
function InheritedParam({ name, param }: { name: string; param: SchemaParam }) {
  const override = useOverride();
  const material = useMaterialEntry();
  if (override === null) {
    return (
      <Inherited className={VALUE_WIDTH} onOverride={null}>
        {paramText(param)}
      </Inherited>
    );
  }

  return (
    <span className={VALUE_WIDTH}>
      <LiveParam
        param={param}
        material={material}
        stored={null}
        write={(values) =>
          override(name, (at) => setField(at, FIELD.value, { type: "vector", values }))
        }
      />
    </span>
  );
}

/** A declared parameter the material has an entry for, drawn live while a field of it is held. */
function SetParam({ element, param }: { element: BinRow; param: SchemaParam }) {
  const material = useMaterialEntry();
  const value = useElementField(element, FIELD.value);
  const edit = use(LeafEditContext);
  const writeEntry = useEntryWrite();
  const vector = value?.value.type === "vector" ? value.value : null;
  if (edit === null || writeEntry === null || (value !== undefined && vector === null)) {
    return <ValueCell element={element} field={FIELD.value} className={VALUE_WIDTH} />;
  }

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

function Address({ row, field }: { row: DeclaredRow<SchemaTexture>; field: string }) {
  if (row.element === null) return <span className={ADDRESS_WIDTH} />;
  return <ValueCell element={row.element} field={field} className={ADDRESS_WIDTH} />;
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
  nameColumn(),
  {
    id: "value",
    header: () => (
      <Heading className={VALUE_WIDTH}>{m.workshop_bin_material_value_label()}</Heading>
    ),
    cell: ({ row }) => <ParamValue row={row.original} />,
  },
  actionsColumn(),
];

const SAMPLER_COLUMNS: DataTableColumn<DeclaredRow<SchemaTexture>>[] = [
  nameColumn(),
  {
    id: "texture",
    header: () => (
      <Heading className={VALUE_WIDTH}>{m.workshop_bin_material_texture_label()}</Heading>
    ),
    cell: ({ row }) => <TexturePath row={row.original} />,
  },
  ...(["addressU", "addressV", "addressW"] as const).map(
    (address): DataTableColumn<DeclaredRow<SchemaTexture>> => ({
      id: address,
      header: () => <Heading className={ADDRESS_WIDTH}>{address.slice(-1)}</Heading>,
      cell: ({ row }) => <Address row={row.original} field={FIELD[address]} />,
    }),
  ),
  actionsColumn(),
];

const SWITCH_COLUMNS: DataTableColumn<DeclaredRow<SchemaSwitch>>[] = [
  nameColumn(),
  {
    id: "on",
    header: () => <Heading className={VALUE_WIDTH}>{m.workshop_bin_material_on_label()}</Heading>,
    cell: ({ row }) => <SwitchOn row={row.original} />,
  },
  actionsColumn(),
];

/* A macro is a map entry, whose row is named by its key and holds its value itself. */
const MACRO_COLUMNS: DataTableColumn<BinRow>[] = [
  {
    id: "name",
    header: () => <Heading className={NAME_WIDTH}>{m.workshop_bin_material_name_label()}</Heading>,
    cell: ({ row }) => (
      <span className={twMerge(NAME_WIDTH, "truncate select-text")}>{row.original.name}</span>
    ),
  },
  {
    id: "value",
    header: () => (
      <Heading className={VALUE_WIDTH}>{m.workshop_bin_material_value_label()}</Heading>
    ),
    cell: ({ row }) => (
      <Cell row={row.original} className={VALUE_WIDTH}>
        <RowValue row={row.original} />
      </Cell>
    ),
  },
];

/** `paramValues` as a table of every parameter the shader declares, and its value. */
export function MaterialParams(props: WidgetProps) {
  const schema = useSchema(props.view);
  return (
    <DeclaredTable
      {...props}
      kind={PARAMS}
      declarations={schema?.params ?? null}
      columns={PARAM_COLUMNS}
    />
  );
}

/** `samplerValues` as a table of every texture the shader declares, its path and address modes. */
export function MaterialSamplers(props: WidgetProps) {
  const schema = useSchema(props.view);
  const warnings = useTextureWarnings(props.view);
  return (
    <DeclaredTable
      {...props}
      kind={SAMPLERS}
      declarations={schema?.textures ?? null}
      columns={SAMPLER_COLUMNS}
      warnings={warnings}
    />
  );
}

/** `switches` as a table of every switch the shader declares, and whether it is on. */
export function MaterialSwitches(props: WidgetProps) {
  const schema = useSchema(props.view);
  return (
    <DeclaredTable
      {...props}
      kind={SWITCHES}
      declarations={schema?.switches ?? null}
      columns={SWITCH_COLUMNS}
    />
  );
}

/** `shaderMacros` as a table of define and value. */
export function MaterialMacros({ section, pages }: WidgetProps) {
  return <TableRows rows={elementsOf(section.rows, pages)} columns={MACRO_COLUMNS} showHeader />;
}
