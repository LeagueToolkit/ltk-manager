import { createFileRoute } from "@tanstack/react-router";

import { Button, SelectField, Tabs } from "@/components";
import {
  LayerOverrideBadge,
  StringOverridesEmptyState,
  StringOverridesHelpPopover,
  StringOverridesTable,
  StringOverridesToolbar,
  useStringOverridesEditor,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/$projectName/strings")({
  component: ProjectStrings,
});

function ProjectStrings() {
  const editor = useStringOverridesEditor();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-surface-100">String Overrides</h2>
          <p className="mt-1 text-sm text-surface-400">
            Override in-game text strings per layer and locale.
          </p>
        </div>
        <StringOverridesHelpPopover />
      </div>

      {/* Layer selector */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-surface-200">Layer</p>
        <Tabs.Root value={editor.selectedLayer} onValueChange={editor.setSelectedLayer}>
          <Tabs.List>
            {editor.layers.map((layer) => (
              <Tabs.Tab key={layer.name} value={layer.name} className="flex max-w-56 items-center">
                <span className="min-w-0 truncate">{layer.displayName}</span>
                <LayerOverrideBadge layer={layer} />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </div>

      {/* Locale + entries */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SelectField
            label="Locale"
            options={editor.localeOptions}
            value={editor.selectedLocale}
            onValueChange={(value) => {
              if (value) editor.setSelectedLocale(value);
            }}
            className="w-64"
          />
          {editor.entries.length > 0 && (
            <StringOverridesToolbar
              filter={editor.filter}
              onFilterChange={editor.setFilter}
              onAdd={editor.addEntry}
            />
          )}
        </div>

        {editor.entries.length === 0 && <StringOverridesEmptyState onAdd={editor.addEntry} />}

        {editor.entries.length > 0 && (
          <StringOverridesTable
            entries={editor.entries}
            errors={editor.errors}
            filter={editor.filter}
            pendingFocusId={editor.pendingFocusId}
            onClearFilter={() => editor.setFilter("")}
            onFocusHandled={editor.clearPendingFocus}
            onUpdateEntry={editor.updateEntry}
            onPickSuggestion={editor.pickSuggestion}
            onRemoveEntry={editor.removeEntry}
          />
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          variant="filled"
          onClick={editor.save}
          disabled={!editor.hasChanges || editor.isSaving}
        >
          {editor.isSaving ? "Saving..." : "Save Changes"}
        </Button>
        {editor.hasChanges && (
          <>
            <Button variant="ghost" onClick={editor.discard}>
              Discard
            </Button>
            <span className="text-sm text-surface-400">Unsaved changes</span>
          </>
        )}
      </div>
    </div>
  );
}
