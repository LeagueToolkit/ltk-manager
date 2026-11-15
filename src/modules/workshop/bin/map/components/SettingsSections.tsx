import { MinusCircleIcon, PlusCircleIcon, PlusIcon } from "@phosphor-icons/react";
import { useMemo } from "react";

import { Button, Disclosure, IconButton, useToast } from "@/components";
import { m } from "@/i18n";
import { api, type AssetRef, type BinDocumentId, type BinEdit, type BinRow } from "@/lib/tauri";

import { useBinRead } from "../../documents/hooks/useBinRead";
import { hashOf, nameHash } from "../../shared/utils/binHash";
import { BinTree } from "../../tree/components/BinTree";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { useLeafEdit } from "../../tree/hooks/useLeafEdit";
import { PAGE_SIZE, rowKey } from "../../tree/utils/binRows";
import { useMapScene } from "../state/mapScene";
import {
  COMPONENTS_STEP,
  componentRow,
  missingFields,
  type PartOwner,
  partRows,
  type SectionPart,
  type SettingsSection,
} from "../utils/mapSettings";

/** The most rows one part's tree shows before it scrolls. */
const PART_ROWS = 14;

/** The most components a container lists that the sections look through. */
const COMPONENT_ROWS = 200;

/** The bin of the tab, which holds the `Map` and the `MapSkin` of a map opened from either. */
export interface TabBin {
  readonly document: BinDocumentId;
  readonly asset: AssetRef;
  readonly editable: boolean;
}

/** The class of the object each owner is. */
const OWNER_CLASS: Readonly<Record<PartOwner, string>> = {
  container: "MapContainer",
  skin: "MapSkin",
  map: "Map",
};

/** One object that a part reads, and the bin it is in. */
interface PartSource {
  readonly document: BinDocumentId;
  readonly asset: AssetRef;
  readonly editable: boolean;
  readonly entry: string;
  readonly path: string;
  readonly owner: string;
}

export interface SettingsSectionsProps {
  readonly sections: readonly SettingsSection[];
  readonly tab: TabBin;
  readonly objectName: (entry: string) => string;
  readonly onNotOpen: () => void;
  /** The sections open at mount, by id. */
  readonly opened?: readonly string[];
  /** Called when the reader opens or closes the section `id`. */
  readonly onOpenChange?: (id: string, open: boolean) => void;
}

/**
 * Folding sections of fields read from the map's container, its components, its `MapSkin` and its
 * `Map`, each part an editable `BinTree`.
 *
 * A section whose component the container lacks shows Add in its header, which appends the
 * component. A listed field that the object does not author shows an Add button. A part whose
 * object the tab does not hold, such as the skin of a map opened from its container, is left out.
 */
export function SettingsSections(props: SettingsSectionsProps) {
  const { materials, materialsAsset } = useMapScene();
  if (materials === null || materialsAsset === null) return null;

  return <SectionList {...props} materials={materials} materialsAsset={materialsAsset} />;
}

