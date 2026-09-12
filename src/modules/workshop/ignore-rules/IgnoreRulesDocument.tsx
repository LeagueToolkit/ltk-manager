import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { Button, Code, EmptyState, Spinner } from "@/components";
import { m } from "@/i18n";
import { DocumentToolbar, type EditorDocumentProps, SaveStatus } from "@/modules/editor";
import { twMerge } from "@/utils";

import { projectQueries } from "../api";
import type { ContentDocumentOf } from "../documents/contentDocument";
import {
  useIgnoreLineRevealRequest,
  useSetDocumentDirty,
  useSettleIgnoreLineReveal,
} from "../state";
import { MODIGNORE_FILE_NAME } from "./ignoreLine";
import { SyntaxBar } from "./SyntaxBar";
import { useIgnoreRulesEditor } from "./useIgnoreRulesEditor";

/** One `.modignore` of the project as text, saving itself as edited. */
export function IgnoreRulesDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"ignore-rules">>) {
  const at = document.at ?? null;
  const editor = useIgnoreRulesEditor(at);
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
          {/* Two rules documents carry the same title, so the path is what tells them apart. */}
          <Code className="shrink-0">{at ?? MODIGNORE_FILE_NAME}</Code>
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
        <SaveStatus
          state={editor.saveState}
          blockedHint={m.workshop_ignore_blocked_hint()}
          onRetry={editor.saveNow}
        />
      </DocumentToolbar>

      <Body editor={editor} documentId={documentId} at={at} />
    </div>
  );
}

type Editor = ReturnType<typeof useIgnoreRulesEditor>;

interface BodyProps {
  editor: Editor;
  documentId: string;
  /** The file's project-relative path, null for the project's root rules. */
  at: string | null;
}

function Body({ editor, documentId, at }: BodyProps) {
  if (editor.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  /* The default anchors to content/, so only the root file is offered it. A
     nested file that has gone missing is written back by typing in it. */
  if (!editor.exists && at === null) return <NoFile editor={editor} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Buffer editor={editor} documentId={documentId} />
      {editor.problem && (
        <p className="shrink-0 border-t border-danger/40 px-3 py-1.5 text-meta text-danger-text">
          {m.workshop_ignore_problem_hint({
            line: editor.problem.line,
            message: editor.problem.message,
          })}
        </p>
      )}
      <SyntaxBar />
    </div>
  );
}

/** The buffer, its line numbers, and the one number a refusal marks. */
function Buffer({ editor, documentId }: { editor: Editor; documentId: string }) {
  const lines = useMemo(() => editor.text.split("\n").length, [editor.text]);
  const gutter = useRef<HTMLDivElement>(null);
  const buffer = useRef<HTMLTextAreaElement>(null);

  const requested = useIgnoreLineRevealRequest(documentId);
  const settleReveal = useSettleIgnoreLineReveal();
  const text = editor.text;

  /* Answered against the text on screen, so a rule shown from the tree lands on
     its line rather than on whatever the buffer held before the file loaded. */
  useEffect(() => {
    const area = buffer.current;
    if (!requested || !area) return;

    const [from, to] = lineRange(text, requested.line);
    area.focus();
    area.setSelectionRange(from, to);
    settleReveal(requested.token);
  }, [requested, text, settleReveal]);

  return (
    /* DS-MONO-SIZE: mono end to end, so the tier is on the surface. */
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-950 font-mono text-mono-row">
      <div
        ref={gutter}
        aria-hidden
        className="shrink-0 overflow-hidden bg-surface-900/40 py-2 pr-2 pl-3 text-right leading-relaxed text-surface-500 select-none"
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
        ref={buffer}
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

/** Where one-based `line` starts and ends in `text`, as a selection. */
function lineRange(text: string, line: number): [number, number] {
  const lines = text.split("\n");
  const index = Math.min(Math.max(line, 1), lines.length) - 1;
  const from = lines.slice(0, index).reduce((total, held) => total + held.length + 1, 0);
  return [from, from + (lines[index]?.length ?? 0)];
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
