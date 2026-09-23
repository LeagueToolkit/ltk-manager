import { CheckIcon, FolderOpenIcon, FolderSimpleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { Button, Code, Dialog, RadioGroup } from "@/components";
import { errorSummary, m, Marked } from "@/i18n";
import { useAppForm } from "@/lib/form";
import type { ConvertPlacement, FantomeFolder } from "@/lib/tauri";
import { useSettings } from "@/modules/settings";
import { useDialog } from "@/stores";
import { toSlug } from "@/utils";

import { useConvertFolder } from "../api/projectFolders";
import { useOpenFolder } from "../hooks/useOpenFolder";
import { useConvertFolderDialog } from "../state/dialogs";

const convertSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  displayName: z.string().min(1),
});

/**
 * The offer for a picked folder with no project config.
 *
 * The project name follows the display name until it is edited by hand. Per
 * "Open any folder" in `docs/ux/WORKSHOP.md`.
 */
export function ConvertFolderDialog() {
  const { isOpen, payload, close } = useDialog(useConvertFolderDialog);
  const navigate = useNavigate();
  const convert = useConvertFolder();
  const openFolder = useOpenFolder();
  const { data: settings } = useSettings();
  const [placement, setPlacement] = useState<ConvertPlacement>("inPlace");
  const nameEdited = useRef(false);

  const inspection = payload?.inspection ?? null;
  const layout = inspection?.kind === "fantome" ? inspection.layout : null;
  const canCopy = !!settings?.workshopPath;

  const suggestedName =
    inspection?.kind === "fantome" ? layout?.suggestedName : inspection?.suggestedName;
  const displayName =
    inspection?.kind === "fantome" ? layout?.displayName : inspection?.displayName;

  const form = useAppForm({
    defaultValues: { name: suggestedName ?? "", displayName: displayName ?? "" },
    validators: { onChange: convertSchema },
    onSubmit: ({ value }) => {
      if (!payload) return;

      convert.mutate(
        { path: payload.path, name: value.name, displayName: value.displayName, placement },
        {
          onSuccess: (project) => {
            close();
            void navigate({ to: "/workshop/$projectId", params: { projectId: project.id } });
          },
        },
      );
    },
  });

  useEffect(() => {
    form.reset({ name: suggestedName ?? "", displayName: displayName ?? "" });
    nameEdited.current = false;
    setPlacement("inPlace");
  }, [displayName, form, suggestedName]);

  function handleClose() {
    if (convert.isPending) return;
    convert.reset();
    close();
  }

  function handleChooseAnother() {
    handleClose();
    openFolder.pick();
  }

  const description =
    inspection?.kind === "plain"
      ? m.workshop_folder_convert_plain_description()
      : m.workshop_folder_convert_description();

  const inPlaceDescription =
    inspection?.kind === "plain"
      ? m.workshop_folder_convert_plain_in_place_description()
      : m.workshop_folder_convert_in_place_description();

  return (
    <Dialog.Shell
      open={isOpen}
      onClose={handleClose}
      title={m.workshop_folder_convert_title()}
      size="xl"
      closable={!convert.isPending}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <Dialog.Body className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            {payload && <PickedFolder path={payload.path} />}

            <p className="text-sm text-surface-400">
              <Marked text={description}>{(literal) => <Code>{literal}</Code>}</Marked>
            </p>

            {layout && <FoundFiles layout={layout} />}
          </div>

          <RadioGroup.Root
            value={placement}
            onValueChange={(value: unknown) => setPlacement(value as ConvertPlacement)}
          >
            <RadioGroup.Label>{m.workshop_folder_convert_placement_label()}</RadioGroup.Label>
            <RadioGroup.Options orientation="vertical">
              <RadioGroup.Card
                value="inPlace"
                title={m.workshop_folder_convert_in_place_label()}
                description={inPlaceDescription}
              />
              <RadioGroup.Card
                value="copy"
                disabled={!canCopy}
                title={m.workshop_folder_convert_copy_label()}
                description={
                  canCopy
                    ? m.workshop_folder_convert_copy_description()
                    : m.workshop_folder_convert_copy_disabled_hint()
                }
              />
            </RadioGroup.Options>
          </RadioGroup.Root>

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 items-start gap-3">
              <form.AppField
                name="displayName"
                listeners={{
                  onChange: ({ value }) => {
                    if (!nameEdited.current) form.setFieldValue("name", toSlug(value));
                  },
                }}
              >
                {(field) => (
                  <field.TextField
                    label={m.workshop_folder_convert_display_name_label()}
                    required
                    disabled={convert.isPending}
                  />
                )}
              </form.AppField>

              <form.AppField
                name="name"
                listeners={{
                  onChange: () => {
                    nameEdited.current = true;
                  },
                }}
              >
                {(field) => (
                  <field.TextField
                    label={m.workshop_folder_convert_name_label()}
                    required
                    disabled={convert.isPending}
                    transform={(value) => value.toLowerCase()}
                    inputClassName="font-mono"
                  />
                )}
              </form.AppField>
            </div>
            <p className="text-meta text-surface-500">{m.workshop_folder_convert_name_hint()}</p>
          </div>

          {convert.error && (
            <p className="text-sm text-danger-text select-text">{errorSummary(convert.error)}</p>
          )}
        </Dialog.Body>

        <Dialog.Footer>
          <Button
            variant="ghost"
            className="mr-auto whitespace-nowrap"
            left={<FolderOpenIcon weight="bold" className="h-4 w-4" />}
            onClick={handleChooseAnother}
            disabled={convert.isPending}
          >
            {m.workshop_folder_convert_other_action()}
          </Button>
          <Button
            variant="ghost"
            className="whitespace-nowrap"
            onClick={handleClose}
            disabled={convert.isPending}
          >
            {m.common_cancel_action()}
          </Button>
          <form.Subscribe selector={(state) => state.canSubmit && state.isValid}>
            {(canSubmit) => (
              <Button
                variant="filled"
                type="submit"
                className="whitespace-nowrap"
                loading={convert.isPending}
                disabled={!canSubmit || convert.isPending}
              >
                {placement === "copy"
                  ? m.workshop_folder_convert_copy_action()
                  : m.workshop_folder_convert_in_place_action()}
              </Button>
            )}
          </form.Subscribe>
        </Dialog.Footer>
      </form>
    </Dialog.Shell>
  );
}

