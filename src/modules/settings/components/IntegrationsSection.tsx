import { CheckCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { AlertBox, Button, Checkbox, Code, ProgressBar, Spinner, useConfirm } from "@/components";
import { errorSummary, m } from "@/i18n";
import type {
  IntegrationAction,
  IntegrationStage,
  IntegrationStatus,
  MenuStatus,
  Tool,
} from "@/lib/tauri";
import { twMerge } from "@/utils";

import {
  useCancelIntegration,
  useChangeIntegration,
  useIntegrationRelease,
  useIntegrations,
} from "../api/useIntegrations";
import { FileTypesSection } from "./FileTypesSection";
import { IntegrationActions } from "./IntegrationActions";
import { IntegrationPaths } from "./IntegrationPaths";
import { IntegrationSectionCard } from "./IntegrationSectionCard";
import { useSettingMark } from "./SettingFocus";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";

const terminal: IntegrationStage[] = ["complete", "failed", "cancelled"];

function stageLabel(stage: IntegrationStage): string {
  const labels: Record<IntegrationStage, string> = {
    checking: m.settings_integrations_checking_label(),
    downloading: m.settings_integrations_downloading_label(),
    installing: m.settings_integrations_installing_label(),
    registering: m.settings_integrations_registering_label(),
    removing: m.settings_integrations_removing_label(),
    complete: m.settings_integrations_complete_label(),
    failed: m.settings_integrations_failed_label(),
    cancelled: m.settings_integrations_cancelled_label(),
  };
  return labels[stage];
}

function toolTitle(tool: Tool): string {
  const titles: Record<Tool, string> = {
    wadtools: m.settings_integrations_wad_title(),
    "tex-toolz": m.settings_integrations_tex_title(),
    "ritobin-tools": m.settings_integrations_ritobin_title(),
  };
  return titles[tool];
}

function menuLabel(menu: MenuStatus): string {
  const labels: Record<MenuStatus, string> = {
    absent: m.settings_integrations_menu_absent_label(),
    enabled: m.settings_integrations_menu_enabled_label(),
    external: m.settings_integrations_menu_external_label(),
    changed: m.settings_integrations_menu_changed_label(),
  };
  return labels[menu];
}

function IntegrationCard({ status, busy }: { status: IntegrationStatus; busy: boolean }) {
  const { tool } = status;
  const installationMark = useSettingMark(`integrations.${tool}.installation`);
  const [installMenu, setInstallMenu] = useState(true);
  const release = useIntegrationRelease(tool, status.supported);
  const change = useChangeIntegration(tool);
  const cancel = useCancelIntegration();
  const confirm = useConfirm();
  const name = toolTitle(tool);
  const operation = status.operation;
  const running = operation && !terminal.includes(operation.stage);
  const installed = status.version !== null;
  const disabled = busy || change.isPending || !status.supported;
  const updateAvailable = release.data && installed && release.data.tag !== status.version;
  const failure =
    change.error ?? (operation?.error && { code: "INTEGRATION" as const, error: operation.error });
  const externalPaths = [
    ...new Map(
      status.externalPaths.map((path) => [path.replace(/\\/g, "/").toLowerCase(), path]),
    ).values(),
  ];
  const downloadPercent =
    operation?.stage === "downloading" && Number(operation.total) > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((Number(operation.downloaded) / Number(operation.total)) * 100)),
        )
      : null;

  async function run(requested: IntegrationAction) {
    let action = requested;
    if (requested === "install" && !installed && !installMenu) action = "installOnly";
    let conflicts: "preserve" | "replace" = "preserve";
    if (action === "uninstall") {
      const accepted = await confirm({
        title: m.settings_integrations_uninstall_title({ name }),
        description: m.settings_integrations_uninstall_description(),
        confirmLabel: m.settings_integrations_uninstall_action(),
      });
      if (!accepted) return;
    }
    const writesMenu =
      action === "enableMenu" ||
      ((action === "install" || action === "repair") && (!installed || status.menuRequested));
    if (writesMenu && (status.menu === "external" || status.menu === "changed")) {
      const accepted = await confirm({
        title: m.settings_integrations_replace_title(),
        description: m.settings_integrations_replace_description(),
        children: (
          <div className="mt-3 flex flex-col gap-1 select-text">
            {externalPaths.map((path) => (
              <Code className="break-all" key={path}>
                {path}
              </Code>
            ))}
          </div>
        ),
        confirmLabel: m.settings_integrations_replace_action(),
        tone: "warning",
      });
      if (!accepted) return;
      conflicts = "replace";
    } else if ((action === "install" || action === "installOnly") && !installed) {
      const accepted = await confirm({
        title: m.settings_integrations_install_title({ name }),
        description: m.settings_integrations_install_description(),
        confirmLabel: m.settings_integrations_install_action(),
        tone: "warning",
      });
      if (!accepted) return;
    }
    change.mutate({ action, conflicts });
  }

  return (
    <IntegrationSectionCard tool={tool} title={name}>
      <section
        ref={installationMark.ref}
        tabIndex={installationMark.tabIndex}
        aria-label={m.settings_integrations_installation_title()}
        className={twMerge(
          "flex min-w-0 scroll-mt-6 flex-col gap-3 pl-7 outline-none",
          installationMark.className,
        )}
      >
        {!status.supported && (
          <AlertBox tone="info">{m.settings_integrations_unsupported_description()}</AlertBox>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1 text-row">
            {!installed && (
              <p className="font-medium text-surface-200">
                {m.settings_integrations_not_installed_label()}
              </p>
            )}
            {installed && (
              <div className="flex flex-wrap items-center gap-2">
                {!status.needsRepair && !status.pendingCleanup && (
                  <CheckCircleIcon weight="duotone" className="size-4 text-success-text" />
                )}
                <span className="font-medium text-surface-200">
                  {m.settings_integrations_installed_label()}
                </span>
                <Code className="select-text">{status.version}</Code>
              </div>
            )}
            {updateAvailable && (
              <p className="text-meta text-info-text">
                {m.settings_integrations_update_label({ version: release.data.tag })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!installed && (
              <Button
                size="sm"
                className="text-row"
                variant="filled"
                disabled={disabled}
                onClick={() => void run("install")}
              >
                {m.settings_integrations_install_action()}
              </Button>
            )}
            {updateAvailable && (
              <Button
                size="sm"
                className="text-row"
                variant="filled"
                disabled={disabled}
                onClick={() => void run("install")}
              >
                {m.settings_integrations_update_action()}
              </Button>
            )}
            {installed && (
              <Button
                size="sm"
                className="text-row"
                variant="outline"
                loading={release.isFetching}
                disabled={!status.supported || release.isFetching}
                onClick={() => void release.refetch()}
              >
                {m.settings_integrations_check_action()}
              </Button>
            )}
            {(installed || status.pendingCleanup) && (
              <IntegrationActions installed={installed} disabled={disabled} onAction={run} />
            )}
          </div>
        </div>
        {status.needsRepair && (
          <AlertBox tone="warning">{m.settings_integrations_repair_description()}</AlertBox>
        )}
        {status.pendingCleanup && (
          <AlertBox tone="warning">{m.settings_integrations_cleanup_description()}</AlertBox>
        )}
        {release.error && (
          <AlertBox tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{m.settings_integrations_release_description()}</span>
              {!installed && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={release.isFetching}
                  onClick={() => void release.refetch()}
                >
                  {m.settings_integrations_check_action()}
                </Button>
              )}
            </div>
          </AlertBox>
        )}
        <IntegrationPaths status={status} externalPaths={externalPaths} />
        {operation && operation.stage !== "complete" && (
          <div className="flex flex-col gap-2">
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 text-row text-surface-300"
            >
              {running && <Spinner />}
              {stageLabel(operation.stage)}
              {downloadPercent !== null && (
                <span className="tabular-nums">
                  {m.settings_integrations_progress_label({ percent: downloadPercent })}
                </span>
              )}
              {running && (operation.stage === "checking" || operation.stage === "downloading") && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(operation.id)}
                >
                  {m.settings_integrations_cancel_action()}
                </Button>
              )}
            </div>
            {operation.stage === "downloading" && (
              <ProgressBar
                value={downloadPercent}
                aria-label={m.settings_integrations_downloading_label()}
                size="sm"
              />
            )}
          </div>
        )}
        {failure && (
          <AlertBox tone="danger">
            <span className="select-text">{errorSummary(failure)}</span>
          </AlertBox>
        )}
      </section>
      <SettingGroup
        id={`integrations.${tool}.explorer`}
        title={m.settings_integrations_explorer_title()}
      >
        <SettingRow
          size="sm"
          kind="action"
          title={m.settings_integrations_menu_title()}
          description={menuLabel(status.menu)}
          control={
            <>
              {installed && status.menu === "enabled" && (
                <Button
                  size="sm"
                  className="text-row"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void run("disableMenu")}
                >
                  {m.settings_integrations_disable_action()}
                </Button>
              )}
              {installed && status.menu !== "enabled" && (
                <Button
                  size="sm"
                  className="text-row"
                  variant="outline"
                  disabled={disabled || !installed}
                  onClick={() => void run("enableMenu")}
                >
                  {m.settings_integrations_enable_action()}
                </Button>
              )}
            </>
          }
        />
        {!installed && (
          <Checkbox
            aria-label={m.settings_integrations_install_menu_label()}
            label={<span className="text-row">{m.settings_integrations_install_menu_label()}</span>}
            checked={installMenu}
            onCheckedChange={setInstallMenu}
            disabled={disabled}
          />
        )}
        <p className="text-meta text-surface-400">{m.settings_integrations_classic_hint()}</p>
        {tool === "tex-toolz" && (
          <div className="flex flex-col gap-1 border-t border-surface-700/40 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-row font-medium text-surface-200">
                {m.settings_integrations_handler_title()}
              </p>
              {status.handlerPath && (
                <span className="text-meta text-surface-400">
                  {m.settings_integrations_handler_external_label()}
                </span>
              )}
            </div>
            <p className="text-meta text-surface-400">
              {m.settings_integrations_handler_description()}
            </p>
          </div>
        )}
      </SettingGroup>
    </IntegrationSectionCard>
  );
}

/** The external tool installation sections. */
export function IntegrationsSection() {
  const { data, error, isPending } = useIntegrations();
  if (isPending) return <Spinner />;
  if (error) return <AlertBox tone="danger">{errorSummary(error)}</AlertBox>;
  const busy =
    data?.some((status) => status.operation && !terminal.includes(status.operation.stage)) ?? false;
  return (
    <div data-ui="IntegrationsSection" className="flex flex-col gap-6 select-none">
      <FileTypesSection />
      {data?.map((status) => (
        <IntegrationCard key={status.tool} status={status} busy={busy} />
      ))}
    </div>
  );
}
