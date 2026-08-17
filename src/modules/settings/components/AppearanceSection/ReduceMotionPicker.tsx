import { SegmentedControl } from "@/components";
import { useDisplayStore } from "@/stores";

const MOTION_OPTIONS = [
  { value: "system" as const, label: "System" },
  { value: "on" as const, label: "On" },
  { value: "off" as const, label: "Off" },
];

export function ReduceMotionPicker() {
  const reduceMotion = useDisplayStore((s) => s.reduceMotion);
  const setReduceMotion = useDisplayStore((s) => s.setReduceMotion);

  return (
    <SegmentedControl options={MOTION_OPTIONS} value={reduceMotion} onChange={setReduceMotion} />
  );
}
