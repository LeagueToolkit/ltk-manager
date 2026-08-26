import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { type ToastData, useToast, useToastManager } from "@/components";
import { api, type ExtractProgress, type ExtractSummary } from "@/lib/tauri";
import { type ExtractRequest, useExtractRunStore } from "@/stores";
import { formatBytes } from "@/utils";

import { workshopKeys } from "../api";
import { describeFileKind } from "../utils/fileKindIcon";
import { useCancelExtract, useExtractGameFiles, useExtractProgress } from "./useGameExtract";

/**
 * The one place an extract runs, wherever in the browser it was asked for.
 *
 * A dialog is where the answers are given, not where the work happens: it
 * shuts the moment Extract is pressed and the browsing carries on while the
 * archive is read. The bar rides a toast that stays until the run ends, with
 * the **Cancel** on it, which is also the only surface a quick extract and an
 * copy into a layer have at all.
 *
 * Mounted once per project, beside the dialog, because a run outlives every
 * tree, menu and tab that can start one.
 */
export function ExtractRunner() {
  const pending = useExtractRunStore((s) => s.pending);
  const clearPending = useExtractRunStore((s) => s.clearPending);
  const setRunning = useExtractRunStore((s) => s.setRunning);

  const extract = useExtractGameFiles();
  const { mutate: cancelExtract } = useCancelExtract();
  const { progress, reset } = useExtractProgress();
  const { add, close, update } = useToastManager<ToastData>();
  const { toast, success, info, warning, error } = useToast();
  const queryClient = useQueryClient();

  /* Refs rather than state: the progress events land ten times a second, and
     nothing about the run in flight may re-render its way into starting a
     second one. */
  const barId = useRef<string | null>(null);
  const request = useRef<ExtractRequest | null>(null);

  useEffect(() => {
    const id = barId.current;
    const req = request.current;
    if (!id || !req || !progress) return;
    update(id, taskToast(req, progress, cancelExtract));
  }, [progress, update, cancelExtract]);

  useEffect(() => {
    if (!pending) return;
    clearPending();
    /* A key press cannot be greyed out the way a menu item is, so the second
       request is answered here rather than guarded against at the gesture. */
    if (request.current) {
      warning("An extract is already running", "Wait for it to finish, then try again.");
      return;
    }
    begin(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  /* Leaving the project takes this with it, and react-query drops a mutate
     callback whose observer has gone, so the bar would sit there for the rest
     of the session. The run itself carries on in the backend and reports to
     the log. */
  useEffect(() => {
    return () => {
      if (barId.current) close(barId.current);
      setRunning(false);
    };
  }, [close, setRunning]);

  function begin(req: ExtractRequest) {
    request.current = req;
    reset();
    setRunning(true);
    barId.current = add(taskToast(req, null, cancelExtract));

    extract.mutate(
      { targets: req.targets, options: req.options },
      {
        onSuccess: (summary) => {
          dismissBar();
          /* The backend had one in flight already, which only a run started
             from a window this one had lost track of can look like. */
          if (!summary) {
            warning("An extract is already running", "Wait for it to finish, then try again.");
            return;
          }
          report(req, summary);
        },
        onError: (e) => {
          dismissBar();
          error(req.intoLayer ? "Copy failed" : "Extract failed", e.message, { notify: true });
        },
        onSettled: () => {
          setRunning(false);
          request.current = null;
        },
      },
    );
  }

  function dismissBar() {
    if (barId.current) close(barId.current);
    barId.current = null;
  }

  function report(req: ExtractRequest, summary: ExtractSummary) {
    /* The layer's tree reads the disk, so the files that just landed in it are
       only there once the listing is asked for again. */
    if (req.projectPath) {
      void queryClient.invalidateQueries({ queryKey: workshopKeys.contentTree(req.projectPath) });
    }

    const files = summary.extracted.toLocaleString();
    const openFolder = {
      label: "Open folder",
      onClick: () => void api.revealInExplorer(summary.destination),
    };

    if (summary.cancelled) {
      toast({
        title: `Cancelled after ${files} files`,
        description: summary.destination,
        type: "warning",
        action: openFolder,
      });
      return;
    }

    /* Nothing written is an answer rather than a failure, and which of the two
       reasons it was is the whole of what a user needs told. */
    if (summary.extracted === 0) {
      info(
        "Nothing was written",
        summary.skippedExisting > 0
          ? `${summary.skippedExisting.toLocaleString()} files were already there`
          : "Nothing matched what was aimed at",
      );
      return;
    }

    if (req.intoLayer) {
      success(`Copied ${files} files into ${req.intoLayer}`, describeResult(summary), {
        notify: true,
      });
    } else {
      success(
        `Extracted ${files} files (${formatBytes(Number(summary.bytesWritten))})`,
        describeResult(summary),
        {
          notify: true,
        },
      );
    }

    /* Rejected and duplicate chunks write nothing at all, so a run reads as
       complete while files are missing. Renamed ones landed, so they stay in
       the summary line rather than raise this. */
    const unwritten = summary.rejected + summary.duplicates;
    if (unwritten > 0) {
      warning(
        `${unwritten.toLocaleString()} files could not be written`,
        summary.rejected > 0
          ? "Their paths were refused, so a hashtable is wrong about them"
          : "Two chunks were named the same path",
      );
    }

    if (!req.intoLayer && req.reveal) void api.revealInExplorer(summary.destination);
  }

  return null;
}

/**
 * The running toast, before the first chunk and after every hundredth.
 *
 * The counts rather than the current path: the path churns ten times a second
 * and takes the toast's width with it, where a count that only grows reads
 * still.
 */
function taskToast(
  request: ExtractRequest,
  progress: ExtractProgress | null,
  onCancel: () => void,
) {
  const done = progress?.current ?? 0;
  const total = progress?.total ?? 0;

  return {
    title: request.intoLayer
      ? `Copying ${request.subject} into ${request.intoLayer}`
      : `Extracting ${request.subject}`,
    description:
      total > 0
        ? `${done.toLocaleString()} of ${total.toLocaleString()} · ${formatBytes(Number(progress?.bytes ?? 0))}`
        : "Reading the archive…",
    timeout: 0,
    data: {
      type: "info" as const,
      timeout: 0,
      action: { label: "Cancel", onClick: onCancel },
      progress: total > 0 ? (done / total) * 100 : 0,
    },
  };
}

/** The kinds under the count, most written first, as wadtools prints them. */
function describeResult(summary: ExtractSummary): string {
  const parts = summary.byKind
    .slice(0, 4)
    .map((entry) => `${entry.count.toLocaleString()} ${describeFileKind(entry.kind).label}`);

  if (summary.renamed > 0) {
    parts.push(`${summary.renamed.toLocaleString()} renamed`);
  }
  if (summary.skippedExisting > 0) {
    parts.push(`${summary.skippedExisting.toLocaleString()} skipped`);
  }
  return parts.join(" · ");
}
