import {
  DownloadSimpleIcon,
  GlobeIcon,
  ShieldWarningIcon,
  StackIcon,
  UserIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Button, Dialog, Field, Progress, RadioGroup, Spinner, useToast } from "@/components";
import { describeError, m } from "@/i18n";
import type {
  AppError,
  DeepLinkInstallListRequest,
  InstallList,
  InstallListItem,
  InstallListPlan,
  InstallListProgress,
  InstallListReport,
  InstallListStage,
  InstalledMod,
  Settings,
} from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { useActiveProfile, useInstalledMods } from "@/modules/library";
import { useSaveSettings, useSettings } from "@/modules/settings";
import { useQueuedDialog } from "@/stores";

import { installListMutations, installListQueries } from "../api/installList";
import { useProtocolInstallProgress } from "../api/useProtocolInstallProgress";
import { useInstallListStore } from "../state";
import { InstallListRow } from "./InstallListRow";

/** The stages a run leaves an item in. */
const SETTLED: ReadonlySet<InstallListStage> = new Set([
  "installed",
  "updated",
  "alreadyInstalled",
  "failed",
]);

export function InstallListDialog() {
  const request = useInstallListStore((s) => s.request);
  const phase = useInstallListStore((s) => s.phase);
  const reset = useInstallListStore((s) => s.reset);
  const open = useQueuedDialog("install-list", request !== null);

  if (!request || !open) return null;

  /* Keyed on the link, so a second list starts with a clean selection and profile choice. */
  return (
    <InstallListBody
      key={request.url}
      request={request}
      busy={phase === "running"}
      onClose={reset}
    />
  );
}

interface InstallListBodyProps {
  request: DeepLinkInstallListRequest;
  busy: boolean;
  onClose: () => void;
}

