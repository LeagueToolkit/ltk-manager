import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Package, Save } from "lucide-react";
import { useState } from "react";

import { Button, SectionCard, useToast } from "@/components";
import { useAppForm } from "@/lib/form";
import type { WorkshopAuthor } from "@/lib/tauri";
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
    <div className="mx-auto max-w-4xl space-y-5 pb-20">
      <SectionCard title="Mod Details" icon={<Package className="h-4 w-4" />}>
        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          <ThumbnailSection project={project} />

          <div className="min-w-0 flex-1 space-y-4">
            <form.AppField name="displayName">
              {(field) => (
                <field.TextField label="Display Name" required placeholder="My Awesome Mod" />
              )}
            </form.AppField>

            <form.AppField name="version">
              {(field) => <field.TextField label="Version" required placeholder="1.0.0" />}
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
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        selectedMaps={selectedMaps}
        onMapsChange={setSelectedMaps}
        championsText={championsText}
        onChampionsChange={setChampionsText}
      />

      <AuthorsSection
        authors={authors}
        onAdd={() => setAuthors(appendAuthor)}
        onRemove={(i) => setAuthors((prev) => removeAuthorAt(prev, i))}
        onUpdate={(i, field, value) => setAuthors((prev) => updateAuthorAt(prev, i, field, value))}
      />

      <ProjectInfoSection
        project={project}
        onRenamed={(newName) =>
          navigate({ to: "/workshop/$projectName", params: { projectName: newName } })
        }
      />

      <div className="fixed right-0 bottom-0 left-0 z-10 border-t border-surface-700 bg-surface-900/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-end px-6 py-3">
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
