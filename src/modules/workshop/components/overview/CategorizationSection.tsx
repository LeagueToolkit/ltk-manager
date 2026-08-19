import { Tags } from "lucide-react";
import { useMemo } from "react";

import {
  ChampionIcon,
  Field,
  MultiSelect,
  type MultiSelectOption,
  SectionCard,
} from "@/components";
import { getMapLabel, getTagLabel, WELL_KNOWN_MAPS, WELL_KNOWN_TAGS } from "@/modules/library";

interface CategorizationSectionProps {
  selectedTags: Set<string>;
  onTagsChange: (tags: Set<string>) => void;
  selectedMaps: Set<string>;
  onMapsChange: (maps: Set<string>) => void;
  championsText: string;
  onChampionsChange: (text: string) => void;
}

export function CategorizationSection({
  selectedTags,
  onTagsChange,
  selectedMaps,
  onMapsChange,
  championsText,
  onChampionsChange,
}: CategorizationSectionProps) {
  const tagOptions = useMemo<MultiSelectOption[]>(
    () => WELL_KNOWN_TAGS.map((v) => ({ value: v, label: getTagLabel(v) })),
    [],
  );
  const mapOptions = useMemo<MultiSelectOption[]>(
    () => WELL_KNOWN_MAPS.map((v) => ({ value: v, label: getMapLabel(v) })),
    [],
  );

  return (
    <SectionCard
      title="Categorization"
      icon={<Tags className="h-4 w-4" />}
      description="Help users find your mod by adding tags, maps, and champions."
      panelClassName="bg-surface-800"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-surface-200">Tags</label>
          <MultiSelect
            variant="field"
            options={tagOptions}
            selected={selectedTags}
            onChange={onTagsChange}
            label="Select tags..."
            placeholder="Search tags..."
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-surface-200">Maps</label>
          <MultiSelect
            variant="field"
            options={mapOptions}
            selected={selectedMaps}
            onChange={onMapsChange}
            label="Select maps..."
            placeholder="Search maps..."
          />
        </div>
        <Field.Root className="sm:col-span-2">
          <Field.Label className="flex items-center gap-1.5">
            <ChampionIcon className="h-4 w-4 text-surface-400" />
            Champions
          </Field.Label>
          <Field.Control
            value={championsText}
            onChange={(e) => onChampionsChange(e.target.value)}
            placeholder="Aatrox, Ahri, Zed..."
          />
          <Field.Description>Comma-separated champion names.</Field.Description>
        </Field.Root>
      </div>
    </SectionCard>
  );
}
