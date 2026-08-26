import { Button, Dialog, PathField, SegmentedControl, Spinner, Switch } from "@/components";
import { useExtractDialogStore, useExtractRunning, useStartExtract } from "@/stores";
import { formatBytes } from "@/utils";

import { usePlanGameExtract } from "./useGameExtract";

/**
 * The one dialog behind every **Extract…** in the browser.
 *
 * Its fields are remembered, so a modder who extracts a champion's textures
 * every session answers them once - and having answered them once, never opens
 * this again: the menus offer the same answers as a single item afterwards.
 *
 * Pressing Extract shuts it. The work belongs to
 * [`ExtractRunner`](./ExtractRunner), which carries the bar and the Cancel on
 * a toast, so browsing carries on while the archive is read.
 *
 * What is aimed at comes from the store and outlives the tree that opened it -
 * a preview splitting a group beside the tree remounts it, and the dialog must
 * not go with it.
 */
export function ExtractDialog() {
  const targets = useExtractDialogStore((s) => s.targets);
  const subject = useExtractDialogStore((s) => s.subject);
  const close = useExtractDialogStore((s) => s.close);

  const destination = useExtractDialogStore((s) => s.destination);
  const setDestination = useExtractDialogStore((s) => s.setDestination);
  const layout = useExtractDialogStore((s) => s.layout);
  const setLayout = useExtractDialogStore((s) => s.setLayout);
  const perArchiveFolder = useExtractDialogStore((s) => s.perArchiveFolder);
  const setPerArchiveFolder = useExtractDialogStore((s) => s.setPerArchiveFolder);
  const existing = useExtractDialogStore((s) => s.existing);
  const setExisting = useExtractDialogStore((s) => s.setExisting);
  const recoverNames = useExtractDialogStore((s) => s.recoverNames);
  const setRecoverNames = useExtractDialogStore((s) => s.setRecoverNames);
  const openWhenDone = useExtractDialogStore((s) => s.openWhenDone);
  const setOpenWhenDone = useExtractDialogStore((s) => s.setOpenWhenDone);

  const plan = usePlanGameExtract(targets);
  const start = useStartExtract();
  const busy = useExtractRunning();

  const open = targets !== null;

  function handleExtract() {
    if (!targets || !destination) return;

    start({
      targets,
      subject,
      options: { destination, layout, perArchiveFolder, existing, recoverNames, kinds: null },
      reveal: openWhenDone,
    });
    close();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="md">
          <Dialog.Header>
            <Dialog.Title>Extract to disk</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body className="flex flex-col gap-4">
            <Summary
              subject={subject}
              files={plan.data?.files ?? 0}
              bytes={Number(plan.data?.bytes ?? 0)}
              archives={plan.data?.archives.length ?? 0}
              loading={plan.isPending && open}
            />

            <PathField
              label="Destination"
              pick="directory"
              value={destination}
              onSelect={setDestination}
              dialogTitle="Extract to"
              placeholder="Choose a folder"
              description="Anywhere but the League install"
            />

            <Row label="Layout" hint="Keep paths writes each file at its game path">
              <SegmentedControl
                options={[
                  { value: "paths", label: "Keep paths" },
                  { value: "flat", label: "Flat" },
                ]}
                value={layout}
                onChange={setLayout}
                className="w-56"
              />
            </Row>

            <Row label="Existing files">
              <SegmentedControl
                options={[
                  { value: "skip", label: "Skip" },
                  { value: "replace", label: "Replace" },
                ]}
                value={existing}
                onChange={setExisting}
                className="w-56"
              />
            </Row>

            <SwitchRow
              label="One folder per archive"
              hint="The layout a layer holds, for Add WAD folder"
              checked={perArchiveFolder}
              onChange={setPerArchiveFolder}
            />
            <SwitchRow
              label="Recover names from the archive"
              hint="Reads every bin for names no hashtable holds, which is slow"
              checked={recoverNames}
              onChange={setRecoverNames}
            />
            <SwitchRow
              label="Open the folder when done"
              checked={openWhenDone}
              onChange={setOpenWhenDone}
            />

            {busy && (
              <p className="text-xs text-warning-text select-none">
                An extract is already running. Wait for it to finish, then try again.
              </p>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="filled"
              disabled={busy || !destination || plan.data?.files === 0}
              onClick={handleExtract}
            >
              Extract
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface SummaryProps {
  subject: string;
  files: number;
  bytes: number;
  archives: number;
  loading: boolean;
}

/* What a directory holds, before the write starts. A whole archive is counted
   by reading its chunk table, so the line arrives a beat after the dialog. */
function Summary({ subject, files, bytes, archives, loading }: SummaryProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-950/40 px-3 py-2 text-sm select-none">
      {loading && <Spinner size="sm" className="h-3.5 w-3.5" />}
      {loading && <span className="text-surface-400">Counting…</span>}
      {!loading && (
        <span className="min-w-0 truncate text-surface-300">
          {files.toLocaleString()} {files === 1 ? "file" : "files"}
          {/* A target a preview tab built knows no size, and no size reads
              better than nought bytes. */}
          {bytes > 0 && ` · ${formatBytes(bytes)}`}
          {archives > 1 && ` · ${archives} archives`}
        </span>
      )}
      {subject && (
        <span className="ml-auto min-w-0 shrink truncate font-mono text-xs text-surface-400 select-text">
          {subject}
        </span>
      )}
    </div>
  );
}

interface RowProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Row({ label, hint, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4 select-none">
      <div className="min-w-0">
        <p className="text-sm text-surface-200">{label}</p>
        {hint && <p className="text-xs text-surface-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SwitchRow({ label, hint, checked, onChange }: SwitchRowProps) {
  return (
    <Row label={label} hint={hint}>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </Row>
  );
}
