import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { Button, HintIcon, Tooltip } from "@/components";
import { twMerge } from "@/utils";

import { useSettingMark } from "./SettingFocus";
import { SettingScope, useSettingReset } from "./SettingScope";

interface SettingGroupIdentity {
  id: string;
}

const SettingGroupContext = createContext<SettingGroupIdentity | null>(null);

/** The group a row is inside, or null for a row in an ungrouped card. */
export function useSettingGroup(): SettingGroupIdentity | null {
  return useContext(SettingGroupContext);
}

/* One changed row is a gear away, so a second control for it would say the same
   thing twice. The button is for the case the gear is tedious. */
const GROUP_RESET_THRESHOLD = 2;

function SettingGroupReset() {
  const { changed, reset } = useSettingReset();

  if (changed.length < GROUP_RESET_THRESHOLD) return null;

  return (
    <Tooltip content={`Reset ${changed.length} changed settings in this group`}>
      <Button
        variant="ghost"
        size="xs"
        compact
        aria-label={`Reset ${changed.length} changed settings in this group`}
        left={<ArrowCounterClockwiseIcon weight="bold" className="h-3.5 w-3.5" />}
        onClick={reset}
      />
    </Tooltip>
  );
}

interface SettingGroupProps {
  /** Stable and namespaced by its tab, `patching.mod-safety`, because `?focus=` addresses it. */
  id: string;
  /** A noun of one or two words. It labels a band, and it does not instruct. */
  title: string;
  /** Rare. One line, and only where the title cannot carry the meaning. */
  description?: ReactNode;
  /** Detail that would crowd the header, on a `HintIcon` after the title. */
  hint?: ReactNode;
  /** A chip after the title. `ExperimentalChip` and its kind. */
  badge?: ReactNode;
  /** One control for the whole group, at the header's trailing edge. */
  action?: ReactNode;
  children: ReactNode;
}

/** A labelled band of rows inside a card, ruled off from the band above it. */
export function SettingGroup({
  id,
  title,
  description,
  hint,
  badge,
  action,
  children,
}: SettingGroupProps) {
  const headingId = `setting-group-${id}`;
  const mark = useSettingMark(id);
  const identity = useMemo(() => ({ id }), [id]);

  return (
    <SettingGroupContext.Provider value={identity}>
      <SettingScope>
        <section
          ref={mark.ref}
          tabIndex={mark.tabIndex}
          data-ui="SettingGroup"
          role="group"
          aria-labelledby={headingId}
          /* DS-SETTING-LEVEL. */
          className={twMerge(
            "flex scroll-mt-6 flex-col gap-3 border-t border-surface-700/40 pt-4 outline-none first:border-t-0 first:pt-0",
            mark.className,
          )}
        >
          <div
            data-ui="SettingGroup:header"
            /* DS-SETTING-GUTTER. */
            className="flex items-center justify-between gap-2 pl-7 select-none"
          >
            <div className="min-w-0">
              <h4
                id={headingId}
                className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-surface-400 uppercase"
              >
                {title}
                {hint && <HintIcon content={hint} />}
                {badge}
              </h4>
              {description && <p className="mt-0.5 text-xs text-surface-400">{description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {action}
              <SettingGroupReset />
            </div>
          </div>

          <div data-ui="SettingGroup:rows" className="flex flex-col gap-3 pl-7">
            {children}
          </div>
        </section>
      </SettingScope>
    </SettingGroupContext.Provider>
  );
}
