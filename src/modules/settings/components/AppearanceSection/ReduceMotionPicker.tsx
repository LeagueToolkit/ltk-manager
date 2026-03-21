import { RadioGroup } from "@/components";
import { useDisplayStore } from "@/stores";

const MOTION_OPTIONS = [
  {
    value: "system" as const,
    label: "System Default",
    description: "Follows your OS preference",
  },
  { value: "on" as const, label: "On", description: "Disable all animations" },
  { value: "off" as const, label: "Off", description: "Always animate" },
];

export function ReduceMotionPicker() {
  const reduceMotion = useDisplayStore((s) => s.reduceMotion);
  const setReduceMotion = useDisplayStore((s) => s.setReduceMotion);

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup.Root value={reduceMotion} onValueChange={setReduceMotion}>
        <RadioGroup.Label>Reduce Motion</RadioGroup.Label>
        <RadioGroup.Options>
          {MOTION_OPTIONS.map((opt) => (
            <RadioGroup.Item
              key={opt.value}
              value={opt.value}
              label={opt.label}
              description={opt.description}
            />
          ))}
        </RadioGroup.Options>
      </RadioGroup.Root>
    </div>
  );
}
