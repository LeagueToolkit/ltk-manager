import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components";
import type { StringKeySuggestion } from "@/lib/tauri";

import { useSaveStringOverrides } from "../../api/useSaveStringOverrides";
import { useProjectContext } from "../../components/ProjectContext";
import { LOCALES } from "../constants";
import type { OverrideEntry, OverrideEntryField } from "../types";

function validateEntries(entries: OverrideEntry[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const trimmedKey = entry.key.trim();

    if (!trimmedKey) {
      errors[entry.id] = "Field name cannot be empty";
    } else if (seenKeys.has(trimmedKey)) {
      errors[entry.id] = "Duplicate field name";
    }
    seenKeys.add(trimmedKey);
  }

  return errors;
}

/**
 * All state and behavior for the string-overrides editor: layer/locale
 * selection, the editable entry list with filtering and validation, and
 * saving back to the project.
 */
export function useStringOverridesEditor() {
  const project = useProjectContext();
  const toast = useToast();

  const [selectedLayer, setSelectedLayer] = useState<string>("base");
  const [selectedLocale, setSelectedLocale] = useState<string>("default");
  const [entries, setEntries] = useState<OverrideEntry[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const nextIdRef = useRef(0);
  const makeId = () => `ov-${nextIdRef.current++}`;

  const saveOverrides = useSaveStringOverrides();

  const currentLayer = project.layers.find((l) => l.name === selectedLayer);

  function toEntries(localeOverrides: Record<string, string>): OverrideEntry[] {
    return Object.entries(localeOverrides).map(([key, value]) => ({ id: makeId(), key, value }));
  }

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

    setEntries(toEntries(currentLayer.stringOverrides?.[selectedLocale] ?? {}));
    setHasChanges(false);
    setErrors({});
    setFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLayer, selectedLocale, project.path]);

  function addEntry() {
    const id = makeId();
    setEntries((prev) => [...prev, { id, key: "", value: "" }]);
    setHasChanges(true);
    setPendingFocusId(id);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setHasChanges(true);
  }

  function updateEntry(id: string, field: OverrideEntryField, value: string) {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)),
    );
    setHasChanges(true);
  }

  function pickSuggestion(id: string, suggestion: StringKeySuggestion) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== id) return entry;

        return {
          ...entry,
          key: suggestion.key,
          // Prefill the current in-game text so the author edits instead of
          // starting from scratch; never clobber a value they already typed.
          value: entry.value || (suggestion.value ?? ""),
        };
      }),
    );

    setHasChanges(true);
  }

  function clearPendingFocus() {
    setPendingFocusId(null);
  }

  function discard() {
    setEntries(toEntries(currentLayer?.stringOverrides?.[selectedLocale] ?? {}));
    setHasChanges(false);
    setErrors({});
  }

  function save() {
    if (!currentLayer) return;

    const validationErrors = validateEntries(entries);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      // Clear the filter so every highlighted entry is visible.
      setFilter("");
      toast.error("Can't save overrides", "Fix the highlighted entries first.");
      return;
    }

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

  const localeOptions = LOCALES.map((locale) => {
    const count = Object.keys(currentLayer?.stringOverrides?.[locale.value] ?? {}).length;

    return {
      value: locale.value,
      label: count > 0 ? `${locale.label} · ${count}` : locale.label,
    };
  });

  return {
    layers: project.layers,
    selectedLayer,
    setSelectedLayer,
    selectedLocale,
    setSelectedLocale,
    localeOptions,
    entries,
    filter,
    setFilter,
    errors,
    hasChanges,
    isSaving: saveOverrides.isPending,
    pendingFocusId,
    clearPendingFocus,
    addEntry,
    removeEntry,
    updateEntry,
    pickSuggestion,
    discard,
    save,
  };
}
