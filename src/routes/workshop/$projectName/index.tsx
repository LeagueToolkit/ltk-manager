import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Info, Package, Save } from "lucide-react";
import { useState } from "react";

import { Button, Field, SectionCard, Tooltip, useToast } from "@/components";
import { useAppForm } from "@/lib/form";
import type { WorkshopAuthor } from "@/lib/tauri";
import { useSettings } from "@/modules/settings";
import {
  appendAuthor,
  AuthorsSection,
  CategorizationSection,
  filterEmptyAuthors,
  parseChampionsText,
  ProjectInfoSection,
  removeAuthorAt,
  ThumbnailSection,
  updateAuthorAt,
  useProjectContext,
  useSaveProjectConfig,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/$projectName/")({
  component: ProjectOverview,
});

function ProjectOverview() {
  const project = useProjectContext();
  const navigate = useNavigate();
  const saveConfig = useSaveProjectConfig();
  const { data: settings } = useSettings();
  const toast = useToast();

  const [authors, setAuthors] = useState<WorkshopAuthor[]>(
    project.authors.length > 0 ? project.authors : [{ name: "", role: "" }],
  );

  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set(project.tags));
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(() => new Set(project.maps));
  const [championsText, setChampionsText] = useState(() => project.champions.join(", "));

  const form = useAppForm({
    defaultValues: {
      displayName: project.displayName,
      version: project.version,
      description: project.description,
    },
    onSubmit: ({ value }) => {
      saveConfig.mutate(
        {
          projectPath: project.path,
          displayName: value.displayName,
          version: value.version,
          description: value.description,
          authors: filterEmptyAuthors(authors),
          tags: [...selectedTags],
          champions: parseChampionsText(championsText),
          maps: [...selectedMaps],
        },
        {
          onSuccess: () => toast.success("Project configuration saved"),
          onError: (err) => toast.error(`Failed to save: ${err.message}`),
        },
      );
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 pb-20">
      <SectionCard title="Mod Details" icon={<Package className="h-4 w-4" />}>
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
              validators={{
                onChange: ({ value }) => {
                  if (!value) return "Version is required";
                  if (
                    !/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?(\+[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/.test(
                      value,
                    )
                  ) {
                    return "Must be a valid version (e.g. 1.0.0)";
                  }
                  return undefined;
                },
              }}
            >
              {(field) => {
                const hasError = field.state.meta.errors.length > 0;
                return (
                  <Field.Root>
                    <Field.Label required>
                      <span className="inline-flex items-center gap-1.5">
                        Version
                        <Tooltip
                          content={
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
                          }
                          side="right"
                          sideOffset={6}
                        >
                          <Info className="h-3.5 w-3.5 cursor-help text-surface-400" />
                        </Tooltip>
                      </span>
                    </Field.Label>
                    <Field.Description>MAJOR.MINOR.PATCH (e.g. 1.0.0)</Field.Description>
                    <Field.Control
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      hasError={hasError}
                      placeholder="1.0.0"
                    />
                    {hasError && <Field.Error>{field.state.meta.errors.join(", ")}</Field.Error>}
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CategorizationSection
          selectedTags={selectedTags}
          onTagsChange={setSelectedTags}
          selectedMaps={selectedMaps}
          onMapsChange={setSelectedMaps}
          championsText={championsText}
          onChampionsChange={setChampionsText}
        />

        <AuthorsSection
          authors={authors}
          authorProfiles={settings?.authorProfiles}
          onAdd={(initial) => setAuthors((prev) => appendAuthor(prev, initial))}
          onRemove={(i) => setAuthors((prev) => removeAuthorAt(prev, i))}
          onUpdate={(i, field, value) =>
            setAuthors((prev) => updateAuthorAt(prev, i, field, value))
          }
        />
      </div>

      <ProjectInfoSection
        project={project}
        onRenamed={(newName) =>
          navigate({ to: "/workshop/$projectName", params: { projectName: newName } })
        }
      />

      <div className="fixed right-0 bottom-0 left-0 z-10 border-t border-surface-700 bg-surface-900/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-end px-6 py-3">
          <Button
            variant="filled"
            left={<Save className="h-4 w-4" />}
            onClick={() => form.handleSubmit()}
            loading={saveConfig.isPending}
          >
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
