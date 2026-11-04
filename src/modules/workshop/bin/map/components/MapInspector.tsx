import type { ReactNode } from "react";

import { Disclosure } from "@/components";
import { m } from "@/i18n";

import { useMapScene } from "../state/mapScene";
import { SETTINGS_SECTIONS } from "../utils/mapSettings";
import { MeshInspector } from "./MeshInspector";
import { NavCellInspector } from "./NavCellInspector";
import { PlaceableInspector } from "./PlaceableInspector";
import { SettingsSections, type TabBin } from "./SettingsSections";

export interface MapInspectorProps {
  readonly tab: TabBin;
  readonly objectName: (entry: string) => string;
  readonly onNotOpen: () => void;
  /** The sections of the tab's own object, which the map settings fold under All fields. */
  readonly children: ReactNode;
}

/**
 * The inspector of the map shell: the lead mesh, placeable or navgrid cell, or the map settings
 * when nothing is selected. Per "Selection" and "Map settings" in docs/ux/MAP_EDITOR.md.
 */
export function MapInspector({ tab, objectName, onNotOpen, children }: MapInspectorProps) {
  const { selected } = useMapScene();

  if (selected.size > 0) {
    return (
      <InspectorScroll>
        <MeshInspector />
        <PlaceableInspector objectName={objectName} onNotOpen={onNotOpen} />
        <NavCellInspector />
      </InspectorScroll>
    );
  }

  return (
    <InspectorScroll>
      <SettingsSections
        sections={SETTINGS_SECTIONS}
        tab={tab}
        objectName={objectName}
        onNotOpen={onNotOpen}
        opened={["container"]}
      />
      <Disclosure.Root>
        <Disclosure.Trigger className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-1 text-row text-surface-100">
          <Disclosure.Caret />
          <span className="truncate">{m.workshop_bin_map_settings_all_fields_label()}</span>
        </Disclosure.Trigger>
        <Disclosure.Panel className="flex flex-col gap-3">{children}</Disclosure.Panel>
      </Disclosure.Root>
    </InspectorScroll>
  );
}

function InspectorScroll({ children }: { children: ReactNode }) {
  return (
    /* DS-SCROLLBAR */
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 scrollbar-md">
      {children}
    </div>
  );
}
