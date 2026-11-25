import { CheckCircleIcon, FolderOpenIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type DialogFilter, open } from "@tauri-apps/plugin-dialog";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { twMerge } from "@/utils";

import { IconButton } from "./Button";
import { FieldAffix } from "./FieldAffix";
import { Field } from "./FormField";

/** What the browse button opens a picker for. */
export type PathPick = "directory" | "file";

/** Outcome of the caller's own check on the current path. */
export type PathValidity = "valid" | "invalid";

/** How much of the path the input shows. The whole path is still what is picked. */
export type PathDisplay = "full" | "name";

interface PathFieldBaseProps {
  /** Omit inside a row that already names the field, and pass `aria-label` instead. */
  label?: ReactNode;
  "aria-label"?: string;
  value: string | null | undefined;
  /** Receives the chosen path. Not called when the picker is dismissed. */
  onSelect: (path: string) => void;
  placeholder?: string;
  /** Heading on the native picker window. */
  dialogTitle?: string;
  description?: ReactNode;
  /** Message below the field, which also marks the input invalid. */
  error?: ReactNode;
  validity?: PathValidity;
  display?: PathDisplay;
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
  valid: <CheckCircleIcon weight="bold" className="size-5 text-success-text" />,
  invalid: <WarningCircleIcon weight="bold" className="size-5 text-danger-text" />,
};

/** Last segment of a path, under either separator. */
function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Keeps the path clear of the controls sitting inside the input. */
function trailingPadding(hasValidity: boolean, hasClear: boolean): string {
  if (hasValidity && hasClear) return "pr-26";
  if (hasValidity || hasClear) return "pr-18";
  return "pr-10";
}

/** A read-only path input with a native picker on the button inside it. */
export function PathField({
  label,
  "aria-label": ariaLabel,
  value,
  onSelect,
  placeholder,
  dialogTitle,
  description,
  error,
  validity,
  display = "full",
  onClear,
  actions,
  browseIcon,
  className,
  pick,
  filters,
}: PathFieldProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const currentWindow = getCurrentWindow();
      const unlisten = currentWindow.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "drop" && Array.isArray(payload.paths) && payload.paths.length > 0) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && payload.position) {
            const { x, y } = payload.position;
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
              onSelect(payload.paths[0]);
            }
          }
        }
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    } catch {
      // In web or tests
    }
  }, [onSelect]);

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

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const path = (file as unknown as { path?: string }).path || file.name;
      if (path) onSelect(path);
    }
  }

  const hint = browseHint[pick];
  const shown = value && display === "name" ? basename(value) : (value ?? "");
  const icon = browseIcon ?? <FolderOpenIcon />;
  const canClear = !!onClear && !!value;

  return (
    <Field.Root label={label} description={description} error={error} className={className}>
      <div className="flex items-center gap-2">
        <div
          ref={containerRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={twMerge(
            "relative flex min-w-0 flex-1 items-center rounded-md transition-all",
            isDragOver && "ring-2 ring-accent-500 ring-offset-1 ring-offset-surface-900",
          )}
        >
          <Field.Control
            type="text"
            value={shown}
            readOnly
            aria-label={ariaLabel}
            title={shown === value ? undefined : (value ?? undefined)}
            placeholder={placeholder}
            className={twMerge("font-mono", trailingPadding(!!validity, canClear))}
          />
          <FieldAffix>
            {validity && (
              <span className="pointer-events-none flex w-8 items-center justify-center">
                {validityIcon[validity]}
              </span>
            )}
            {canClear && <IconButton icon={<XIcon />} size="lg" onClick={onClear} label="Clear" />}
            <IconButton icon={icon} size="lg" onClick={handleBrowse} label={hint} />
          </FieldAffix>
        </div>
        {actions}
      </div>
    </Field.Root>
  );
}
