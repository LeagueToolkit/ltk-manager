import { ArrowCounterClockwiseIcon, StackIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, Dialog, IconButton, RadioGroup, Spinner } from "@/components";
import type { ConflictGroup } from "@/lib/tauri";
import { useModConflicts, useSetConflictWinner } from "@/modules/library/api";
import { usePatcherStatus } from "@/modules/patcher";

interface ConflictsButtonProps {
  /** Disable while the library is still loading. */
  disabled?: boolean;
}

/** The library's way into conflict picks: a toolbar button and its side drawer. */
export function ConflictsButton({ disabled }: ConflictsButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        icon={<StackIcon />}
        variant="outline"
        size="md"
        disabled={disabled}
        aria-label="Mod conflicts"
        tooltip="Pick which mod wins files that enabled mods share"
        onClick={() => setOpen(true)}
      />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Sheet
            side="right"
            data-ui="ConflictsButton:drawer"
            aria-label="Mod conflicts"
            className="inset-y-3 right-3 w-[min(640px,calc(100vw-1.5rem))] overflow-auto rounded-xl border border-surface-600 p-4"
          >
            <div className="mb-3 flex items-center justify-between select-none">
              <h2 className="font-display text-lg font-bold text-surface-50">Conflicts</h2>
              <IconButton
                icon={<XIcon className="h-4 w-4" />}
                variant="ghost"
                size="sm"
                aria-label="Close"
                onClick={() => setOpen(false)}
              />
            </div>
            {open && <ConflictList />}
          </Dialog.Sheet>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ConflictList() {
  const { data: groups, isLoading, error } = useModConflicts(true);
  const { data: patcher } = usePatcherStatus();

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-surface-400 select-none">
        <Spinner /> Scanning enabled mods
      </p>
    );
  }
  if (error)
    return (
      <p className="text-sm text-danger-text select-text">
        {"detail" in error ? String(error.detail) : error.code}
      </p>
    );
  if (!groups?.length) {
    return (
      <p className="text-sm text-surface-400 select-none">No enabled mods replace the same files</p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-surface-400 select-none">
        Pick which mod wins each group of shared files.
        {patcher?.running && " Restart the patcher to apply."}
      </p>
      {groups.map((g) => (
        <ConflictRow key={g.key} group={g} />
      ))}
    </div>
  );
}

function ConflictRow({ group }: { group: ConflictGroup }) {
  const setWinner = useSetConflictWinner();

  return (
    <section
      className="rounded-lg border border-surface-700 bg-surface-800 px-4 py-3"
      data-ui="ConflictsButton:group"
    >
      <div className="mb-2 flex items-center justify-between gap-2 select-none">
        <p className="text-sm font-medium text-surface-100">
          {group.label}
          <span className="ml-2 text-xs text-surface-400">
            {group.files} file{group.files === 1 ? "" : "s"}
          </span>
        </p>
        {group.chosen && (
          <Button
            variant="ghost"
            size="sm"
            left={<ArrowCounterClockwiseIcon weight="bold" className="h-4 w-4" />}
            disabled={setWinner.isPending}
            onClick={() => setWinner.mutate({ key: group.key, winner: null })}
          >
            Reset
          </Button>
        )}
      </div>
      <RadioGroup.Root
        value={group.winner}
        onValueChange={(v) => setWinner.mutate({ key: group.key, winner: v as string })}
        disabled={setWinner.isPending}
      >
        <RadioGroup.Options orientation="vertical">
          {group.mods.map((m) => (
            <RadioGroup.Item key={m.id} value={m.id} label={m.name} />
          ))}
        </RadioGroup.Options>
      </RadioGroup.Root>
    </section>
  );
}
