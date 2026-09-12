import { useEffect, useRef, useState } from "react";

/* Long enough to batch a burst of typing, short enough that the work is on
   disk before the author thinks to wonder. Every text document in the editor
   autosaves on this rhythm, so moving between two of them meets one. */
const SAVE_DELAY_MS = 600;

/** What a buffer is doing about the file behind it. */
export type TextSaveState = "clean" | "pending" | "saving" | "blocked" | "failed";

export interface TextDocumentEditorOptions<E, R> {
  /** The file's text, null when no file exists or none has been read. */
  saved: string | null;
  /** What identifies the file, so a change of it drops the buffer. */
  file: string;
  /** Write `text` back, rejecting with what stopped it. */
  save: (text: string) => Promise<unknown>;
  /** What in `error` is a refusal of the buffer, null where the write merely failed. */
  refusalOf?: (error: E) => R | null;
  /** How long a settled edit waits before it saves. */
  delayMs?: number;
}

export interface TextDocumentEditor<R> {
  /** The buffer, falling back to the file and then to nothing. */
  text: string;
  /** Replace the buffer, or pass null to follow the file again. */
  setText: (next: string | null) => void;
  saveState: TextSaveState;
  /** Why the file refused the buffer that stands, null for any other outcome. */
  refusal: R | null;
  /** Write whatever the wait still holds. */
  saveNow: () => void;
}

/**
 * One file as an editable buffer, saving itself back.
 *
 * Every settled edit autosaves after a short debounce, so a document built on
 * this has no save button to reach. A buffer the save refused schedules
 * nothing more, and the next edit is what asks again, so neither a pattern the
 * backend will never take nor a disk that will never answer can loop.
 *
 * The caller owns everything about the file itself: what it holds, how it is
 * written, and which failures are the file refusing the text rather than the
 * write going wrong. A buffer that was written is clean once `saved` reports
 * the text it was written as.
 */
export function useTextDocumentEditor<E, R>({
  saved,
  file,
  save,
  refusalOf,
  delayMs = SAVE_DELAY_MS,
}: TextDocumentEditorOptions<E, R>): TextDocumentEditor<R> {
  const [buffer, setBuffer] = useState<string | null>(null);
  /** The buffer a save refused, so a refusal is reported once, not looped over. */
  const [refused, setRefused] = useState<{ text: string; reason: R } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /* Reloaded when the file changes rather than when its text does, so a
     background refetch cannot swallow what the author has typed since. */
  useEffect(() => {
    setBuffer(null);
    setRefused(null);
    setFailed(null);
  }, [file]);

  const text = buffer ?? saved ?? "";
  const differs = buffer !== null && buffer !== (saved ?? "");

  const performSave = () => {
    if (buffer === null) return;
    const attempted = buffer;

    setIsSaving(true);
    save(attempted).then(
      () => {
        setRefused(null);
        setFailed(null);
        setIsSaving(false);
      },
      (error: E) => {
        const reason = refusalOf?.(error) ?? null;
        if (reason === null) setFailed(attempted);
        else setRefused({ text: attempted, reason });
        setIsSaving(false);
      },
    );
  };

  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  useEffect(() => {
    if (!differs || isSaving) return;
    if (buffer === refused?.text || buffer === failed) return;

    const timer = setTimeout(() => performSaveRef.current(), delayMs);
    return () => clearTimeout(timer);
  }, [differs, isSaving, buffer, refused, failed, delayMs]);

  const refusal = buffer !== null && buffer === refused?.text ? refused.reason : null;

  function saveStateOf(): TextSaveState {
    if (!differs) return "clean";
    if (isSaving) return "saving";
    if (refusal !== null) return "blocked";
    if (buffer === failed) return "failed";
    return "pending";
  }

  return {
    text,
    setText: setBuffer,
    saveState: saveStateOf(),
    refusal,
    saveNow: () => {
      if (differs && !isSaving) performSaveRef.current();
    },
  };
}
