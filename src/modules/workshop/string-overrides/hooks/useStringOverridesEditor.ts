import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components";
import type { StringKeySuggestion, WorkshopProject } from "@/lib/tauri";

import { useSaveStringOverrides } from "../../api/useSaveStringOverrides";
import { useProjectContext } from "../../components/ProjectContext";
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

function savedOverridesOf(
  project: WorkshopProject,
  layerName: string,
  locale: string,
): Record<string, string> {
  const layer = project.layers.find((candidate) => candidate.name === layerName);
  return layer?.stringOverrides?.[locale] ?? {};
}

/**
 * The editable override list for one layer and locale, and saving it back.
 *
 * The draft is reloaded when the layer or locale changes, not when the
 * project object does, so a background refetch cannot swallow unsaved edits.
 */
export function useStringOverridesEditor(layerName: string, locale: string) {
  const project = useProjectContext();
  const toast = useToast();

  const [entries, setEntries] = useState<OverrideEntry[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const nextIdRef = useRef(0);
  const makeId = () => `ov-${nextIdRef.current++}`;

  const saveOverrides = useSaveStringOverrides();

  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  });

  function toEntries(localeOverrides: Record<string, string>): OverrideEntry[] {
    return Object.entries(localeOverrides).map(([key, value]) => ({ id: makeId(), key, value }));
  }

  useEffect(() => {
    setEntries(toEntries(savedOverridesOf(projectRef.current, layerName, locale)));
    setHasChanges(false);
    setErrors({});
    setFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerName, locale, project.path]);

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
    setEntries(toEntries(savedOverridesOf(projectRef.current, layerName, locale)));
    setHasChanges(false);
    setErrors({});
  }

  function save() {
    const layer = project.layers.find((candidate) => candidate.name === layerName);
    if (!layer) return;

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

    const allOverrides: Record<string, Record<string, string>> = { ...layer.stringOverrides };

    if (Object.keys(localeOverrides).length > 0) {
      allOverrides[locale] = localeOverrides;
    } else {
      delete allOverrides[locale];
    }

    saveOverrides.mutate(
      {
        projectPath: project.path,
        layerName,
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

  return {
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
