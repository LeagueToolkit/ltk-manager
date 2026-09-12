import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AppError, WorkshopError } from "@/lib/tauri";
import { useTextDocumentEditor } from "@/modules/editor";

import { ignoreRuleMutations, projectQueries } from "../api";
import { useProjectContext } from "../components/ProjectContext";

/** The line the matcher refused, as the gutter and the footer read it. */
export type IgnoreRuleProblem = Extract<WorkshopError, { kind: "IGNORE_RULE_PATTERN" }>;

/**
 * The line a save was refused over, or null for any other failure.
 *
 * A transport that fails before a command answers rejects with something that
 * is not an `AppError` at all, so the shape is checked rather than assumed.
 */
function problemOf(error: AppError | null | undefined): IgnoreRuleProblem | null {
  if (error?.code !== "WORKSHOP") return null;
  if (error.error.kind !== "IGNORE_RULE_PATTERN") return null;
  return error.error;
}

/**
 * The project's `.modignore` as an editable buffer, saving itself back.
 *
 * A pattern the matcher refuses is what `problem` names, and the backend is
 * the only thing that can say so, which is why a blocked buffer is a rejected
 * save rather than a check this side ran first.
 */
export function useIgnoreRulesEditor(at: string | null) {
  const project = useProjectContext();
  const client = useQueryClient();

  const rules = useQuery(projectQueries.ignoreRules(project.path, at));
  const save = useMutation(ignoreRuleMutations.save(client));
  const addRecommended = useMutation(ignoreRuleMutations.addRecommended(client));

  const editor = useTextDocumentEditor<AppError, IgnoreRuleProblem>({
    saved: rules.data ? rules.data.text : undefined,
    file: JSON.stringify([project.path, at]),
    save: (text) => save.mutateAsync({ projectPath: project.path, at, text }),
    refusalOf: problemOf,
  });

  return {
    /** Whether the project has a file at all. The empty state turns on this. */
    exists: (rules.data?.text ?? null) !== null,
    text: editor.text,
    setText: editor.setText,
    missingRecommended: rules.data?.missingRecommended ?? [],
    isLoading: rules.isLoading,
    problem: editor.refusal,
    saveState: editor.saveState,
    saveNow: editor.saveNow,
    addRecommended: () => {
      editor.setText(null);
      addRecommended.mutate(project.path);
    },
    isAdding: addRecommended.isPending,
  };
}
