import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { AppError, WorkshopError } from "@/lib/tauri";

import { ignoreRuleMutations, projectQueries } from "../api";
import { useProjectContext } from "../components/ProjectContext";

/* The strings editor's delay, because the two documents autosave alike and a
   creator who moves between them should not meet two rhythms. */
const SAVE_DELAY_MS = 600;

/** What the save state of the rules document is. */
export type IgnoreSaveState = "clean" | "pending" | "saving" | "blocked" | "failed";

/** The line the matcher refused, as the gutter and the footer read it. */
export type IgnoreRuleProblem = Extract<WorkshopError, { kind: "IGNORE_RULE_PATTERN" }>;

/** The line a save was refused over, or null for any other failure. */
function problemOf(error: AppError | null): IgnoreRuleProblem | null {
  if (error?.code !== "WORKSHOP") return null;
  if (error.error.kind !== "IGNORE_RULE_PATTERN") return null;
  return error.error;
}

/**
 * The project's `.modignore` as an editable buffer, saving itself back.
 *
 * Every settled edit autosaves after a short debounce, following the strings
 * document. A pattern the matcher refuses is what `problem` names, and the
 * backend is the only thing that can say so, which is why a blocked buffer is
 * a rejected save rather than a check this side ran first.
 */
export function useIgnoreRulesEditor(at: string | null) {
  const project = useProjectContext();
  const client = useQueryClient();

  const rules = useQuery(projectQueries.ignoreRules(project.path, at));
  const save = useMutation(ignoreRuleMutations.save(client));
  const addRecommended = useMutation(ignoreRuleMutations.addRecommended(client));

  const [buffer, setBuffer] = useState<string | null>(null);
  /** The buffer a save rejected, so a refusal is reported once, not looped over. */
  const [refused, setRefused] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const saved = rules.data?.text ?? null;

  /* Reloaded when the file changes rather than when the query answers, so a
     focus refetch cannot swallow what the author has typed since. */
  useEffect(() => {
    setBuffer(null);
    setRefused(null);
    setFailed(null);
  }, [project.path, at]);

  const text = buffer ?? saved ?? "";
  const differs = buffer !== null && buffer !== (saved ?? "");

  const performSave = () => {
    if (buffer === null) return;
    const attempted = buffer;
    save.mutate(
      { projectPath: project.path, at, text: attempted },
      {
        onSuccess: () => {
          setRefused(null);
          setFailed(null);
        },
        onError: (error) => {
          if (problemOf(error)) setRefused(attempted);
          else setFailed(attempted);
        },
      },
    );
  };

  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  useEffect(() => {
    if (!differs || save.isPending) return;
    /* A refused buffer schedules nothing more. The next edit is what asks
       again, so a pattern the matcher will never take cannot loop. */
    if (buffer === refused || buffer === failed) return;

    const timer = setTimeout(() => performSaveRef.current(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [differs, save.isPending, buffer, refused, failed]);

  const problem = buffer === refused ? problemOf(save.error) : null;

  function saveStateOf(): IgnoreSaveState {
    if (!differs) return "clean";
    if (save.isPending) return "saving";
    if (problem) return "blocked";
    if (buffer === failed) return "failed";
    return "pending";
  }

  return {
    /** Whether the project has a file at all. The empty state turns on this. */
    exists: saved !== null,
    text,
    setText: setBuffer,
    missingRecommended: rules.data?.missingRecommended ?? [],
    isLoading: rules.isLoading,
    problem,
    saveState: saveStateOf(),
    saveNow: () => {
      if (differs && !save.isPending) performSaveRef.current();
    },
    addRecommended: () => {
      setBuffer(null);
      addRecommended.mutate(project.path);
    },
    isAdding: addRecommended.isPending,
  };
}
