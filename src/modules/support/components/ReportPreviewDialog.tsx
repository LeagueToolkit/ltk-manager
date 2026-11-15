import { useState } from "react";

import { Dialog, SelectField } from "@/components";
import { m } from "@/i18n";
import type { ReportPreviewFile } from "@/lib/tauri";
import { formatBytes } from "@/utils/formatBytes";

interface ReportPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  /** Every file of the report, in the order of the zip. */
  files: readonly ReportPreviewFile[];
}

/** Every file of a support report as text, one at a time, as the report leaves. */
export function ReportPreviewDialog({ open, onClose, files }: ReportPreviewDialogProps) {
  const [path, setPath] = useState<string | null>(null);
  const shown = files.find((file) => file.path === path) ?? files[0];

  const options = files.map((file) => ({
    value: file.path,
    label: `${file.path} (${formatBytes(file.bytes)})`,
  }));

  return (
    <Dialog.Shell
      open={open}
      onClose={onClose}
      title={m.support_preview_title()}
      description={m.support_preview_description()}
      size="xl"
      data-ui="ReportPreviewDialog"
    >
      <Dialog.Body>
        <SelectField
          label={m.support_preview_file_label()}
          options={options}
          value={shown?.path}
          onValueChange={setPath}
        />
        <pre
          data-ui="ReportPreviewDialog:contents"
          className="min-h-48 overflow-auto rounded-md bg-surface-900/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-surface-300 scrollbar-md select-text"
        >
          {shown?.contents}
        </pre>
      </Dialog.Body>
    </Dialog.Shell>
  );
}
