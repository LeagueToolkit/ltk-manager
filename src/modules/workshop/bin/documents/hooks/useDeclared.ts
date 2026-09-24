import { queryOptions, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo } from "react";

import { useToast } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { errorSummary, m } from "@/i18n";
import {
  api,
  type AppError,
  type BinDocumentId,
  type DeclaredDiagnostic,
  type DeclaredMark,
  type DeclaredModuleChoice,
  type DeclaredState,
  type LinkChange,
  type ModuleAction,
  type ObjectChange,
  type RowDeclaration,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { useProjectContentTree } from "../../../content/api/useProjectContentTree";
import {
  type SelectedModule,
  useSelectedModule,
  useSelectModule,
  useUseDeclarationsChoice,
} from "../../../state";
import { expectKind } from "../../shared/utils/expectKind";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { rowKey } from "../../tree/utils/binRows";
import { declarationsOn } from "../utils/declarationsOn";
import {
  choiceFor,
  followModuleAction,
  type ModuleSync,
  moduleSync,
} from "../utils/declaredModule";
import { sendOn, useDocumentCall } from "./useDocumentCall";

/** The query root of a document's declared state, which every edit leaves stale. */
export const DECLARED_ROOT = ["bin-declared"] as const;

const declaredQuery = (document: BinDocumentId) =>
  queryOptions<DeclaredState | null, AppError>({
    queryKey: [...DECLARED_ROOT, document],
    queryFn: async () => unwrapForQuery((await sendOn(document, api.bin.declared)).result),
    staleTime: Infinity,
    retry: false,
  });

const rowDeclarationQuery = (document: BinDocumentId | null, entry: string, path: string) =>
  queryOptions<RowDeclaration, AppError>({
    queryKey: ["bin-row-declaration", document, entry, path],
    queryFn:
      document === null
        ? skipToken
        : async () =>
            unwrapForQuery(
              (await sendOn(document, (id) => api.bin.rowDeclaration(id, entry, path))).result,
            ),
    staleTime: 0,
    retry: false,
  });

/**
 * The row as the declaration and the reference an author writes, or null while unanswered.
 * An empty path is the object itself.
 */
export function useRowDeclaration(
  document: BinDocumentId | null,
  entry: string,
  path: string,
): RowDeclaration | null {
  return useQuery(rowDeclarationQuery(document, entry, path)).data ?? null;
}

/** Copy a row's declaration, saying how much of it is left as the game has it. */
export function useCopyDeclaration(): (declaration: RowDeclaration) => void {
  const copy = useCopyToClipboard();
  return (declaration) => {
    if (declaration.declaration === null) return;
    const left =
      declaration.skipped > 0
        ? m.workshop_bin_declaration_skipped_hint({ count: declaration.skipped })
        : undefined;
    void copy(declaration.declaration, m.workshop_bin_declaration_label(), left);
  };
}

/**
 * What a declared document says beside its rows, or null for a document that declares
 * nothing. "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.
 */
export function useDeclaredState(document: BinDocumentId): DeclaredState | null {
  return useQuery(declaredQuery(document)).data ?? null;
}

/**
 * The project's "Use game data declarations", null outside a project and while its default
 * is unread. The default reads the content scan only while the project has made no choice.
 */
export function useDeclarationsOn(projectPath: string | undefined): boolean | null {
  const choice = useUseDeclarationsChoice(projectPath);
  const tree = useProjectContentTree(choice === undefined ? projectPath : undefined).data;
  if (projectPath === undefined) return null;

  return declarationsOn(choice, tree);
}

/**
 * Keep the document on the project's selected layer and module, while the layer is one the
 * document can write to. A module the document made or lost goes back to the store.
 */
export function useDeclareInto(
  document: BinDocumentId,
  declared: DeclaredState | null,
  preferred: string | null,
  selected: SelectedModule | null,
): void {
  const queryClient = useQueryClient();
  const selectModule = useSelectModule();
  const call = useDocumentCall(document);
  const declareInto = useCallback(
    (layer: string, module: DeclaredModuleChoice) => {
      void call((id) => api.bin.declareInto(id, layer, module)).then(({ result, id }) => {
        if (result.ok) queryClient.setQueryData(declaredQuery(id).queryKey, result.value);
      });
    },
    [call, queryClient],
  );

  const layer = declared?.layer ?? null;
  const switches =
    preferred !== null && layer !== null && preferred !== layer
      ? (declared?.layers.includes(preferred) ?? false)
      : false;
  const target = switches ? preferred : layer;
  /* A string, so an effect keyed on it runs once per step rather than once per render. */
  const step = JSON.stringify(
    switches && preferred !== null
      ? ({ kind: "send", choice: choiceFor(selected, preferred) } satisfies ModuleSync)
      : declared === null
        ? ({ kind: "none" } satisfies ModuleSync)
        : moduleSync(declared, selected),
  );

  useEffect(() => {
    const next = JSON.parse(step) as ModuleSync;
    if (target === null) return;
    if (next.kind === "send") declareInto(target, next.choice);
    if (next.kind === "store") selectModule(next.selected);
  }, [declareInto, selectModule, step, target]);
}

/**
 * Apply a module action to `layer` through the document, which an undo reverts, keeping the
 * stored module on the module it named.
 */
export function useModuleAction(
  document: BinDocumentId,
): (layer: string, action: ModuleAction) => Promise<boolean> {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBinReads();
  const selected = useSelectedModule();
  const selectModule = useSelectModule();
  const toast = useToast();
  const call = useDocumentCall(document);

  return useCallback(
    async (layer, action) => {
      const before = queryClient.getQueryData(declaredQuery(document).queryKey)?.modules.length;
      const sent = await call((id) => api.bin.edit(id, { kind: "moduleAction", layer, action }));
      const result = expectKind(sent.result, "declared");
      if (!result.ok) {
        toast.error(m.workshop_bin_module_action_failed_title(), errorSummary(result.error));
        return false;
      }

      const removedSource =
        before !== undefined &&
        result.value.state.modules.length < before &&
        result.value.state.layer === layer;
      if (selected?.layer === layer) {
        selectModule(followModuleAction(selected, action, removedSource));
      }
      queryClient.setQueryData(declaredQuery(sent.id).queryKey, result.value.state);
      invalidate();
      return true;
    },
    [call, document, invalidate, queryClient, selectModule, selected, toast],
  );
}

/** The rows a declaration of the chosen layer touches, by row key, and that layer. */
export interface DeclaredRows {
  readonly layer: string;
  readonly marks: ReadonlyMap<string, DeclaredMark>;
  /** What the last apply reported, by the key of the row it names, or of its object. */
  readonly diagnostics: ReadonlyMap<string, readonly DeclaredDiagnostic[]>;
  /** The objects the chosen layer creates or removes, by entry. */
  readonly objects: ReadonlyMap<string, ObjectChange>;
  /** The dependencies the chosen layer adds or removes, by path lowercased. */
  readonly links: ReadonlyMap<string, LinkChange>;
  /** The document takes edits, false while declarations are off. */
  readonly editable: boolean;
}

/** The declared rows of the enclosing tree, or null for a tree that declares nothing. */
export const DeclaredRowsContext = createContext<DeclaredRows | null>(null);

/** The marks of the document by the key of the row each stands on. */
export function useDeclaredRows(document: BinDocumentId, editable: boolean): DeclaredRows | null {
  const declared = useDeclaredState(document);
  return useMemo(() => {
    if (declared === null) return null;
    return {
      layer: declared.layer,
      marks: new Map(declared.marks.map((mark) => [rowKey(mark), mark])),
      diagnostics: byRow(declared.diagnostics),
      objects: new Map(declared.objects.map((object) => [object.entry, object.change])),
      links: new Map(declared.links.map((link) => [link.path.toLowerCase(), link.change])),
      editable,
    };
  }, [declared, editable]);
}

const NO_DIAGNOSTICS: readonly DeclaredDiagnostic[] = [];

/** The diagnostics that name an object of the chunk, by the key of the row each names. */
function byRow(
  diagnostics: readonly DeclaredDiagnostic[],
): ReadonlyMap<string, readonly DeclaredDiagnostic[]> {
  const rows = new Map<string, DeclaredDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.entry.length === 0) continue;
    const key = rowKey(diagnostic);
    rows.set(key, [...(rows.get(key) ?? []), diagnostic]);
  }
  return rows;
}

