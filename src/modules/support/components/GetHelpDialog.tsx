import { save } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useState } from "react";

import {
  Button,
  Checkbox,
  Dialog,
  ErrorState,
  Grid,
  Inline,
  OVERLINE,
  SegmentedControl,
  SelectField,
  Spinner,
  Stack,
  TextareaField,
  useToast,
} from "@/components";
import { useDebouncedValue } from "@/hooks";
import { m } from "@/i18n";
import type { Incident, ReportPreview, ReportProblem, ReportRequest } from "@/lib/tauri";
import { useIncidents, useIncidentToken, verdictTitle } from "@/modules/diagnostics";
import { useInstalledMods } from "@/modules/library";
import { useAppInfo, useSettings } from "@/modules/settings";
import { useDialog } from "@/stores/createDialogStore";
import { formatBytes } from "@/utils/formatBytes";

import { useSaveSupportReport, useSupportReport } from "../api";
import { useGetHelpDialog } from "../state/getHelp";
import { bugReportUrl } from "../utils/issueUrl";
import { groupReportFiles, type ReportGroupId } from "../utils/reportGroups";
import { ReportPreviewDialog } from "./ReportPreviewDialog";

/** The value of the mod picker for a report that is about no mod in particular. */
const NO_MOD = "";

/** How long the description rests before the report is built again. */
const TEXT_DEBOUNCE_MS = 500;

const PROBLEMS: readonly ReportProblem[] = ["mod-not-shown", "game-crashed", "manager"];

function problemLabel(problem: ReportProblem): string {
  switch (problem) {
    case "mod-not-shown":
      return m.support_problem_mod_label();
    case "game-crashed":
      return m.support_problem_game_label();
    case "manager":
      return m.support_problem_manager_label();
  }
}

function groupLabel(id: ReportGroupId, incidents: number): string {
  switch (id) {
    case "summary":
      return m.support_holds_summary_label();
    case "log":
      return m.support_holds_log_label();
    case "incidents":
      return m.support_holds_incidents_label({ count: incidents });
    case "system":
      return m.support_holds_system_label();
    case "gameLog":
      return m.support_holds_game_log_label();
  }
}

/**
 * The `Get help` dialog: what went wrong, what the report holds, and the two ways to send it.
 *
 * The form mounts only while the dialog is open, so each opening starts from an empty form.
 */
export function GetHelpDialog() {
  const { isOpen, close } = useDialog(useGetHelpDialog);

  if (!isOpen) return null;

  return <GetHelpForm onClose={close} />;
}

function GetHelpForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data: mods = [] } = useInstalledMods();
  const { data: incidents = [] } = useIncidents();
  const { data: appInfo } = useAppInfo();
  const { data: settings } = useSettings();
  const newestIncident = incidents[0] ?? null;
  const gameLogOffered = Boolean(newestIncident?.game?.logPath) && settings?.readGameLog === true;
  const token = useIncidentToken(newestIncident?.id ?? null);

  const [problem, setProblem] = useState<ReportProblem>("mod-not-shown");
  const [modId, setModId] = useState(NO_MOD);
  const [text, setText] = useState("");
  const [includeGameLog, setIncludeGameLog] = useState(true);
  const [previewing, setPreviewing] = useState(false);

  const restedText = useDebouncedValue(text, TEXT_DEBOUNCE_MS);
  const aboutMod = problem === "mod-not-shown";
  const modName = mods.find((mod) => mod.id === modId)?.displayName ?? null;
  const request: ReportRequest = {
    description: { problem, modName: aboutMod ? modName : null, text: restedText },
    includeGameLog,
  };

  const report = useSupportReport(request);
  const saveReport = useSaveSupportReport();
  const building = report.isFetching || text !== restedText;
  const busy = building || saveReport.isPending;
  const preview = report.data;

  async function handleSave(built: ReportPreview) {
    const destination = await save({
      title: m.support_save_dialog_title(),
      defaultPath: built.fileName,
      filters: [{ name: m.support_save_filter_label(), extensions: ["zip"] }],
    });

    if (destination === null) return;

    saveReport.mutate(
      { id: built.id, destination },
      { onSuccess: (path) => toast.success(m.support_save_done_title(), path) },
    );
  }

  function handleCopy(built: ReportPreview) {
    saveReport.mutate(
      { id: built.id, destination: null },
      {
        onSuccess: () => {
          navigator.clipboard.writeText(built.summary).then(
            () =>
              toast.success(
                m.support_copy_done_title(),
                m.support_copy_done_hint({ file: built.fileName }),
              ),
            () => toast.error(m.support_copy_failed_title()),
          );
        },
      },
    );
  }

  const modOptions = [
    { value: NO_MOD, label: m.support_mod_empty() },
    ...mods.map((mod) => ({ value: mod.id, label: mod.displayName })),
  ];

  return (
    <Dialog.Shell
      open
      onClose={onClose}
      title={m.support_dialog_title()}
      description={m.support_dialog_description()}
      size="lg"
      data-ui="GetHelpDialog"
    >
      <Dialog.Body>
        <Stack gap={1.5}>
          <span className="text-sm font-medium text-surface-200">{m.support_problem_label()}</span>
          <SegmentedControl
            className="w-full"
            aria-label={m.support_problem_label()}
            options={PROBLEMS.map((option) => ({ value: option, label: problemLabel(option) }))}
            value={problem}
            onChange={setProblem}
          />
        </Stack>

        {aboutMod && (
          <SelectField
            label={m.support_mod_label()}
            options={modOptions}
            value={modId}
            onValueChange={(value) => setModId(value ?? NO_MOD)}
          />
        )}

        <TextareaField
          label={m.support_text_label()}
          placeholder={m.support_text_placeholder()}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        <Found incident={newestIncident} />

        <Stack gap={2}>
          <Inline justify="between" align="center">
            <span className={OVERLINE}>{m.support_holds_label()}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!preview || building}
              onClick={() => setPreviewing(true)}
            >
              {m.support_preview_action()}
            </Button>
          </Inline>

          {report.error && !preview && (
            <ErrorState error={report.error} title={m.support_build_failed_title()} />
          )}
          {!preview && !report.error && <Spinner size={16} />}
          {preview && (
            <ReportContents
              preview={preview}
              gameLogOffered={gameLogOffered}
              includeGameLog={includeGameLog}
              onIncludeGameLog={setIncludeGameLog}
            />
          )}
        </Stack>
      </Dialog.Body>

      <Dialog.Footer className="justify-between">
        <Button
          variant="ghost"
          onClick={() => void openUrl(bugReportUrl(appInfo, token.data ?? null))}
        >
          {m.support_issue_action()}
        </Button>
        <Inline gap={3}>
          <Button disabled={!preview || busy} onClick={() => preview && void handleSave(preview)}>
            {m.support_save_action()}
          </Button>
          <Button
            variant="filled"
            tone="accent"
            loading={saveReport.isPending}
            disabled={!preview || busy}
            onClick={() => preview && handleCopy(preview)}
          >
            {m.support_copy_action()}
          </Button>
        </Inline>
      </Dialog.Footer>

      {preview && (
        <ReportPreviewDialog
          open={previewing}
          onClose={() => setPreviewing(false)}
          files={preview.files}
        />
      )}
    </Dialog.Shell>
  );
}

