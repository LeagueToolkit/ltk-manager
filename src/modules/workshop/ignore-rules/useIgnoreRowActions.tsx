import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { Code, useToast } from "@/components";
import { m } from "@/i18n";
import type { IgnoreMatch } from "@/lib/tauri";

import { ignoreRuleMutations, projectQueries } from "../api";
import { useProjectContext } from "../components/ProjectContext";
import { ignoreRulesDocument } from "../documents/contentDocument";
import { useOpenDocument, useRevealIgnoreLine } from "../state";
import { appendIgnoreLine, MODIGNORE_FILE_NAME, removeIgnoreLine } from "./ignoreLine";

/** What a written line leaves out, as the toast reads it back. */
export type RuleSubject = "file" | "folder" | "extension";

/**
 * The row menu's writes against the project's root `.modignore`.
 *
 * Per "Ignore rules" in docs/ux/PROJECT_EDITOR.md.
 */
export function useIgnoreRowActions() {
  const project = useProjectContext();
  const projectPath = project.path;
  const client = useQueryClient();
  const { mutateAsync: saveRules } = useMutation(ignoreRuleMutations.save(client));
  const { toast } = useToast();
  const openDocument = useOpenDocument();
  const revealLine = useRevealIgnoreLine();

  /* Fetched rather than read off the cache, so a file edited in the document or
     outside the app is the one the line lands under. */
  const rootText = useCallback(
    async () => (await client.fetchQuery(projectQueries.ignoreRules(projectPath, null))).text ?? "",
    [client, projectPath],
  );

  const write = useCallback(
    (text: string) => saveRules({ projectPath, at: null, text }),
    [saveRules, projectPath],
  );

  const openRules = useCallback(
    (rule?: IgnoreMatch) => {
      const at = !rule || rule.source === MODIGNORE_FILE_NAME ? undefined : rule.source;
      const document = ignoreRulesDocument(at);
      openDocument(document);
      if (rule?.line != null) revealLine(document.id, rule.line);
    },
    [openDocument, revealLine],
  );

  /** Take `line` back out of the root rules, which is also what Undo does. */
  const stopIgnoring = useCallback(
    async (line: string) => {
      await write(removeIgnoreLine(await rootText(), line));
    },
    [write, rootText],
  );

  /** Write `line` under the root rules, and report what it now leaves out. */
  const ignore = useCallback(
    async (line: string, subject: RuleSubject) => {
      await write(appendIgnoreLine(await rootText(), line));

      toast({
        title: m.workshop_ignore_wrote_title(),
        /* The chip is the syntax lesson and the sentence is what makes it
           stick - per "Ignore rules" in docs/ux/PROJECT_EDITOR.md. */
        description: (
          <>
            <Code>{line}</Code> {describe(line, subject)}
          </>
        ),
        actions: [
          { label: m.workshop_ignore_undo_action(), onClick: () => void stopIgnoring(line) },
          { label: m.workshop_ignore_open_rules_action(), onClick: () => openRules() },
        ],
      });
    },
    [write, rootText, toast, stopIgnoring, openRules],
  );

  return { ignore, stopIgnoring, openRules };
}

/** One sentence for what a written line leaves out. */
function describe(line: string, subject: RuleSubject): string {
  if (subject === "extension") {
    /* The sentence names the extension, where the chip beside it carries the
       `*` that makes the line a pattern. */
    return m.workshop_ignore_wrote_extension_description({ extension: line.replace("*", "") });
  }
  if (subject === "folder") return m.workshop_ignore_wrote_folder_description();
  return m.workshop_ignore_wrote_file_description();
}
