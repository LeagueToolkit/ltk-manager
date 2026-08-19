import { SegmentedControl } from "@/components";
import { useScrollMode, useSetScrollMode } from "@/stores";

const SCROLL_OPTIONS = [
  { value: "smooth" as const, label: "Smooth" },
  { value: "spring" as const, label: "Spring" },
];

export function ScrollModePicker() {
  const scrollMode = useScrollMode();
  const setScrollMode = useSetScrollMode();

  return <SegmentedControl options={SCROLL_OPTIONS} value={scrollMode} onChange={setScrollMode} />;
}
