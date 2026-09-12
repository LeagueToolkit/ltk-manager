import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { Button, Code, EmptyState, Spinner } from "@/components";
import { m } from "@/i18n";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import { twMerge } from "@/utils";

import { projectQueries } from "../api";
import type { ContentDocumentOf } from "../documents/contentDocument";
import { useSetDocumentDirty } from "../state";
import { SyntaxRail } from "./SyntaxRail";
import { type IgnoreSaveState, useIgnoreRulesEditor } from "./useIgnoreRulesEditor";

/** The project's ignore rules as text, saving themselves as edited. */
export function IgnoreRulesDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"ignore-rules">>) {
  const editor = useIgnoreRulesEditor();
  const setDocumentDirty = useSetDocumentDirty();

  const documentId = document.id;
  /* Autosave keeps the document clean on its own, so dirty is reserved for
     what genuinely cannot persist, as it is in the strings document. */
  const unsaved = editor.saveState === "blocked" || editor.saveState === "failed";

  useEffect(() => {
    setDocumentDirty(documentId, unsaved);
  }, [documentId, unsaved, setDocumentDirty]);

  useEffect(() => {
    return () => setDocumentDirty(documentId, false);
  }, [documentId, setDocumentDirty]);

  const saveNow = useRef(editor.saveNow);
  useEffect(() => {
    saveNow.current = editor.saveNow;
  });

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() !== "s") return;

      event.preventDefault();
      saveNow.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  return (
    <div
      data-ui="IgnoreRulesDocument"
      className="@container flex min-h-0 flex-1 flex-col bg-surface-950"
    >
      <DocumentToolbar active={active}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Code className="shrink-0">.modignore</Code>
          {editor.missingRecommended.length > 0 && editor.exists && (
            <Button
              variant="ghost"
              size="xs"
              compact
              disabled={editor.isAdding}
              onClick={editor.addRecommended}
            >
              {m.workshop_ignore_add_recommended_action({
                count: editor.missingRecommended.length,
              })}
            </Button>
          )}
        </div>
        <SaveStatus state={editor.saveState} onRetry={editor.saveNow} />
      </DocumentToolbar>

      <Body editor={editor} />
    </div>
  );
}

type Editor = ReturnType<typeof useIgnoreRulesEditor>;

function Body({ editor }: { editor: Editor }) {
  if (editor.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!editor.exists) return <NoFile editor={editor} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <Buffer editor={editor} />
        <SyntaxRail />
      </div>
      {editor.problem && (
        <p className="shrink-0 border-t border-danger/40 px-3 py-1.5 text-meta text-danger-text">
          {m.workshop_ignore_problem_hint({
            line: editor.problem.line,
            message: editor.problem.message,
          })}
        </p>
      )}
    </div>
  );
}

/** The buffer, its line numbers, and the one number a refusal marks. */
function Buffer({ editor }: { editor: Editor }) {
  const lines = useMemo(() => editor.text.split("\n").length, [editor.text]);
  const gutter = useRef<HTMLDivElement>(null);

  return (
    /* DS-MONO-SIZE: mono end to end, so the tier is on the surface. */
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-surface-700 bg-surface-900 font-mono text-mono-row">
      <div
        ref={gutter}
        aria-hidden
        className="shrink-0 overflow-hidden bg-surface-950/40 py-2 pr-2 pl-3 text-right leading-relaxed text-surface-500 select-none"
      >
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={twMerge(
              editor.problem?.line === index + 1 && "font-medium text-danger-text",
            )}
          >
            {index + 1}
          </div>
        ))}
      </div>

      <textarea
        value={editor.text}
        spellCheck={false}
        aria-label={m.workshop_ignore_buffer_label()}
        onChange={(event) => editor.setText(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        className="min-w-0 flex-1 resize-none bg-transparent py-2 pr-2 pl-2 leading-relaxed text-surface-200 outline-none scrollbar-md"
      />
    </div>
  );
}

/**
 * What the button writes, behind the offer to write it.
 *
 * The default is drawn rather than described, so a creator reads the rules
 * before accepting them - per "Ignore rules" in docs/ux/PROJECT_EDITOR.md.
 */
function NoFile({ editor }: { editor: Editor }) {
  const recommended = useQuery(projectQueries.recommendedIgnoreRules());

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <pre
        aria-hidden
        className="h-full overflow-hidden p-3 font-mono text-mono-row leading-relaxed whitespace-pre text-surface-500 select-none"
      >
        {recommended.data ?? ""}
      </pre>

      <div className="absolute inset-0 flex items-center justify-center bg-surface-950/70 p-6">
        <EmptyState
          size="sm"
          title={m.workshop_ignore_empty_title()}
          description={m.workshop_ignore_empty_description()}
          action={
            <Button size="sm" disabled={editor.isAdding} onClick={editor.addRecommended}>
              {m.workshop_ignore_write_default_action()}
            </Button>
          }
        />
      </div>
    </div>
  );
}

interface SaveStatusProps {
  state: IgnoreSaveState;
  onRetry: () => void;
}

/* Quiet when clean, as in the strings document: saving is the document's job
   rather than an event, and only a held-back edit is worth a word. */
function SaveStatus({ state, onRetry }: SaveStatusProps) {
  if (state === "pending" || state === "saving") {
    return <Spinner size="sm" className="h-3 w-3 shrink-0" />;
  }

  if (state === "blocked") {
    /* DS-TEXT */
    return (
      <span className="shrink-0 text-[0.6875rem] text-warning-text select-none">
        {m.workshop_ignore_blocked_hint()}
      </span>
    );
  }

  if (state === "failed") {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        {/* DS-TEXT */}
        <span className="text-[0.6875rem] text-danger-text select-none">
          {m.workshop_ignore_save_failed_hint()}
        </span>
        <Button variant="ghost" size="xs" compact onClick={onRetry}>
          {m.workshop_ignore_retry_action()}
        </Button>
      </span>
    );
  }

  return null;
}
