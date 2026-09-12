import { useEffect, useRef, useState } from "react";
import { Group, Panel } from "react-resizable-panels";

import { Button, Code, EmptyState, SegmentedControl, Spinner } from "@/components";
import { m } from "@/i18n";
import {
  DocumentToolbar,
  type EditorDocumentProps,
  SaveStatus,
  Seam,
  useNarrowToolbar,
} from "@/modules/editor";

import type { ContentDocumentOf } from "../documents/contentDocument";
import { useSetDocumentDirty } from "../state";
import { MarkdownView } from "./MarkdownView";
import { lacksTemplateSection, type TextFileKind, textFileKind } from "./textFileKind";
import { useProjectTextEditor } from "./useProjectTextEditor";

/** Which half a document too narrow to hold both is showing. */
type Half = "raw" | "preview";

/** One of the project's root text files as text, saving itself as edited. */
export function ProjectTextDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"text">>) {
  const kind = textFileKind(document.file);
  const editor = useProjectTextEditor(document.file);
  const setDocumentDirty = useSetDocumentDirty();
  const narrow = useNarrowToolbar();
  const [half, setHalf] = useState<Half>("raw");

  const documentId = document.id;
  /* Autosave keeps the document clean on its own, so dirty is reserved for
     what genuinely cannot persist, as it is in the ignore rules document. */
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

  const showsTemplate = kind.markdown && editor.exists && lacksTemplateSection(editor.text);

  return (
    <div
      data-ui="ProjectTextDocument"
      className="@container flex min-h-0 flex-1 flex-col bg-surface-950"
    >
      <DocumentToolbar active={active}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Code className="shrink-0">{kind.fileName}</Code>
          {showsTemplate && (
            <Button variant="ghost" size="xs" compact onClick={editor.insertTemplate}>
              {m.workshop_text_template_action()}
            </Button>
          )}
        </div>

        {kind.markdown && narrow && editor.exists && editor.readable && (
          <div>
            <SegmentedControl
              options={[
                { value: "raw" as const, label: m.workshop_text_raw_action() },
                { value: "preview" as const, label: m.workshop_text_preview_action() },
              ]}
              value={half}
              onChange={setHalf}
            />
          </div>
        )}

        <SaveStatus
          state={editor.saveState}
          blockedHint={m.workshop_text_conflict_hint()}
          onRetry={editor.saveNow}
        />
      </DocumentToolbar>

      <Body editor={editor} file={document.file} half={narrow ? half : null} />
    </div>
  );
}

type Editor = ReturnType<typeof useProjectTextEditor>;

interface BodyProps {
  editor: Editor;
  file: ContentDocumentOf<"text">["file"];
  /** The half on screen, or null where the document is wide enough for both. */
  half: Half | null;
}

function Body({ editor, file, half }: BodyProps) {
  const kind = textFileKind(file);

  if (editor.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!editor.readable) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          size="sm"
          title={m.workshop_text_unreadable_title()}
          description={m.workshop_text_unreadable_description({ file: kind.fileName })}
        />
      </div>
    );
  }

  if (!editor.exists) return <NoFile editor={editor} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {kind.markdown && <Split editor={editor} half={half} kind={kind} />}
        {!kind.markdown && <Buffer editor={editor} label={kind.title()} />}
      </div>
      {editor.conflict && <Conflict editor={editor} fileName={kind.fileName} />}
    </div>
  );
}

/**
 * The buffer beside the render, and one of them once neither fits.
 *
 * The halves scroll on their own. Tying them together needs a map from a line
 * to the node it drew, which the renderer does not give up cheaply, and a
 * sync that works for prose but not for a table reads worse than none.
 */
function Split({ editor, half, kind }: { editor: Editor; half: Half | null; kind: TextFileKind }) {
  if (half === "raw") return <Buffer editor={editor} label={kind.title()} />;
  if (half === "preview") return <Rendered editor={editor} kind={kind} />;

  return (
    <Group id="readme" orientation="horizontal" className="flex min-h-0 flex-1">
      <Panel id="raw" minSize={200} className="flex min-h-0 flex-col">
        <Buffer editor={editor} label={kind.title()} />
      </Panel>
      <Seam orientation="horizontal" variant="divider" />
      <Panel id="rendered" minSize={200} className="flex min-h-0 flex-col">
        <Rendered editor={editor} kind={kind} />
      </Panel>
    </Group>
  );
}

function Buffer({ editor, label }: { editor: Editor; label: string }) {
  return (
    <textarea
      value={editor.text}
      spellCheck
      aria-label={m.workshop_text_buffer_label({ title: label })}
      onChange={(event) => editor.setText(event.target.value)}
      /* DS-MONO-SIZE: prose is written where it is read, in the editor's mono. */
      className="min-h-0 min-w-0 flex-1 resize-none rounded-lg border border-surface-700 bg-surface-900 p-3 font-mono text-mono-row leading-relaxed text-surface-200 outline-none scrollbar-md"
    />
  );
}

function Rendered({ editor, kind }: { editor: Editor; kind: TextFileKind }) {
  return (
    <div
      aria-label={m.workshop_text_preview_label({ title: kind.title() })}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-3 scrollbar-md"
    >
      <MarkdownView text={editor.text} root={projectRootOf(editor.path)} />
    </div>
  );
}

/** The strip a file that moved under the buffer is answered from. */
function Conflict({ editor, fileName }: { editor: Editor; fileName: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-warning/40 px-3 py-1.5">
      <p className="min-w-0 flex-1 text-meta text-warning-text">
        {m.workshop_text_conflict_description({ file: fileName })}
      </p>
      <Button variant="ghost" size="xs" compact onClick={editor.reload}>
        {m.workshop_text_reload_action()}
      </Button>
      <Button variant="outline" size="xs" compact onClick={editor.keepMine}>
        {m.workshop_text_keep_mine_action()}
      </Button>
    </div>
  );
}

/** The offer a project with no readme gets, which writes nothing until taken. */
function NoFile({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        size="sm"
        title={m.workshop_readme_empty_title()}
        description={m.workshop_readme_empty_description()}
        action={
          <Button size="sm" onClick={editor.start}>
            {m.workshop_readme_write_action()}
          </Button>
        }
      />
    </div>
  );
}

/** The directory `path` sits in, for the images a render resolves. */
function projectRootOf(path: string | null): string | null {
  if (!path) return null;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? null : path.slice(0, cut);
}
