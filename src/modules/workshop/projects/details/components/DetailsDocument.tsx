import { InfoIcon, PackageIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { Button, Code, Field, SectionCard, Tooltip, useToast } from "@/components";
import { errorMessage, m, Marked } from "@/i18n";
import { DocumentToolbar, type EditorDocumentProps, useDocumentSave } from "@/modules/editor";
import { useSettings } from "@/modules/settings";

import { projectTextDocument } from "../../../documents/utils/contentDocument";
import type { ContentDocumentOf } from "../../../documents/utils/contentDocument";
import { DETAILS_DOCUMENT_ID } from "../../../documents/utils/contentDocument";
import { DocumentFrame } from "../../../shared/components/DocumentFrame";
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

  /* This is the one document that holds its edits until it is asked, so it is the one the close
     dialog offers a save for. `editor.save` reaches it through the same write and confirms it,
     and the editor reports a failure. */
  const { save } = editor;
  const saveAndConfirm = useCallback(
    () =>
      save().then(() => {
        toast.success(m.workshop_details_saved_hint());
      }),
    [save, toast],
  );
  useDocumentSave(DETAILS_DOCUMENT_ID, saveAndConfirm);

  /** Write, and say what the write did. What the button asks for. */
  function reportSave() {
    save().then(
      () => toast.success(m.workshop_details_saved_hint()),
      (error: unknown) =>
        toast.error(m.workshop_details_save_failed_hint({ reason: errorMessage(error) })),
    );
  }

  return (
    <DocumentFrame data-ui="DetailsDocument">
      <DocumentToolbar active={active}>
        {hasChanges && (
          <Button variant="ghost" size="xs" onClick={editor.discard}>
            {m.workshop_details_discard_action()}
          </Button>
        )}
        <Button
          variant="filled"
          size="xs"
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
            icon={<PackageIcon className="size-4" />}
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
                              <InfoIcon className="size-3.5 cursor-help text-surface-400" />
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
            champions={editor.champions}
            onChampionsChange={editor.setChampions}
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
    </DocumentFrame>
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
      <Button variant="ghost" size="xs" onClick={() => openDocument(projectTextDocument("readme"))}>
        {m.workshop_readme_open_action()}
      </Button>
    </p>
  );
}