function InstallListBody({ request, busy, onClose }: InstallListBodyProps) {
  const phase = useInstallListStore((s) => s.phase);
  const stages = useInstallListStore((s) => s.stages);
  const report = useInstallListStore((s) => s.report);
  const runError = useInstallListStore((s) => s.error);
  const setStage = useInstallListStore((s) => s.setStage);

  const toast = useToast();
  const client = useQueryClient();
  const install = useMutation(installListMutations.install(client));
  const cancel = useMutation(installListMutations.cancel());
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: mods } = useInstalledMods();
  const { data: activeProfile } = useActiveProfile();
  const { progress: bytes } = useProtocolInstallProgress();

  useTauriEvent<InstallListProgress>("install-list-progress", (progress) => {
    setStage(progress.itemId, progress.stage);
  });

  /* Read against the settings as they are rather than the marker the link arrived with, as
     the single install does, so trusting the domain anywhere takes the band down. */
  const untrustedDomain =
    request.untrustedDomain && !(settings?.trustedDomains ?? []).includes(request.untrustedDomain)
      ? request.untrustedDomain
      : null;

  const manifest = useQuery({
    ...installListQueries.manifest(request.url),
    enabled: untrustedDomain === null,
  });
  const list = manifest.data ?? null;
  const source = list?.source ?? request.source ?? hostOf(request.url);

  const current = useMemo(() => currentItems(list, mods ?? [], source), [list, mods, source]);

  /* Selection is kept as what the reader took out, so the list arriving needs no effect. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [profileChoice, setProfileChoice] = useState<"active" | "new">("active");
  const [profileName, setProfileName] = useState<string | null>(null);
  const newProfileName = profileName ?? list?.name ?? "";

  const selectable = list ? list.items.filter((item) => !current.has(item.id)) : [];
  const selected = selectable.filter((item) => !excluded.has(item.id));

  function toggle(item: InstallListItem, checked: boolean) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  function runInstall(items: InstallListItem[], profile: InstallListPlan["profile"]) {
    install.mutate(
      { manifestUrl: request.url, source, items, profile },
      {
        onSuccess: (done) => {
          const summary = summaryOf(done);
          if (done.failed.length === 0) toast.success(m.deep_link_list_complete_title(), summary);
          else toast.info(m.deep_link_list_complete_title(), summary);
        },
      },
    );
  }

  function confirm() {
    const profile: InstallListPlan["profile"] =
      profileChoice === "new" ? { kind: "new", name: newProfileName.trim() } : { kind: "active" };
    runInstall(selected, profile);
  }

  /* The new profile, if one was asked for, exists and is active by now. */
  function retryFailed() {
    if (!list || !report) return;
    const failed = new Set(report.failed.map((failure) => failure.itemId));
    runInstall(
      list.items.filter((item) => failed.has(item.id)),
      { kind: "active" },
    );
  }

  /* The save has to land before the read, because the fetch reads the same allowlist. */
  function trustAndContinue() {
    if (!settings || !untrustedDomain) return;
    const trusted: Settings = {
      ...settings,
      trustedDomains: [...(settings.trustedDomains ?? []), untrustedDomain],
    };
    saveSettings.mutate(trusted);
  }

  function handleClose() {
    if (busy) return;
    onClose();
  }

  const isDone = phase === "done";
  const failure = runError ?? manifest.error ?? null;
  const settledCount = Object.values(stages).filter((stage) => SETTLED.has(stage)).length;
  const runTotal = install.variables?.items.length ?? 0;
  const newProfileInvalid = profileChoice === "new" && newProfileName.trim() === "";

  return (
    <Dialog.Shell
      open
      onClose={handleClose}
      title={title(phase, failure !== null)}
      size="lg"
      closable={!busy}
    >
      <Dialog.Body className="flex flex-col gap-3">
        {untrustedDomain && <UntrustedBand domain={untrustedDomain} />}

        {!untrustedDomain && manifest.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-surface-400">
            <Spinner size={16} />
            {m.deep_link_list_loading_label()}
          </div>
        )}

        {failure && <RunFailure error={failure} />}

        {list && (
          <>
            <ListHeading list={list} source={source} />

            {phase === "idle" && selectable.length === 0 && (
              <p className="text-sm text-surface-400">{m.deep_link_list_empty_description()}</p>
            )}

            {phase === "idle" && selectable.length > 0 && (
              <ProfileChoice
                choice={profileChoice}
                onChoice={setProfileChoice}
                activeName={activeProfile?.name ?? ""}
                newName={newProfileName}
                onNewName={setProfileName}
              />
            )}

            {phase === "idle" && selectable.length > 0 && (
              <div className="flex items-center justify-between text-xs text-surface-400">
                <span>{m.deep_link_list_count_label({ count: selected.length })}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setExcluded(new Set())}>
                    {m.deep_link_list_select_all_action()}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExcluded(new Set(selectable.map((item) => item.id)))}
                  >
                    {m.deep_link_list_select_none_action()}
                  </Button>
                </div>
              </div>
            )}

            {phase !== "idle" && (
              <Progress.Root
                value={settledCount}
                max={Math.max(runTotal, 1)}
                valueLabel={m.deep_link_list_progress_label({
                  done: settledCount,
                  total: runTotal,
                })}
                label={cancel.isSuccess && busy ? m.deep_link_list_stopping_label() : undefined}
              >
                <Progress.Track size="sm">
                  <Progress.Indicator />
                </Progress.Track>
              </Progress.Root>
            )}

            {isDone && report && (
              <p className="text-sm text-surface-300">
                {summaryOf(report)}
                {report.cancelled && ` ${m.deep_link_list_cancelled_description()}`}
              </p>
            )}

            <ul
              data-ui="InstallListDialog:items"
              className="flex max-h-80 flex-col divide-y divide-surface-700 overflow-y-auto rounded-md border border-surface-700"
            >
              {list.items.map((item) => (
                <InstallListRow
                  key={item.id}
                  item={item}
                  isCurrent={current.has(item.id)}
                  checked={!excluded.has(item.id)}
                  choosing={phase === "idle"}
                  stage={stages[item.id] ?? null}
                  bytes={stages[item.id] === "downloading" ? bytes : null}
                  failure={report?.failed.find((f) => f.itemId === item.id)?.error ?? null}
                  onToggle={(checked) => toggle(item, checked)}
                />
              ))}
            </ul>
          </>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        {untrustedDomain && (
          <>
            <Button size="lg" variant="ghost" onClick={handleClose} disabled={busy}>
              {m.deep_link_untrusted_reject_action()}
            </Button>
            <Button
              size="lg"
              variant="filled"
              onClick={trustAndContinue}
              loading={saveSettings.isPending}
            >
              <ShieldWarningIcon weight="bold" className="size-4" />
              {m.deep_link_list_untrusted_trust_action()}
            </Button>
          </>
        )}
        {!untrustedDomain && phase === "idle" && (
          <>
            <Button size="lg" variant="ghost" onClick={handleClose}>
              {m.common_cancel_action()}
            </Button>
            {list && selectable.length > 0 && (
              <Button
                size="lg"
                variant="filled"
                onClick={confirm}
                disabled={selected.length === 0 || newProfileInvalid}
              >
                <DownloadSimpleIcon weight="bold" className="size-4" />
                {m.deep_link_list_install_action({ count: selected.length })}
              </Button>
            )}
          </>
        )}
        {busy && (
          <Button
            size="lg"
            variant="ghost"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending || cancel.isSuccess}
          >
            {m.deep_link_list_stop_action()}
          </Button>
        )}
        {isDone && (
          <>
            {report && report.failed.length > 0 && (
              <Button size="lg" variant="ghost" onClick={retryFailed}>
                {m.deep_link_list_retry_failed_action()}
              </Button>
            )}
            <Button size="lg" variant="filled" onClick={handleClose}>
              {m.deep_link_list_done_action()}
            </Button>
          </>
        )}
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