/** The verdict of the newest incident, which is what the report rests on. */
function Found({ incident }: { incident: Incident | null }) {
  return (
    <Stack gap={1.5}>
      <span className={OVERLINE}>{m.support_found_label()}</span>
      {!incident && <p className="text-sm text-surface-400">{m.support_found_empty()}</p>}
      {incident && (
        <div
          data-ui="GetHelpDialog:found"
          className="rounded-md border border-surface-700/50 bg-surface-900 px-3 py-2"
        >
          <p className="text-sm font-medium text-surface-100">{verdictTitle(incident)}</p>
          <p className="text-sm text-surface-300 select-text">{incident.verdict.cause}</p>
        </div>
      )}
    </Stack>
  );
}

interface ReportContentsProps {
  preview: ReportPreview;
  /** Whether the newest incident names a game log, so that the checkbox has a subject. */
  gameLogOffered: boolean;
  includeGameLog: boolean;
  onIncludeGameLog: (include: boolean) => void;
}

/** The file groups of the report with their sizes, and the count of what was replaced. */
function ReportContents({
  preview,
  gameLogOffered,
  includeGameLog,
  onIncludeGameLog,
}: ReportContentsProps) {
  const groups = groupReportFiles(preview.files).filter((group) => group.id !== "gameLog");
  const gameLog = preview.files.find((file) => file.path.startsWith("game-log/"));
  const { paths, links, addresses, other } = preview.replaced;
  const replacedAny = paths + links + addresses + other > 0;

  return (
    <Stack gap={2}>
      <Grid columns="minmax(0, 1fr) max-content" gap={3} rowGap={1}>
        {groups.map((group) => (
          <ContentsRow
            key={group.id}
            label={groupLabel(group.id, group.incidents)}
            bytes={group.bytes}
          />
        ))}
        {gameLogOffered && (
          <>
            <Checkbox
              size="sm"
              label={m.support_holds_game_log_label()}
              checked={includeGameLog}
              onCheckedChange={(checked) => onIncludeGameLog(checked === true)}
            />
            <span className="text-sm text-surface-400 tabular-nums">
              {gameLog && formatBytes(gameLog.bytes)}
            </span>
          </>
        )}
      </Grid>

      <p className="text-sm text-surface-400">
        {replacedAny && m.support_replaced_description({ paths, links, addresses, other })}
        {!replacedAny && m.support_replaced_empty()} {m.support_privacy_hint()}
      </p>
    </Stack>
  );
}

function ContentsRow({ label, bytes }: { label: string; bytes: number }) {
  return (
    <>
      <span className="text-sm text-surface-200">{label}</span>
      <span className="text-right text-sm text-surface-400 tabular-nums">{formatBytes(bytes)}</span>
    </>
  );
}
