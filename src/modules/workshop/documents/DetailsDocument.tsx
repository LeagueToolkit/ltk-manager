import { InfoIcon, PackageIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Button, Field, PlayerTitleIcon, SectionCard, Tooltip } from "@/components";
import type { EditorDocumentProps } from "@/modules/editor";
import { useSettings } from "@/modules/settings";

import { AuthorsSection } from "../components/overview/AuthorsSection";
import { CategorizationSection } from "../components/overview/CategorizationSection";
import { ProjectInfoSection } from "../components/overview/ProjectInfoSection";
import { ThumbnailSection } from "../components/overview/ThumbnailSection";
import { useProjectContext } from "../components/ProjectContext";
import { useMoveProjectDocuments, useSetDocumentDirty } from "../state";
import type { ContentDocumentOf } from "./contentDocument";
import { DETAILS_DOCUMENT_ID } from "./contentDocument";
import { useProjectDetails, validateVersion } from "./useProjectDetails";

/** The project's own metadata: what the mod is called, who made it, what it applies to. */
export function DetailsDocument({ active }: EditorDocumentProps<ContentDocumentOf<"details">>) {
  const project = useProjectContext();
  const navigate = useNavigate();
  const editor = useProjectDetails(project);
  const setDocumentDirty = useSetDocumentDirty();
  const moveDocuments = useMoveProjectDocuments();

  const { data: settings } = useSettings();
  const { form, hasChanges } = editor;

  useEffect(() => {
    setDocumentDirty(DETAILS_DOCUMENT_ID, hasChanges);
  }, [hasChanges, setDocumentDirty]);

  useEffect(() => {
    return () => setDocumentDirty(DETAILS_DOCUMENT_ID, false);
  }, [setDocumentDirty]);

  const save = useRef(editor.save);
  useEffect(() => {
    save.current = editor.save;
  });

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() !== "s") return;

      event.preventDefault();
      save.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  return (
    <div data-ui="DetailsDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <div
        data-ui="DetailsDocument:band"
        className="flex min-h-9 items-center justify-between gap-3 border-surface-700/50 pr-1.5 pl-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <PlayerTitleIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
          <span className="text-sm font-medium text-surface-200">Mod details</span>
          <span className="truncate font-mono text-xs text-surface-400">{project.name}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasChanges && (
            <Button variant="ghost" size="sm" compact onClick={editor.discard}>
              Discard
            </Button>
          )}
          <Button
            variant="filled"
            size="sm"
            compact
            onClick={editor.save}
            disabled={!hasChanges || !editor.canSave}
            loading={editor.isSaving}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-5">
          <SectionCard
            title="Identity"
            icon={<PackageIcon className="h-4 w-4" />}
            panelClassName="bg-surface-800"
          >
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
              <ThumbnailSection project={project} />

              <div className="min-w-0 flex-1 space-y-4">
                <form.AppField name="displayName">
                  {(field) => (
                    <field.TextField label="Display Name" required placeholder="My Awesome Mod" />
                  )}
                </form.AppField>

                <form.AppField
                  name="version"
                  validators={{ onChange: ({ value }) => validateVersion(value) }}
                >
                  {(field) => {
                    const hasError = field.state.meta.errors.length > 0;
                    return (
                      <Field.Root>
                        <Field.Label required>
                          <span className="inline-flex items-center gap-1.5">
                            Version
                            <Tooltip content={<VersionHint />} side="right" sideOffset={6}>
                              <InfoIcon className="h-3.5 w-3.5 cursor-help text-surface-400" />
                            </Tooltip>
                          </span>
                        </Field.Label>
                        <Field.Description>MAJOR.MINOR.PATCH (e.g. 1.0.0)</Field.Description>
                        <Field.Control
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                          hasError={hasError}
                          placeholder="1.0.0"
                        />
                        {hasError && (
                          <Field.Error>{field.state.meta.errors.join(", ")}</Field.Error>
                        )}
                      </Field.Root>
                    );
                  }}
                </form.AppField>

                <form.AppField name="description">
                  {(field) => (
                    <field.TextareaField
                      label="Description"
                      placeholder="A brief description of your mod..."
                      rows={3}
                    />
                  )}
                </form.AppField>
              </div>
            </div>
          </SectionCard>

          <CategorizationSection
            selectedTags={editor.tags}
            onTagsChange={editor.setTags}
            selectedMaps={editor.maps}
            onMapsChange={editor.setMaps}
            championsText={editor.championsText}
            onChampionsChange={editor.setChampionsText}
          />

          <AuthorsSection
            authors={editor.authors}
            authorProfiles={settings?.authorProfiles}
            onAdd={editor.addAuthor}
            onRemove={editor.removeAuthor}
            onUpdate={editor.updateAuthor}
          />

          <ProjectInfoSection
            project={project}
            onRenamed={(renamed) => {
              /* The store files open documents under the project path, which a
                 rename moves. Re-key first, or the open tabs go with it. */
              moveDocuments(renamed.path);
              navigate({ to: "/workshop/$projectName", params: { projectName: renamed.name } });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function VersionHint() {
  return (
    <div className="max-w-56 space-y-1.5 py-1">
      <p className="font-medium">Semantic Versioning</p>
      <p>
        Format: <code className="text-accent-400">MAJOR.MINOR.PATCH</code>
      </p>
      <ul className="list-inside list-disc space-y-0.5 text-surface-300">
        <li>MAJOR - breaking changes</li>
        <li>MINOR - new features</li>
        <li>PATCH - bug fixes</li>
      </ul>
      <p className="text-surface-400">
        Pre-release: <code>1.0.0-beta.1</code>
      </p>
    </div>
  );
}