/* Truncated from the left, so the folder name at the end of the path stays in view. */
function PickedFolder({ path }: { path: string }) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;

  return (
    <div
      data-ui="ConvertFolderDialog:folder"
      className="flex items-center gap-3 rounded-lg border border-surface-700 bg-surface-950/30 px-3 py-2.5"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-folder/15 text-folder-text">
        <FolderSimpleIcon weight="fill" className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-col select-text">
        <span className="truncate text-sm font-medium text-surface-100">{name}</span>
        <span
          title={path}
          className="truncate text-left font-mono text-xs text-code text-surface-400 [direction:rtl]"
        >
          <bdi>{path}</bdi>
        </span>
      </span>
    </div>
  );
}

/** What the conversion found in a fantome-layout folder, one row per part it moves. */
function FoundFiles({ layout }: { layout: FantomeFolder }) {
  return (
    <ul
      data-ui="ConvertFolderDialog:found"
      className="flex flex-col divide-y divide-surface-700 rounded-lg border border-surface-700 bg-surface-950/30 text-sm"
    >
      {layout.hasInfo && (
        <FoundRow name="META/info.json" hint={m.workshop_folder_convert_info_hint()} />
      )}
      {layout.wads.map((wad) => (
        <FoundRow
          key={wad.name}
          name={`WAD/${wad.name}`}
          hint={
            wad.packed
              ? m.workshop_folder_convert_packed_hint()
              : m.workshop_folder_convert_unpacked_hint()
          }
        />
      ))}
      {layout.hasRaw && <FoundRow name="RAW/" hint={m.workshop_folder_convert_raw_hint()} />}
    </ul>
  );
}

function FoundRow({ name, hint }: { name: string; hint: string }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <CheckIcon weight="bold" className="h-4 w-4 shrink-0 text-success-text" />
      <span className="min-w-0 truncate font-mono text-code text-surface-200 select-text">
        {name}
      </span>
      <span className="ml-auto shrink-0 text-meta text-surface-400">{hint}</span>
    </li>
  );
}
