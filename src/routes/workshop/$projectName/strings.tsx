import { createFileRoute } from "@tanstack/react-router";
import { Globe, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, Field, IconButton, Tabs, Tooltip, useToast } from "@/components";
import type { WorkshopLayer } from "@/lib/tauri";
import { useProjectContext, useSaveStringOverrides } from "@/modules/workshop";

export const Route = createFileRoute("/workshop/$projectName/strings")({
  component: ProjectStrings,
});

interface OverrideEntry {
  key: string;
  value: string;
}

const LOCALES = [
  { value: "default", label: "Default (All Locales)" },
  { value: "en_us", label: "English (US)" },
  { value: "en_gb", label: "English (UK)" },
  { value: "en_au", label: "English (AU)" },
  { value: "en_ph", label: "English (PH)" },
  { value: "en_sg", label: "English (SG)" },
  { value: "ko_kr", label: "Korean" },
  { value: "ja_jp", label: "Japanese" },
  { value: "zh_cn", label: "Chinese (Simplified)" },
  { value: "zh_tw", label: "Chinese (Traditional)" },
  { value: "es_es", label: "Spanish (EU)" },
  { value: "es_mx", label: "Spanish (LATAM)" },
  { value: "es_ar", label: "Spanish (AR)" },
  { value: "pt_br", label: "Portuguese (BR)" },
  { value: "fr_fr", label: "French" },
  { value: "de_de", label: "German" },
  { value: "it_it", label: "Italian" },
  { value: "pl_pl", label: "Polish" },
  { value: "ro_ro", label: "Romanian" },
  { value: "el_gr", label: "Greek" },
  { value: "ru_ru", label: "Russian" },
  { value: "tr_tr", label: "Turkish" },
  { value: "cs_cz", label: "Czech" },
  { value: "hu_hu", label: "Hungarian" },
  { value: "th_th", label: "Thai" },
  { value: "vn_vn", label: "Vietnamese" },
  { value: "id_id", label: "Indonesian" },
  { value: "ms_my", label: "Malay" },
] as const;