/** What the last apply reported on the row under `key`. */
export function useRowDiagnostics(key: string): readonly DeclaredDiagnostic[] {
  return use(DeclaredRowsContext)?.diagnostics.get(key) ?? NO_DIAGNOSTICS;
}

/** Whether the enclosing tree is a declared document's, whose edits land as declarations. */
export function useDeclares(): boolean {
  return use(DeclaredRowsContext) !== null;
}

/** Whether the enclosing tree declares and takes edits, which declarations off stop. */
export function useDeclaresEdits(): boolean {
  return use(DeclaredRowsContext)?.editable === true;
}

/** The declaration standing on the row under `key` and its layer, or null where none does. */
export function useDeclaredMark(key: string): { mark: DeclaredMark; layer: string } | null {
  const rows = use(DeclaredRowsContext);
  const mark = rows?.marks.get(key);
  return rows && mark ? { mark, layer: rows.layer } : null;
}

/** What the chosen layer does to the object `entry` and that layer, or null where it does nothing. */
export function useDeclaredObject(entry: string): { change: ObjectChange; layer: string } | null {
  const rows = use(DeclaredRowsContext);
  const change = rows?.objects.get(entry);
  return rows && change ? { change, layer: rows.layer } : null;
}

/** What the chosen layer does to the dependency `path` and that layer, or null where it does nothing. */
export function useDeclaredLink(path: string): { change: LinkChange; layer: string } | null {
  const rows = use(DeclaredRowsContext);
  const change = rows?.links.get(path.toLowerCase());
  return rows && change ? { change, layer: rows.layer } : null;
}
