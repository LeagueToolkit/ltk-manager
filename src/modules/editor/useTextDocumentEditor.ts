import { useEffect, useRef, useState } from "react";

/* Long enough to batch a burst of typing, short enough that the work is on
   disk before the author thinks to wonder. The ignore rules and strings
   documents already autosave on this rhythm, so a creator moving between two
   text documents meets one. */
const SAVE_DELAY_MS = 600;

/** What a buffer is doing about the file behind it. */
export type TextSaveState = "clean" | "pending" | "saving" | "blocked" | "failed";

/** The buffer a save carried, and what the file did with it. */
type Attempt<R> =
  | { outcome: "written"; text: string }
  | { outcome: "refused"; text: string; reason: R }
  | { outcome: "failed"; text: string };

export interface TextDocumentEditorOptions<E, R> {
  /** The file's text, null where no file exists and undefined until one is read. */
  saved: string | null | undefined;
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
 * this has no save button to reach. Each buffer is written at most once: a
 * refusal, a failed write and a write that landed all stand until the buffer
 * changes, so nothing the file will not take can loop.
 *
 * The caller owns everything about the file itself: what it holds, how it is
 * written, and which failures are the file refusing the text rather than the
 * write going wrong. A buffer that was written reads clean once `saved`
 * reports it, and an unread file takes no edits at all.
 */
export function useTextDocumentEditor<E, R>({
  saved,
  file,
  save,
  refusalOf,
  delayMs = SAVE_DELAY_MS,
}: TextDocumentEditorOptions<E, R>): TextDocumentEditor<R> {
  const [buffer, setBuffer] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt<R> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /** The file a save in flight is writing to, so a late answer knows it moved. */
  const writingTo = useRef(file);

  /* Reloaded when the file changes rather than when its text does, so a
     background refetch cannot swallow what the author has typed since. */
  useEffect(() => {
    writingTo.current = file;
    setBuffer(null);
    setAttempt(null);
    setIsSaving(false);
  }, [file]);

  const text = buffer ?? saved ?? "";
  const isRead = saved !== undefined;
  const differs = isRead && buffer !== null && buffer !== (saved ?? "");
  const settled = buffer !== null && buffer === attempt?.text;

  const performSave = () => {
    if (buffer === null) return;
    const attempted = buffer;
    const from = file;

    /* A save that answers for a file the buffer has left changes nothing. The
       effect above has already cleared the state it would have written. */
    const settle = (next: Attempt<R>) => {
      if (writingTo.current !== from) return;
      setAttempt(next);
      setIsSaving(false);
    };

    const refused = (error: E): Attempt<R> => {
      /* The caller's reading of an error is not allowed to strand the buffer,
         so anything it throws on is a plain failure. */
      try {
        const reason = refusalOf?.(error) ?? null;
        if (reason !== null) return { outcome: "refused", text: attempted, reason };
      } catch {
        /* falls through to the failure below */
      }
      return { outcome: "failed", text: attempted };
    };

    setIsSaving(true);
    try {
      save(attempted).then(
        () => settle({ outcome: "written", text: attempted }),
        (error: E) => settle(refused(error)),
      );
    } catch {
      settle({ outcome: "failed", text: attempted });
    }
  };

  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  /* `buffer` is a dependency so that every keystroke restarts the wait, which
     is what makes a burst of typing one save. */
  useEffect(() => {
    if (!differs || isSaving || settled) return;

    const timer = setTimeout(() => performSaveRef.current(), delayMs);
    return () => clearTimeout(timer);
  }, [differs, isSaving, settled, buffer, delayMs]);

  const refusal = settled && attempt.outcome === "refused" ? attempt.reason : null;

  function saveStateOf(): TextSaveState {
    if (!differs) return "clean";
    if (isSaving) return "saving";
    if (refusal !== null) return "blocked";
    if (settled && attempt.outcome === "failed") return "failed";
    if (settled) return "clean";
    return "pending";
  }

  return {
    text,
    setText: (next) => {
      if (isRead) setBuffer(next);
    },
    saveState: saveStateOf(),
    refusal,
    saveNow: () => {
      if (differs && !isSaving) performSaveRef.current();
    },
  };
}
