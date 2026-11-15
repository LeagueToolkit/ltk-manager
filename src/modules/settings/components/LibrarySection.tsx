import { BooksIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { ExperimentalChip, PathField, SectionCard, useToast } from "@/components";
import { describeError, m } from "@/i18n";
import type { DataMovePlan } from "@/lib/tauri";

import { useLoadedSettings, usePlanDataMove } from "../api";
import { DataMoveDialog } from "./DataMoveDialog";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";
import { TrustedDomainsEditor } from "./TrustedDomainsEditor";

export function LibrarySection() {
  const settings = useLoadedSettings();
  return (
    <SectionCard
      title={m.settings_library_title()}
      icon={<BooksIcon className="size-5" />}
      description={m.settings_library_description()}
    >
      <SettingGroup id="library.storage" title={m.settings_library_storage_title()}>
        <DataLocationRow value={settings.modStoragePath} />
      </SettingGroup>

      <SettingGroup id="library.cataloguing" title={m.settings_library_cataloguing_title()}>
        <SettingRow
          setting="autoCategorizationEnabled"
          description={m.settings_library_categorization_description()}
          hint={m.settings_library_categorization_hint()}
          control={<SettingSwitch setting="autoCategorizationEnabled" />}
        />

        <SettingRow
          setting="autoHealthCheckEnabled"
          description={m.settings_library_health_check_description()}
          hint={m.settings_library_health_check_hint()}
          control={<SettingSwitch setting="autoHealthCheckEnabled" />}
        />

        <SettingRow
          setting="watcherEnabled"
          badge={<ExperimentalChip />}
          description={m.settings_library_watcher_description()}
          hint={m.settings_library_watcher_hint()}
          control={<SettingSwitch setting="watcherEnabled" />}
        />
      </SettingGroup>

      <SettingGroup id="library.priority" title={m.settings_library_priority_title()}>
        <SettingRow
          setting="promoteEnabledMods"
          description={m.settings_library_promotion_description()}
          control={
            <SettingSwitch
              setting="promoteEnabledMods"
              aria-label={m.settings_library_promotion_title()}
            />
          }
        />
      </SettingGroup>

      <SettingGroup id="library.installing" title={m.settings_library_installing_title()}>
        <SettingRow
          kind="action"
          layout="stacked"
          setting="trustedDomains"
          description={m.settings_library_trusted_domains_description()}
          control={<TrustedDomainsEditor />}
        />
      </SettingGroup>
    </SectionCard>
  );
}

/** A move to `target`, which is `null` for the app data directory. */
interface PlannedMove {
  plan: DataMovePlan;
  target: string | null;
}

/** The data location row, which plans a move for a picked folder and confirms it in a dialog. */
function DataLocationRow({ value }: { value: string | null }) {
  const planMove = usePlanDataMove();
  const toast = useToast();
  const [planned, setPlanned] = useState<PlannedMove | null>(null);

  function plan(target: string | null) {
    planMove.mutate(target, {
      onSuccess: (plan) => setPlanned({ plan, target }),
      onError: (error) => {
        const { title, description, detail } = describeError(error);
        toast.failure(title, error, { description: description ?? detail });
      },
    });
  }

  return (
    <>
      <SettingRow
        kind="action"
        layout="stacked"
        setting="modStoragePath"
        description={m.settings_library_storage_description()}
        control={
          <PathField
            pick="directory"
            aria-label={m.settings_library_storage_label()}
            value={value}
            onSelect={plan}
            onClear={value === null ? undefined : () => plan(null)}
            placeholder={m.settings_library_storage_placeholder()}
            dialogTitle={m.settings_library_storage_dialog_title()}
          />
        }
      />
      <DataMoveDialog
        plan={planned?.plan ?? null}
        target={planned?.target ?? null}
        onClose={() => setPlanned(null)}
      />
    </>
  );
}
