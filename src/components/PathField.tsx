import { CheckCircleIcon, FolderOpenIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { type DialogFilter, open } from "@tauri-apps/plugin-dialog";
import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { IconButton } from "./Button";
import { Field } from "./FormField";
import { Tooltip } from "./Tooltip";

/** What the browse button opens a picker for. */
export type PathPick = "directory" | "file";

/** Outcome of the caller's own check on the current path. */
export type PathValidity = "valid" | "invalid";

interface PathFieldBaseProps {
  label: ReactNode;
  value: string | null | undefined;
  /** Receives the chosen path. Not called when the picker is dismissed. */
  onSelect: (path: string) => void;
  placeholder?: string;
  /** Heading on the native picker window. */
  dialogTitle?: string;
  description?: ReactNode;
  /** Message below the field. */
  error?: ReactNode;
  validity?: PathValidity;
  /** Adds a clear button while there is a value. */
  onClear?: () => void;
  /** Controls placed outside the input, after it. */
  actions?: ReactNode;
  browseIcon?: ReactNode;
  className?: string;
}

/** `filters` is rejected for a directory, where the native dialog ignores it. */
export type PathFieldProps = PathFieldBaseProps &
  ({ pick: "directory"; filters?: never } | { pick: "file"; filters?: DialogFilter[] });

const browseHint: Record<PathPick, string> = {
  directory: "Browse for a folder",
  file: "Browse for a file",
};

const validityIcon: Record<PathValidity, ReactNode> = {
  valid: <CheckCircleIcon weight="bold" className="h-5 w-5 text-success-text" />,
  invalid: <WarningCircleIcon weight="bold" className="h-5 w-5 text-danger-text" />,
};

const inBoxButtonClass =
  "h-full w-8 shrink-0 rounded-none text-surface-300 hover:bg-surface-600 hover:text-surface-100 active:bg-surface-500";

/** Keeps the path clear of the controls sitting inside the input. */
function trailingPadding(hasValidity: boolean, hasClear: boolean): string {
  if (hasValidity && hasClear) return "pr-26";
  if (hasValidity || hasClear) return "pr-18";
  return "pr-10";
}

/** A read-only path input with a native picker on the button inside it. */
export function PathField({
  label,
  value,
  onSelect,
  placeholder,
  dialogTitle,
  description,
  error,
  validity,
  onClear,
  actions,
  browseIcon,
  className,
  pick,
  filters,
}: PathFieldProps) {
  async function handleBrowse() {
    try {
      const selected = await open({
        title: dialogTitle,
        directory: pick === "directory",
        multiple: false,
        filters,
        defaultPath: value ?? undefined,
      });

      if (selected) onSelect(selected);
    } catch (err) {
      console.error("Failed to open the path picker:", err);
    }
  }

  const hint = browseHint[pick];
  const icon = browseIcon ?? <FolderOpenIcon weight="bold" className="h-5 w-5" />;
  const canClear = !!onClear && !!value;

  return (
    <Field.Root className={className}>
      <Field.Label>{label}</Field.Label>
      <div className="flex items-center gap-2">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Field.Control
            type="text"
            value={value ?? ""}
            readOnly
            placeholder={placeholder}
            className={twMerge("font-mono", trailingPadding(!!validity, canClear))}
          />
          <div className="absolute inset-y-px right-px flex items-stretch overflow-hidden rounded-r-md">
            {validity && (
              <span className="pointer-events-none flex w-8 items-center justify-center">
                {validityIcon[validity]}
              </span>
            )}
            {canClear && (
              <Tooltip content="Clear">
                <IconButton
                  icon={<XIcon weight="bold" className="h-5 w-5" />}
                  variant="ghost"
                  size="sm"
                  compact
                  aria-label="Clear"
                  onClick={onClear}
                  className={inBoxButtonClass}
                />
              </Tooltip>
            )}
            <Tooltip content={hint}>
              <IconButton
                icon={icon}
                variant="ghost"
                size="sm"
                compact
                aria-label={hint}
                onClick={handleBrowse}
                className={inBoxButtonClass}
              />
            </Tooltip>
          </div>
        </div>
        {actions}
      </div>
      {description && <Field.Description>{description}</Field.Description>}
      {error && <p className="text-xs text-danger-text">{error}</p>}
    </Field.Root>
  );
}