function ProjectStrings() {
  const project = useProjectContext();
  const toast = useToast();

  const [selectedLayer, setSelectedLayer] = useState<string>("base");
  const [selectedLocale, setSelectedLocale] = useState<string>("default");
  const [entries, setEntries] = useState<OverrideEntry[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const saveOverrides = useSaveStringOverrides();

  const currentLayer = project.layers.find((l) => l.name === selectedLayer);
  const layers = project.layers;

  // Reset selected layer when project changes
  useEffect(() => {
    if (project.layers.length) {
      setSelectedLayer(project.layers[0].name);
      setSelectedLocale("default");
    }
  }, [project.path, project.layers]);

  // Reset entries when layer/locale changes
  useEffect(() => {
    if (!currentLayer) {
      setEntries([]);
      return;
    }
    const localeOverrides = currentLayer.stringOverrides?.[selectedLocale] ?? {};
    const initial = Object.entries(localeOverrides).map(([key, value]) => ({ key, value }));
    setEntries(initial);
    setHasChanges(false);
    setErrors({});
  }, [currentLayer, selectedLocale, project.path]);

  const validate = useCallback((entriesToValidate: OverrideEntry[]): boolean => {
    const newErrors: Record<number, string> = {};
    const seenKeys = new Set<string>();

    for (let i = 0; i < entriesToValidate.length; i++) {
      const entry = entriesToValidate[i];
      const trimmedKey = entry.key.trim();

      if (!trimmedKey) {
        newErrors[i] = "Field name cannot be empty";
      } else if (seenKeys.has(trimmedKey)) {
        newErrors[i] = "Duplicate field name";
      }
      seenKeys.add(trimmedKey);
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, []);

  function handleAddEntry() {
    setEntries((prev) => [...prev, { key: "", value: "" }]);
    setHasChanges(true);
  }

  function handleRemoveEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setHasChanges(true);
  }

  function handleUpdateEntry(index: number, field: "key" | "value", val: string) {
    setEntries((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: val };
      return updated;
    });
    setHasChanges(true);
  }

  function handleSave() {
    if (!currentLayer || !validate(entries)) return;

    const localeOverrides: Record<string, string> = {};
    for (const entry of entries) {
      const trimmedKey = entry.key.trim();
      if (trimmedKey) {
        localeOverrides[trimmedKey] = entry.value;
      }
    }

    const allOverrides: Record<string, Record<string, string>> = {
      ...currentLayer.stringOverrides,
    };

    if (Object.keys(localeOverrides).length > 0) {
      allOverrides[selectedLocale] = localeOverrides;
    } else {
      delete allOverrides[selectedLocale];
    }

    saveOverrides.mutate(
      {
        projectPath: project.path,
        layerName: selectedLayer,
        stringOverrides: allOverrides,
      },
      {
        onSuccess: () => {
          setHasChanges(false);
          toast.success("String overrides saved");
        },
      },
    );
  }

  const overrideCount = entries.length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-surface-100">String Overrides</h2>
        <p className="mt-1 text-sm text-surface-400">
          Override in-game text strings per locale and layer.
        </p>
      </div>

      {/* Layer tabs */}
      {layers.length > 1 && (
        <Tabs.Root value={selectedLayer} onValueChange={setSelectedLayer}>
          <Tabs.List>
            {layers.map((layer) => (
              <Tabs.Tab key={layer.name} value={layer.name}>
                {layer.name}
                <OverrideBadge layer={layer} />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.Root>
      )}

      {/* Locale selector */}
      <Field.Root>
        <Field.Label>Locale</Field.Label>
        <div className="relative">
          <Globe className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-surface-400" />
          <select
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value)}
            className="w-full appearance-none rounded-lg border border-surface-600 bg-surface-700 px-9 py-2 text-sm text-surface-100 transition-colors outline-none hover:border-surface-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          >
            {LOCALES.map((locale) => (
              <option key={locale.value} value={locale.value}>
                {locale.label}
              </option>
            ))}
          </select>
        </div>
      </Field.Root>

      {/* Entries */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-surface-400">
            {overrideCount === 0
              ? "No string overrides configured for this locale."
              : `${overrideCount} override${overrideCount !== 1 ? "s" : ""}`}
          </p>
          <Button
            variant="outline"
            size="sm"
            left={<Plus className="h-4 w-4" />}
            onClick={handleAddEntry}
          >
            Add Override
          </Button>
        </div>

        {entries.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1 text-xs font-medium text-surface-400">
              <div className="flex-1">Field Name</div>
              <div className="flex-1">Value</div>
              <div className="w-9" />
            </div>

            {entries.map((entry, index) => (
              <div key={index} className="flex items-start gap-2">
                <Field.Root className="flex-1">
                  <Field.Control
                    type="text"
                    value={entry.key}
                    onChange={(e) => handleUpdateEntry(index, "key", e.target.value)}
                    placeholder="game_character_displayname_Ahri"
                  />
                  {errors[index] && <Field.Error>{errors[index]}</Field.Error>}
                </Field.Root>

                <Field.Root className="flex-1">
                  <Field.Control
                    type="text"
                    value={entry.value}
                    onChange={(e) => handleUpdateEntry(index, "value", e.target.value)}
                    placeholder="Fox Spirit"
                  />
                </Field.Root>

                <Tooltip content="Delete entry">
                  <IconButton
                    icon={<Trash2 className="h-4 w-4" />}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveEntry(index)}
                    className="mt-1"
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <Button
        variant="filled"
        onClick={handleSave}
        disabled={!hasChanges || saveOverrides.isPending}
      >
        {saveOverrides.isPending ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}

function OverrideBadge({ layer }: { layer: WorkshopLayer }) {
  const totalCount = Object.values(layer.stringOverrides).reduce(
    (sum, localeOverrides) => sum + Object.keys(localeOverrides).length,
    0,
  );

  if (totalCount === 0) return null;

  return (
    <span className="ml-2 rounded-full bg-accent-500/20 px-2 py-0.5 text-xs font-medium text-accent-400">
      {totalCount}
    </span>
  );
}
