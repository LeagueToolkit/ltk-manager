import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { Cell } from "../../classes/components/ClassCells";
import { nameHash } from "../../shared/utils/binHash";
import { RowValue } from "../../tree/components/BinRow";
import { useElementField } from "../hooks/useEntryEdits";

/** The fields of the three material list classes, by hash. */
export const FIELD = {
  name: nameHash("name"),
  value: nameHash("value"),
  on: nameHash("on"),
  textureName: nameHash("TextureName"),
  texturePath: nameHash("texturePath"),
  addressU: nameHash("addressU"),
  addressV: nameHash("addressV"),
  addressW: nameHash("addressW"),
} as const;

export const VALUE_WIDTH = "flex min-w-0 flex-1 items-center";

/* DS-RADIUS. The shape of a written field with its surface taken away, which is how every
   value the shader supplies reads. */
export const DEFAULT_BOX =
  "flex min-w-0 items-center rounded-sm border border-dashed border-surface-700 px-1 py-0.5 font-mono text-xs text-surface-500";

/** An entry that leaves `field` unwritten, which the shader's default then fills. */
export function Unset({ className }: { className: string }) {
  return (
    <span className={className}>
      <span className={twMerge(DEFAULT_BOX, "select-none")}>
        {m.workshop_bin_material_default_label()}
      </span>
    </span>
  );
}

/** The editable value of `field` under `element`, or its default where it is unwritten. */
export function ValueCell({
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
