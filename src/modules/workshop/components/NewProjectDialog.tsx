import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { Button, Dialog, Field, IconButton, Select, useToast } from "@/components";
import { useAppForm } from "@/lib/form";
import { useSettings } from "@/modules/settings";
import { useWorkshopDialogsStore } from "@/stores";
import { toSlug } from "@/utils";

import { useCreateProject } from "../api/useCreateProject";
import { useSetProjectThumbnail } from "../api/useSetProjectThumbnail";

const projectSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  name: z
    .string()
    .min(1, "Project name is required")
    .regex(/^[a-z0-9-]+$/, "Must be lowercase letters, numbers, and hyphens only")
    .refine(
      (val) => !val.startsWith("-") && !val.endsWith("-"),
      "Cannot start or end with a hyphen",
    ),
  description: z.string(),
  authorName: z.string(),
});

const CUSTOM_AUTHOR = "__custom__";

export function NewProjectDialog() {
  const dialogOpen = useWorkshopDialogsStore((s) => s.newProjectOpen);
  const closeDialog = useWorkshopDialogsStore((s) => s.closeNewProjectDialog);
  const lastAuthorName = useWorkshopDialogsStore((s) => s.lastAuthorName);
  const setLastAuthorName = useWorkshopDialogsStore((s) => s.setLastAuthorName);

  const { data: settings } = useSettings();
  const profiles = settings?.authorProfiles ?? [];
  const defaultProfile = profiles.find((p) => p.id === settings?.defaultAuthorProfileId);

  const createProject = useCreateProject();
  const setThumbnail = useSetProjectThumbnail();
  const toast = useToast();

  const slugManuallyEdited = useRef(false);
  const [selectedThumbnailPath, setSelectedThumbnailPath] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    defaultProfile?.id ?? CUSTOM_AUTHOR,
  );

  const initialAuthor = defaultProfile?.name ?? lastAuthorName;

  const form = useAppForm({
    defaultValues: {
      displayName: "",
      name: "",
      description: "",
      authorName: initialAuthor,
    },
    validators: {
      onChange: projectSchema,
    },
    onSubmit: ({ value }) => {
      createProject.mutate(
        {
          name: value.name,
          displayName: value.displayName,
          description: value.description,
          authors: value.authorName ? [value.authorName] : [],
        },
        {
          onSuccess: (project) => {
            setLastAuthorName(value.authorName);

            if (selectedThumbnailPath) {
              setThumbnail.mutate(
                { projectPath: project.path, imagePath: selectedThumbnailPath },
                {
                  onError: (err) =>
                    toast.error("Project created, but thumbnail failed", err.message),
                },
              );
            }

            handleClose();
          },
          onError: (err) => {
            toast.error("Failed to create project", err.message);
          },
        },
      );
    },
  });

  function handleClose() {
    form.reset();
    slugManuallyEdited.current = false;
    setSelectedThumbnailPath(null);
    setSelectedProfileId(defaultProfile?.id ?? CUSTOM_AUTHOR);
    closeDialog();
  }

  function handleProfileChange(profileId: string) {
    setSelectedProfileId(profileId);
    if (profileId === CUSTOM_AUTHOR) {
      form.setFieldValue("authorName", "");
      return;
    }
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) {
      form.setFieldValue("authorName", profile.name);
    }
  }

  async function handlePickThumbnail() {
    const file = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["webp", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "ico"],
        },
      ],
    });
    if (file) {
      setSelectedThumbnailPath(file);
    }
  }

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="xl" className="max-w-2xl">
          <Dialog.Header>
            <Dialog.Title>New Project</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <Dialog.Body>
              <div className="flex gap-6">
                {/* Thumbnail area */}
                <div className="flex w-52 shrink-0 flex-col gap-2">
                  {selectedThumbnailPath ? (
                    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-surface-600">
                      <img
                        src={convertFileSrc(selectedThumbnailPath)}
                        alt="Thumbnail preview"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <IconButton
                        size="sm"
                        variant="filled"
                        icon={<X className="h-3.5 w-3.5" />}
                        className="absolute top-2 right-2 bg-surface-900/70 hover:bg-surface-900"
                        onClick={() => setSelectedThumbnailPath(null)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePickThumbnail}
                      className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-surface-600 bg-surface-700/30 transition-colors hover:border-accent-hover hover:bg-surface-700/50"
                    >
                      <ImagePlus className="h-8 w-8 text-surface-400" />
                      <span className="text-xs text-surface-400">Add Thumbnail</span>
                    </button>
                  )}
                  <span className="text-center text-xs text-surface-500">16:9 recommended</span>
                </div>

                {/* Form fields */}
                <div className="min-w-0 flex-1 space-y-4">
                  <form.AppField
                    name="displayName"
                    listeners={{
                      onChange: ({ value }) => {
                        if (!slugManuallyEdited.current) {
                          form.setFieldValue("name", toSlug(value));
                        }
                      },
                    }}
                  >
                    {(field) => (
                      <field.TextField
                        label="Display Name"
                        required
                        placeholder="My Awesome Mod"
                        autoFocus
                      />
                    )}
                  </form.AppField>

                  <form.AppField
                    name="name"
                    listeners={{
                      onChange: ({ value }) => {
                        const derived = toSlug(form.getFieldValue("displayName"));
                        if (value !== derived) {
                          slugManuallyEdited.current = true;
                        }
                      },
                    }}
                  >
                    {(field) => (
                      <Field.Root>
                        <Field.Label>
                          <span className="text-xs text-surface-400">Project Slug</span>
                        </Field.Label>
                        <Field.Control
                          value={field.state.value}
                          onChange={(e) => {
                            field.handleChange(e.target.value.toLowerCase());
                          }}
                          onBlur={field.handleBlur}
                          hasError={field.state.meta.errors.length > 0}
                          placeholder="my-awesome-mod"
                          className="text-sm text-surface-300"
                        />
                        <Field.Description>
                          <span className="text-xs">
                            Lowercase letters, numbers, and hyphens. This will be the folder name.
                          </span>
                        </Field.Description>
                        {field.state.meta.errors.length > 0 && (
                          <Field.Error>{field.state.meta.errors.join(", ")}</Field.Error>
                        )}
                      </Field.Root>
                    )}
                  </form.AppField>

                  {profiles.length > 0 && (
                    <Field.Root>
                      <Field.Label>Author Profile</Field.Label>
                      <Select.Root
                        value={selectedProfileId}
                        onValueChange={(val) => handleProfileChange(val ?? CUSTOM_AUTHOR)}
                      >
                        <Select.Trigger>
                          <Select.Value>
                            {selectedProfileId === CUSTOM_AUTHOR
                              ? "Custom..."
                              : (() => {
                                  const p = profiles.find((pr) => pr.id === selectedProfileId);
                                  if (!p) return "Select profile";
                                  return p.name || "Unnamed";
                                })()}
                          </Select.Value>
                          <Select.Icon />
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Positioner>
                            <Select.Popup>
                              {profiles.map((p) => (
                                <Select.Item key={p.id} value={p.id}>
                                  {p.name || "Unnamed"}
                                  {p.role ? ` — ${p.role}` : ""}
                                </Select.Item>
                              ))}
                              <Select.Separator />
                              <Select.Item value={CUSTOM_AUTHOR}>Custom...</Select.Item>
                            </Select.Popup>
                          </Select.Positioner>
                        </Select.Portal>
                      </Select.Root>
                    </Field.Root>
                  )}

                  {(profiles.length === 0 || selectedProfileId === CUSTOM_AUTHOR) && (
                    <form.AppField name="authorName">
                      {(field) => <field.TextField label="Author" placeholder="Your name" />}
                    </form.AppField>
                  )}

                  <form.AppField name="description">
                    {(field) => (
                      <field.TextareaField
                        label="Description"
                        placeholder="A brief description of your mod..."
                        rows={3}
                        className="[&_textarea]:resize-none"
                      />
                    )}
                  </form.AppField>
                </div>
              </div>
            </Dialog.Body>

            <Dialog.Footer>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <form.Subscribe
                selector={(state) => ({ canSubmit: state.canSubmit, isValid: state.isValid })}
              >
                {({ canSubmit, isValid }) => (
                  <Button
                    variant="filled"
                    loading={createProject.isPending}
                    disabled={!canSubmit || !isValid}
                    onClick={() => form.handleSubmit()}
                  >
                    Create Project
                  </Button>
                )}
              </form.Subscribe>
            </Dialog.Footer>
          </form>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