/** The dialog's own name for where the run has got to. */
function title(phase: "idle" | "running" | "done", failed: boolean): string {
  if (failed) return m.deep_link_list_failed_title();
  if (phase === "running") return m.deep_link_list_running_title();
  if (phase === "done") return m.deep_link_list_complete_title();
  return m.deep_link_list_title();
}

/** The ids of the items the library already holds at the version the list names. */
function currentItems(
  list: InstallList | null,
  mods: InstalledMod[],
  source: string,
): ReadonlySet<string> {
  if (!list) return new Set();
  const held = new Set(
    mods
      .filter((mod) => mod.origin && mod.origin.source === source)
      .map((mod) => `${mod.origin?.id}@${mod.origin?.version ?? ""}`),
  );
  return new Set(
    list.items
      .filter((item) => held.has(`${item.id}@${item.version ?? ""}`))
      .map((item) => item.id),
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function summaryOf(report: InstallListReport): string {
  return m.deep_link_list_summary({
    installed: report.installed.length,
    updated: report.updated.length,
    existing: report.alreadyInstalled.length,
    failed: report.failed.length,
  });
}

function ListHeading({ list, source }: { list: InstallList; source: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-500/15">
        <StackIcon className="size-5 text-accent-400" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-surface-100">{list.name}</p>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-surface-400">
          {list.author && (
            <span className="flex items-center gap-1">
              <UserIcon className="size-3 shrink-0" />
              {m.deep_link_list_by_label({ author: list.author })}
            </span>
          )}
          <span className="flex items-center gap-1">
            <GlobeIcon className="size-3 shrink-0" />
            {source}
          </span>
          <span>{m.deep_link_list_count_label({ count: list.items.length })}</span>
        </div>
      </div>
    </div>
  );
}

interface ProfileChoiceProps {
  choice: "active" | "new";
  onChoice: (choice: "active" | "new") => void;
  activeName: string;
  newName: string;
  onNewName: (name: string) => void;
}

function ProfileChoice({ choice, onChoice, activeName, newName, onNewName }: ProfileChoiceProps) {
  return (
    <RadioGroup.Root
      label={m.deep_link_list_profile_label()}
      value={choice}
      onValueChange={(value) => onChoice(value === "new" ? "new" : "active")}
    >
      <RadioGroup.Options>
        <RadioGroup.Card
          value="active"
          title={m.deep_link_list_profile_active_title()}
          description={activeName}
        />
        <RadioGroup.Card
          value="new"
          title={m.deep_link_list_profile_new_title()}
          description={m.deep_link_list_profile_new_description()}
        />
      </RadioGroup.Options>
      {choice === "new" && (
        <Field.Control
          type="text"
          size="sm"
          aria-label={m.deep_link_list_profile_name_label()}
          placeholder={m.deep_link_list_profile_name_label()}
          value={newName}
          onChange={(e) => onNewName(e.target.value)}
          hasError={newName.trim() === ""}
        />
      )}
    </RadioGroup.Root>
  );
}

/** Who the list would be read from, where the reader has not said they trust them. */
function UntrustedBand({ domain }: { domain: string }) {
  return (
    <div
      data-ui="InstallListDialog:untrusted"
      className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 select-none"
    >
      <ShieldWarningIcon className="size-5 shrink-0 text-danger-text" weight="bold" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-surface-100">
          {m.deep_link_untrusted_title({ domain })}
        </p>
        <p className="mt-0.5 text-xs text-surface-400">
          {m.deep_link_list_untrusted_description()}
        </p>
      </div>
    </div>
  );
}

/** Why the list did not read, or the run did not start. */
function RunFailure({ error }: { error: AppError }) {
  const copy = describeError(error);

  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger/15">
        <XCircleIcon className="size-5 text-danger-text" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-surface-100">{copy.title}</p>
        {copy.description && <p className="mt-0.5 text-sm text-surface-300">{copy.description}</p>}
        {copy.detail && <p className="mt-1 text-xs text-surface-400 select-text">{copy.detail}</p>}
      </div>
    </div>
  );
}
