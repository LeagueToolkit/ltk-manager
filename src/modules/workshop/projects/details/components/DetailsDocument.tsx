import { InfoIcon, PackageIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Button, Code, Field, SectionCard, Tooltip, useToast } from "@/components";
import { errorMessage, m, Marked } from "@/i18n";
import { DocumentToolbar, type EditorDocumentProps, useDocumentSave } from "@/modules/editor";
import { useSettings } from "@/modules/settings";

import { projectTextDocument } from "../../../documents/utils/contentDocument";
import type { ContentDocumentOf } from "../../../documents/utils/contentDocument";
import { DETAILS_DOCUMENT_ID } from "../../../documents/utils/contentDocument";
import { useOpenDocument } from "../../../state";
import { useMoveProjectDocuments, useSetDocumentDirty } from "../../../state";
import { useProjectContext } from "../../state/ProjectContext";
import { useProjectDetails, validateVersion } from "../hooks/useProjectDetails";
import { AuthorsSection } from "./AuthorsSection";
import { CategorizationSection } from "./CategorizationSection";
import { ProjectInfoSection } from "./ProjectInfoSection";
import { ThumbnailSection } from "./ThumbnailSection";

/** The project's own metadata: what the mod is called, who made it, what it applies to. */
export function DetailsDocument({ active }: EditorDocumentProps<ContentDocumentOf<"details">>) {
  const project = useProjectContext();
  const navigate = useNavigate();
  const editor = useProjectDetails(project);
  const setDocumentDirty = useSetDocumentDirty();
  const moveDocuments = useMoveProjectDocuments();
  const toast = useToast();

  const { data: settings } = useSettings();
  const { form, hasChanges } = editor;

  useEffect(() => {
    setDocumentDirty(DETAILS_DOCUMENT_ID, hasChanges);
  }, [hasChanges, setDocumentDirty]);

  useEffect(() => {
    return () => setDocumentDirty(DETAILS_DOCUMENT_ID, false);
  }, [setDocumentDirty]);

  /* This is the one document that holds its edits until it is asked, so it is
     the one the close dialog offers a save for. */
  useDocumentSave(DETAILS_DOCUMENT_ID, editor.save);

  /** Write, and say what the write did. What the button and `Ctrl+S` ask for. */
  function reportSave() {
    editor.save().then(
      () => toast.success(m.workshop_details_saved_hint()),
      (error: unknown) =>
        toast.error(m.workshop_details_save_failed_hint({ reason: errorMessage(error) })),
    );
  }

  const save = useRef(reportSave);
  useEffect(() => {
    save.current = reportSave;
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
      <DocumentToolbar active={active}>
        {hasChanges && (
          <Button variant="ghost" size="xs" compact onClick={editor.discard}>
            {m.workshop_details_discard_action()}
          </Button>
        )}
        <Button
          variant="filled"
          size="xs"
          compact
          onClick={reportSave}
          disabled={!hasChanges || !editor.canSave}
          loading={editor.isSaving}
        >
          {m.common_save_action()}
        </Button>
      </DocumentToolbar>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-5">
          <SectionCard
            title={m.workshop_details_identity_title()}
            icon={<PackageIcon className="h-4 w-4" />}
            panelClassName="bg-surface-800"
          >
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
              <ThumbnailSection project={project} />

              <div className="min-w-0 flex-1 space-y-4">
                <form.AppField name="displayName">
                  {(field) => (
                    <field.TextField
                      label={m.workshop_details_display_name_label()}
                      required
                      placeholder={m.workshop_details_display_name_placeholder()}
                    />
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
                            {m.workshop_details_version_label()}
                            <Tooltip content={<VersionHint />} side="right" sideOffset={6}>
                              <InfoIcon className="h-3.5 w-3.5 cursor-help text-surface-400" />
                            </Tooltip>
                          </span>
                        </Field.Label>
                        <Field.Description>
                          {m.workshop_details_version_description()}
                        </Field.Description>
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
                      label={m.workshop_details_description_label()}
                      placeholder={m.workshop_details_description_placeholder()}
                      rows={3}
                    />
                  )}
                </form.AppField>

                <ReadmeLink />
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
              navigate({ to: "/workshop/$projectId", params: { projectId: renamed.id } });
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
      <p className="font-medium">{m.workshop_details_semver_title()}</p>
      <p>
        <Marked text={m.workshop_details_semver_format_hint()}>
          {(clause) => <code className="text-accent-400">{clause}</code>}
        </Marked>
      </p>
      <ul className="list-inside list-disc space-y-0.5 text-surface-300">
        <li>{m.workshop_details_semver_major_hint()}</li>
        <li>{m.workshop_details_semver_minor_hint()}</li>
        <li>{m.workshop_details_semver_patch_hint()}</li>
      </ul>
      <p className="text-surface-400">
        <Marked text={m.workshop_details_semver_prerelease_hint()}>
          {(clause) => <code>{clause}</code>}
        </Marked>
      </p>
    </div>
  );
}

/**
 * Where the long description lives, beside the one line that is not it.
 *
 * The project row opens the same document. A creator filling in the blurb is
 * the one who has not met it yet.
 */
function ReadmeLink() {
  const openDocument = useOpenDocument();

  return (
    <p className="flex items-center gap-1.5 text-meta text-surface-400">
      <Marked text={m.workshop_readme_details_hint()}>{(clause) => <Code>{clause}</Code>}</Marked>
      <Button
        variant="ghost"
        size="xs"
        compact
        onClick={() => openDocument(projectTextDocument("readme"))}
      >
        {m.workshop_readme_open_action()}
      </Button>
    </p>
  );
}
