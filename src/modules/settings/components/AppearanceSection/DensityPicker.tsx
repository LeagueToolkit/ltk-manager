import { RadioGroup } from "@/components";
import { useDisplayStore } from "@/stores";

const DENSITY_OPTIONS = [
  { value: "compact" as const, title: "Compact", description: "Tighter spacing" },
  { value: "normal" as const, title: "Normal", description: "Default spacing" },
  { value: "spacious" as const, title: "Spacious", description: "More breathing room" },
];

export function DensityPicker() {
  const density = useDisplayStore((s) => s.density);
  const setDensity = useDisplayStore((s) => s.setDensity);

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup.Root value={density} onValueChange={setDensity}>
        <RadioGroup.Label>UI Density</RadioGroup.Label>
        <RadioGroup.Options>
          {DENSITY_OPTIONS.map((opt) => (
            <RadioGroup.Card
              key={opt.value}
              value={opt.value}
              title={opt.title}
              description={opt.description}
            />
          ))}
        </RadioGroup.Options>
      </RadioGroup.Root>
    </div>
  );
}
