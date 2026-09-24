import { use } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { Result } from "@/utils/result";

import { useDeclaredLink, useDeclares } from "../../documents/hooks/useDeclared";
import { BinEditContext, type DependencyEdit } from "./useBinEdit";

/** The edits a dependency row takes, and what a declared document refuses of them. */
export interface DependencyAbilities {
  /** Null in a read-only tree. */
  readonly edit: DependencyEdit | null;
  /** Why rename, move and drag are refused, which only a layer bin takes. Null where offered. */
  readonly refusal: string | null;
  /** The chosen layer removes the dependency. ADR-0050. */
  readonly removed: boolean;
  /** The chosen layer adding or removing the dependency, or null where it does neither. */
  readonly layer: string | null;
}

/** What the dependency `path` of the enclosing tree takes. */
export function useDependencyAbilities(path: string): DependencyAbilities {
  const edit = use(BinEditContext)?.dependencies ?? null;
  const declares = useDeclares();
  const mark = useDeclaredLink(path);
  return {
    edit,
    refusal: declares ? m.workshop_bin_dependency_undeclarable_hint() : null,
    removed: mark?.change === "removed",
    layer: mark?.layer ?? null,
  };
}

/** Send a dependency edit from a menu or a key, reporting a refusal where no field can show it. */
export function useSendDependencyEdit(): (call: Promise<Result<unknown>>) => void {
  const toast = useToast();
  return (call) => {
    void call.then((result) => {
      if (!result.ok) {
        toast.error(m.workshop_bin_dependency_edit_failed_title(), errorSummary(result.error));
      }
    });
  };
}
