import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import type { IgnoreMatch } from "@/lib/tauri";

import { ignoreRuleMutations, projectQueries } from "../api";
import { useProjectContext } from "../components/ProjectContext";
import { ignoreRulesDocument } from "../documents/contentDocument";
import { useOpenDocument, useRevealIgnoreLine } from "../state";
import { appendIgnoreLine, removeIgnoreLine } from "./ignoreLine";

/** The root file, as a rule names the file it came from. */
const ROOT_FILE = ".modignore";

/** What a written line leaves out, as the toast reads it back. */
export type RuleSubject = "file" | "folder" | "extension";

/**
 * The row menu's writes against the project's root `.modignore`.
 *
 * Every action writes that one file whatever the row's depth or layer, the way
 * GitHub Desktop always writes the repository root's `.gitignore` - per
 * "Ignore rules" in docs/ux/PROJECT_EDITOR.md.
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
      const at = !rule || rule.source === ROOT_FILE ? undefined : rule.source;
      const document = ignoreRulesDocument(at);
      openDocument(document);
      if (rule?.line != null) revealLine(document.id, rule.line);
    },
    [openDocument, revealLine],
  );

  const undo = useCallback(
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
        title: line,
        description: describe(line, subject),
        actions: [
          { label: m.workshop_ignore_undo_action(), onClick: () => void undo(line) },
          { label: m.workshop_ignore_open_rules_action(), onClick: () => openRules() },
        ],
      });
    },
    [write, rootText, toast, undo, openRules],
  );

  /** Take `line` back out of the root rules, which a row's own line can be. */
  const stopIgnoring = useCallback(
    async (line: string) => {
      await write(removeIgnoreLine(await rootText(), line));
    },
    [write, rootText],
  );

  return { ignore, stopIgnoring, openRules };
}

/** One sentence for what `line` now leaves out. */
function describe(line: string, subject: RuleSubject): string {
  if (subject === "extension") return m.workshop_ignore_wrote_extension_description({ line });
  if (subject === "folder") return m.workshop_ignore_wrote_folder_description();
  return m.workshop_ignore_wrote_file_description();
}
