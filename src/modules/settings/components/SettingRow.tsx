import { type ReactNode } from "react";

import { HintIcon } from "@/components";
import { twMerge } from "@/utils";

import { type IndexedSettingKey, settingEntry } from "../settingsIndex";
import { useMarkRedirect, useSettingMark } from "./SettingFocus";
import { useSettingGroup } from "./SettingGroup";
import { SettingGutter } from "./SettingGutter";
import { useRegisterSetting } from "./SettingScope";

interface SettingRowBase {
  /** A glyph before the title, for a row about one part of the game. */
  icon?: ReactNode;
  /** A chip after the title. `ExperimentalChip` and its kind. */
  badge?: ReactNode;
  /** Omit when the control already says what it does, such as a segmented picker. */
  description?: ReactNode;
  /** Detail that would crowd the description, shown on the title's hint icon. */
  hint?: ReactNode;
  control: ReactNode;
  /** Sizes the control slot, for a control with no width of its own. */
  controlClassName?: string;
  /** An `action` row holds a button, so it must not be a label. Defaults to `toggle`. */
  kind?: "toggle" | "action";
  /** `stacked` drops a full-width control under the label, for an editor the right slot cannot hold. */
  layout?: "inline" | "stacked";
  /** Indents, for a setting only the row above it reaches. */
  dependent?: boolean;
  /** A dependent row its parent has turned off. It stays mounted and draws nothing. */
  hidden?: boolean;
}

/**
 * A row reads one setting, or it names itself, and never both.
 *
 * A keyed row takes its title from the index, so the one name a reader sees and
 * the one a link carries cannot drift apart. A row with no key is an action the
 * index has nothing to say about, and it writes its own.
 */
type SettingRowProps = SettingRowBase &
  ({ setting: IndexedSettingKey; title?: never } | { setting?: never; title: string });

/** One labelled setting and its control, across the row from it or beneath it. */
export function SettingRow({
  title,
  setting,
  icon,
  badge,
  description,
  hint,
  control,
  controlClassName,
  kind = "toggle",
  layout = "inline",
  dependent = false,
  hidden = false,
}: SettingRowProps) {
  const entry = setting === undefined ? undefined : settingEntry(setting);
  const group = useSettingGroup();
  const mark = useSettingMark(entry?.id, !hidden);
  useMarkRedirect(entry?.id, group?.id, hidden);
  useRegisterSetting(setting, hidden);

  if (hidden) return null;

  const stacked = layout === "stacked";

  const className = twMerge(
    stacked ? "flex flex-col gap-2" : "flex items-center justify-between gap-4",
    "scroll-mt-6 outline-none",
    mark.className,
  );

  const body = (
    <>
      <div className="max-w-xl min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-surface-200">
          {icon}
          {entry?.title ?? title}
          {hint && <HintIcon content={hint} />}
          {badge}
        </span>
        {description && <span className="block text-sm text-surface-400">{description}</span>}
      </div>
      <div className={twMerge(stacked ? "min-w-0" : "shrink-0", controlClassName)}>{control}</div>
    </>
  );

  let row: ReactNode = (
    <label ref={mark.ref} tabIndex={mark.tabIndex} className={className}>
      {body}
    </label>
  );

  /* A stacked control is composite, so a wrapping label would aim every click at its first input. */
  if (kind === "action" || stacked) {
    row = (
      <div ref={mark.ref} tabIndex={mark.tabIndex} className={className}>
        {body}
      </div>
    );
  }

  return (
    <SettingGutter setting={setting} className={dependent ? "ml-4" : undefined}>
      {row}
    </SettingGutter>
  );
}
