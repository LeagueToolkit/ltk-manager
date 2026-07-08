import { type Ref, useState } from "react";

import { Combobox, Field } from "@/components";
import type { StringKeySuggestion } from "@/lib/tauri";

import { useStringKeySearch } from "../../api/useStringKeySearch";

interface StringKeyFieldProps {
  value: string;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (key: string) => void;
  onPick: (suggestion: StringKeySuggestion) => void;
}

/**
 * Field-name input with autocomplete over every known stringtable key,
 * previewing what each one currently says in game. Free text is allowed —
 * suggestions are an aid, not a constraint.
 */
export function StringKeyField({ value, error, inputRef, onChange, onPick }: StringKeyFieldProps) {
  const [open, setOpen] = useState(false);
  const search = useStringKeySearch(value, open);
  const suggestions = search.data?.suggestions ?? [];

  return (
    <Field.Root className="min-w-0 flex-1">
      <Combobox.Root<StringKeySuggestion>
        items={suggestions}
        inputValue={value}
        onInputValueChange={(key, eventDetails) => {
          // When the popup closes, Base UI syncs the input to its internal
          // selection — clearing it if nothing was picked this session. This
          // field is free-text, so only user-initiated edits may change it.
          if (eventDetails.reason === "input-clear" || eventDetails.reason === "none") return;
          onChange(key);
        }}
        onValueChange={(suggestion) => {
          if (suggestion) onPick(suggestion);
        }}
        open={open}
        onOpenChange={setOpen}
        filter={() => true}
        itemToStringLabel={(suggestion) => suggestion.key}
        itemToStringValue={(suggestion) => suggestion.key}
      >
        <Combobox.Input
          ref={inputRef}
          placeholder="game_character_displayname_Ahri"
          hasError={!!error}
        />
        <Combobox.Portal>
          <Combobox.Positioner side="bottom" sideOffset={4} className="z-50">
            <Combobox.Popup className="max-h-72 w-[calc(var(--anchor-width)+8rem)] min-w-72 overflow-y-auto rounded-lg border border-surface-600 bg-surface-800 py-1 shadow-xl data-ending-style:opacity-0 data-starting-style:opacity-0">
              <Combobox.List>
                {(suggestion: StringKeySuggestion) => (
                  <Combobox.Item
                    key={suggestion.key}
                    value={suggestion}
                    className="text-surface-300 data-highlighted:bg-surface-600"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-xs text-surface-100">
                        {suggestion.key}
                      </span>
                      {suggestion.value && (
                        <span className="truncate text-xs text-surface-400">
                          {suggestion.value}
                        </span>
                      )}
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
              <Combobox.Empty>
                <p className="px-3 py-4 text-center text-sm text-surface-400">
                  {search.isPending && "Loading field names… (first load can take a moment)"}
                  {search.isError && "Field name search is unavailable right now."}
                  {search.isSuccess && "No matching field names."}
                </p>
              </Combobox.Empty>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {/* Without `match`, Base UI only shows errors for native ValidityState
          failures — ours come from external validation. */}
      {error && <Field.Error match>{error}</Field.Error>}
    </Field.Root>
  );
}