function SectionList({
  sections,
  tab,
  objectName,
  onNotOpen,
  opened = [],
  onOpenChange,
  materials,
  materialsAsset,
}: SettingsSectionsProps & {
  materials: BinDocumentId;
  materialsAsset: AssetRef;
}) {
  const { chosen, editable } = useMapScene();
  const container = chosen === null ? null : nameHash(chosen.map);
  const listKey = container === null ? null : rowKey({ entry: container, path: COMPONENTS_STEP });
  const requests = useMemo(
    () => (listKey === null ? [] : [{ key: listKey, rows: COMPONENT_ROWS }]),
    [listKey],
  );
  const pages = useBinRead(materials, requests);
  const components = (listKey === null ? undefined : pages.get(listKey)?.rows) ?? [];

  const invalidate = useInvalidateBinReads();
  const { send, landed } = useLeafEdit(materials, materialsAsset, invalidate);
  const toast = useToast();
  const edit = async (change: BinEdit) => {
    const { result, id } = await send((id) => api.bin.edit(id, change));
    if (!result.ok) {
      toast.failure(m.workshop_bin_edit_refused_title(), result.error);
      return;
    }
    landed(id);
  };

  const sourceOf = (part: SectionPart): PartSource | null => {
    if (part.owner === "container") {
      if (container === null) return null;

      const base = {
        document: materials,
        asset: materialsAsset,
        editable,
        entry: container,
      };
      if (part.component === undefined) {
        return { ...base, path: "", owner: hashOf(OWNER_CLASS.container) };
      }
      const row = componentRow(components, part.component);
      return row === null ? null : { ...base, path: row.path, owner: hashOf(part.component) };
    }

    const entry = part.owner === "skin" ? chosen?.skinEntry : chosen?.mapEntry;
    if (entry === null || entry === undefined) return null;
    return { ...tab, entry, path: "", owner: hashOf(OWNER_CLASS[part.owner]) };
  };

  return (
    <div data-ui="SettingsSections" className="flex flex-col gap-1">
      {sections.map((section) => {
        const sources = section.parts.map(sourceOf);
        const absent = section.parts.filter(
          (part, at) => part.component !== undefined && sources[at] === null,
        );
        const shown = section.parts.flatMap((part, at) => {
          const source = sources[at];
          return source === null || source === undefined ? [] : [{ part, source }];
        });
        if (shown.length === 0 && (absent.length === 0 || container === null)) return null;

        const removable = section.parts.flatMap((part) => {
          if (part.component === undefined || part.removable !== true) return [];
          const row = componentRow(components, part.component);
          return row === null ? [] : [row];
        });

        const actions = (
          <>
            {editable &&
              container !== null &&
              absent.map((part) => (
                <IconButton
                  key={part.component}
                  icon={<PlusCircleIcon />}
                  onClick={() =>
                    void edit({
                      kind: "insertItem",
                      entry: container,
                      path: COMPONENTS_STEP,
                      item: {
                        index: null,
                        key: null,
                        class: part.component ?? null,
                      },
                    })
                  }
                  label={m.workshop_bin_map_settings_add_action()}
                />
              ))}
            {editable &&
              container !== null &&
              removable.map((row) => (
                <IconButton
                  key={row.path}
                  icon={<MinusCircleIcon />}
                  onClick={() =>
                    void edit({
                      kind: "removeItem",
                      entry: container,
                      path: row.path,
                    })
                  }
                  label={m.workshop_bin_map_settings_remove_action()}
                />
              ))}
          </>
        );

        /* A section with nothing to show folds nothing, so it draws as a plain row. */
        if (shown.length === 0) {
          return (
            <div key={section.id} className="flex min-w-0 items-center gap-1 px-1">
              <span className="min-w-0 flex-1 truncate py-1 pl-5 text-row text-surface-400">
                {section.title()}
              </span>
              {actions}
            </div>
          );
        }

        return (
          <Disclosure.Root
            key={section.id}
            defaultOpen={opened.includes(section.id)}
            onOpenChange={(open) => onOpenChange?.(section.id, open)}
          >
            <div className="flex min-w-0 items-center gap-1 px-1">
              <Disclosure.Trigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-row text-surface-100">
                <Disclosure.Caret />
                <span className="truncate">{section.title()}</span>
              </Disclosure.Trigger>
              {actions}
            </div>
            <Disclosure.Panel className="flex flex-col gap-1.5 pb-2">
              {shown.map(({ part, source }) => (
                <PartTree
                  key={`${source.entry}:${source.path}:${part.fields?.join() ?? ""}`}
                  part={part}
                  source={source}
                  label={section.title()}
                  objectName={objectName}
                  onNotOpen={onNotOpen}
                />
              ))}
            </Disclosure.Panel>
          </Disclosure.Root>
        );
      })}
    </div>
  );
}

interface PartTreeProps {
  readonly part: SectionPart;
  readonly source: PartSource;
  readonly label: string;
  readonly objectName: (entry: string) => string;
  readonly onNotOpen: () => void;
}

/** The fields of one part as an editable tree, with an Add button per listed field it lacks. */
function PartTree({ part, source, label, objectName, onNotOpen }: PartTreeProps) {
  const holder = rowKey({ entry: source.entry, path: source.path });
  const requests = useMemo(() => [{ key: holder, rows: PAGE_SIZE }], [holder]);
  const pages = useBinRead(source.document, requests);
  const read: readonly BinRow[] | undefined = pages.get(holder)?.rows;
  const rows = useMemo(() => partRows(read ?? [], part), [read, part]);
  const missing = read === undefined ? [] : missingFields(read, part);

  const invalidate = useInvalidateBinReads();
  const { send, landed } = useLeafEdit(source.document, source.asset, invalidate);
  const toast = useToast();
  const add = async (field: string) => {
    const { result, id } = await send((id) =>
      api.bin.edit(id, {
        kind: "addProperty",
        entry: source.entry,
        path: source.path,
        property: { kind: "declared", field: hashOf(field) },
      }),
    );
    if (!result.ok) {
      toast.failure(m.workshop_bin_edit_refused_title(), result.error);
      return;
    }
    landed(id);
  };

  return (
    <div className="flex flex-col gap-1">
      {rows.length > 0 && (
        /* DS-GROUND, DS-RADIUS */
        <div className="flex flex-col rounded-md border border-surface-700/50 bg-surface-900">
          <BinTree
            document={source.document}
            asset={source.asset}
            roots={rows}
            rootOwner={source.owner}
            label={label}
            maxRows={PART_ROWS}
            objectName={objectName}
            onNotOpen={onNotOpen}
            editable={source.editable}
          />
        </div>
      )}
      {source.editable && missing.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {missing.map((field) => (
            <Button
              key={field}
              variant="ghost"
              size="sm"
              left={<PlusIcon />}
              onClick={() => void add(field)}
            >
              {field}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
