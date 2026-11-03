import { Tooltip } from "@/components";
import { m } from "@/i18n";
import { useActiveProfile } from "@/modules/library";
import { usePatcherStatus } from "@/modules/patcher";

/** Name the live profile selection only for a test that includes profile mods. */
export function SessionProfileLabel() {
  const { data: status } = usePatcherStatus();
  const origin = status?.session?.origin;
  if (origin?.kind !== "workshop" || !origin.includeProfile) return null;
  return <IncludedProfileLabel deferred={status?.changesAfterGame ?? false} />;
}

function IncludedProfileLabel({ deferred }: { deferred: boolean }) {
  const { data: profile } = useActiveProfile();
  let label = m.launcher_session_profile_included();
  if (profile) label = m.launcher_session_selected_profile({ name: profile.name });
  return (
    <Tooltip content={m.launcher_session_profile_hint()}>
      <span className="ml-2">
        {label}
        {deferred && <span className="ml-1">{m.launcher_session_profile_deferred()}</span>}
      </span>
    </Tooltip>
  );
}
