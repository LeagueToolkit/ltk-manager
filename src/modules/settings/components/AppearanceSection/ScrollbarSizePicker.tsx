import { SegmentedControl } from "@/components";
import { useScrollbarSize, useSetScrollbarSize } from "@/stores";

const SCROLLBAR_OPTIONS = [
  { value: "thin" as const, label: "Thin" },
  { value: "default" as const, label: "Default" },
  { value: "wide" as const, label: "Wide" },
];

export function ScrollbarSizePicker() {
  const scrollbarSize = useScrollbarSize();
  const setScrollbarSize = useSetScrollbarSize();

  return (
    <SegmentedControl
      options={SCROLLBAR_OPTIONS}
      value={scrollbarSize}
      onChange={setScrollbarSize}
    />
  );
}
