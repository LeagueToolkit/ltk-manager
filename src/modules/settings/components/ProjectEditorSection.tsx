import { TabsIcon } from "@phosphor-icons/react";

import { SectionCard, SegmentedControl } from "@/components";
import { useSetTabOpenMode, useTabOpenMode } from "@/stores";

import { SettingRow } from "./SettingRow";

const TAB_OPEN_OPTIONS = [
  { value: "append" as const, label: "New tab" },
  { value: "replace" as const, label: "Reuse tab" },
];

export function ProjectEditorSection() {
  const tabOpenMode = useTabOpenMode();
  const setTabOpenMode = useSetTabOpenMode();

  return (
    <SectionCard
      title="Project editor"
      icon={<TabsIcon className="h-5 w-5" />}
      description="Options for the editor you open a project in"
    >
      <SettingRow
        title="Opening a file"
        description="Reusing keeps one tab and swaps what it holds, so a walk through a directory stays one tab wide."
        control={
          <SegmentedControl
            options={TAB_OPEN_OPTIONS}
            value={tabOpenMode}
            onChange={setTabOpenMode}
          />
        }
      />
    </SectionCard>
  );
}
