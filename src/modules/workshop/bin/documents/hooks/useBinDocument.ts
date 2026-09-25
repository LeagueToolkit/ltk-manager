import {
  keepPreviousData,
  queryOptions,
  skipToken,
  useQueries,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  api,
  type AddableFields,
  type AppError,
  type AssetRef,
  type BinDocumentHandle,
  type BinDocumentId,
  type BinFindResult,
  type BinRow,
  type BinRows,
  type ClassChoice,
  type Declaring,
  type Dependency,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { assetKey } from "../../../preview/utils/assetRef";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { flushBinSave, isQueuedThrough } from "../../../state";
import { expectKind } from "../../shared/utils/expectKind";
import { type LoadedChildren, mergePages, PAGE_SIZE, splitKey } from "../../tree/utils/binRows";
import { useDeclarationsOn } from "./useDeclared";
import { registerReopen, sendOn } from "./useDocumentCall";

export type BinOpenState =
  | { readonly status: "opening" }
  | { readonly status: "open"; readonly handle: BinDocumentHandle }
  | { readonly status: "failed"; readonly error: AppError };

/**
 * When an unmounted caller's id is closed: at once, or after `LINGER_MS`.
 *
 * The backend drops a parsed tree with its last id, so a lingering id keeps the tree for
 * the next open of the same file, such as a tab that replaces this one with another object.
 */
export type BinRelease = "now" | "lingering";

/** How long a lingering id stays open past its caller. */
const LINGER_MS = 10_000;

/**
 * One asset held open as a bin document for as long as the caller is mounted.
 *
 * The open and the close are explicit over IPC (ADR-0026). `entry` narrows the open to
 * one object of the file (ADR-0028), `0x` and eight hex digits. `reopen` asks for a
 * fresh handle and keeps the old one on screen until it answers, and resolves with the
 * fresh id, or null where the open failed. A document the store evicted is reopened this way,
 * and every open id registers it, so `sendOn` reopens and resends a call the store refuses.
 *
 * A declared document follows the project's "Use game data declarations", and its handle's
 * `readOnly` is the gate the backend answers for it.
 */
export function useBinDocument(
  asset: AssetRef,
  entry: string | null = null,
  release: BinRelease = "now",
): { state: BinOpenState; reopen: () => Promise<BinDocumentId | null> } {
  /* A game chunk opened inside a project declares into it (ADR-0042). */
  const project = useOptionalProjectContext()?.path;
  const opened =
    asset.kind === "gameChunk" && project !== undefined ? { ...asset, project } : asset;
  const declarationProject = opened.kind === "gameChunk" ? opened.project : undefined;
  const key = `${declarationProject ?? ""}:${assetKey(asset)}:${entry ?? ""}`;
  const declaring: Declaring =
    useDeclarationsOn(declarationProject ?? undefined) === true ? "on" : "off";

  const latest = useRef({ asset: opened, entry, declaring });
  latest.current = { asset: opened, entry, declaring };

  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<BinOpenState>({ status: "opening" });
  const heldKey = useRef(key);
  /* The reopens waiting on the next open to land. */
  const waiting = useRef<((id: BinDocumentId | null) => void)[]>([]);
  /* Declared before the open's effect, so its cleanup has run by the time that one's does. */
  const unmounting = useRef(false);
  useEffect(
    () => () => {
      unmounting.current = true;
      for (const resolve of waiting.current) resolve(null);
      waiting.current = [];
    },
    [],
  );
  const lingers = useRef(release === "lingering");
  lingers.current = release === "lingering";

  /* Calls refused together share one open: a reopen already waiting takes the rest. */
  const reopen = useCallback(
    () =>
      new Promise<BinDocumentId | null>((resolve) => {
        const pending = waiting.current.length > 0;
        waiting.current.push(resolve);
        if (!pending) setGeneration((count) => count + 1);
      }),
    [],
  );

  /* Keyed by what the reference names. A new object for the same asset is not a reopen. */
  useEffect(() => {
    let live = true;
    let opened: BinDocumentId | null = null;
    let unregister = () => {};
    const same = heldKey.current === key;
    heldKey.current = key;
    setState((previous) => (same && previous.status === "open" ? previous : { status: "opening" }));

    void openGated(latest.current.asset, latest.current.entry, () => latest.current.declaring).then(
      (result) => {
        if (!live) {
          if (result.ok) void api.bin.close(result.value.document);
          return;
        }
        const settled = waiting.current;
        waiting.current = [];
        if (result.ok) {
          opened = result.value.document;
          unregister = registerReopen(opened, reopen);
          setState({ status: "open", handle: result.value });
          for (const resolve of settled) resolve(opened);
          return;
        }
        setState({ status: "failed", error: result.error });
        for (const resolve of settled) resolve(null);
      },
    );

    const held = assetKey(latest.current.asset);
    return () => {
      live = false;
      unregister();
      if (opened === null) return;
      const closing = opened;
      /* The last id over a tree takes its edits with it, so a queued save lands first. */
      if (isQueuedThrough(held, closing)) {
        void flushBinSave(held).finally(() => void api.bin.close(closing));
      } else if (unmounting.current && lingers.current) {
        setTimeout(() => void api.bin.close(closing), LINGER_MS);
      } else {
        void api.bin.close(closing);
      }
    };
  }, [key, generation, reopen]);

  const openId = state.status === "open" ? state.handle.document : null;
  const declared = state.status === "open" && Boolean(state.handle.declared);
  useEffect(() => {
    if (openId === null || !declared) return;

    void api.bin.setDeclaring(openId, declaring).then((result) => {
      if (!result.ok) {
        /* The reopen sets the gate again as it opens. */
        if (result.error.code === "BIN_NOT_OPEN") void reopen();
        return;
      }
      setState((previous) => {
        if (previous.status !== "open" || previous.handle.document !== openId) return previous;
        if (previous.handle.readOnly === result.value) return previous;

        return { status: "open", handle: { ...previous.handle, readOnly: result.value } };
      });
    });
  }, [declared, declaring, openId, reopen]);

  return { state, reopen };
}

/**
 * Open `asset`, and set a declared document's gate before the handle is drawn, so an open
 * with declarations on never draws read-only first. `declaring` is read once the open lands.
 */
async function openGated(
  asset: AssetRef,
  entry: string | null,
  declaring: () => Declaring,
): Promise<Awaited<ReturnType<typeof api.bin.open>>> {
  const opened = await api.bin.open(asset, entry);
  if (!opened.ok || !opened.value.declared) return opened;

  const gate = await api.bin.setDeclaring(opened.value.document, declaring());
  if (!gate.ok) return opened;

  return { ok: true, value: { ...opened.value, readOnly: gate.value } };
}

export const binKeys = {
  children: (document: BinDocumentId, key: string, page: number) =>
    ["bin-children", document, key, page] as const,
};

/** What a search of an open bin is asked over: the id, and the object an object tab is over. */
export interface FindScope {
  readonly document: BinDocumentId;
  readonly entry: string | null;
}

/** Every row under one node, which is what an object open reads at depth zero. */
const WHOLE = Number.MAX_SAFE_INTEGER;

export const binQueries = {
  /** A file's rows at depth zero, standing on what the open answered until an edit. */
  fileRoots: (document: BinDocumentId, opened: readonly BinRow[]) =>
    queryOptions<readonly BinRow[], AppError>({
      queryKey: ["bin-file-roots", document],
      queryFn: async () => unwrapForQuery((await sendOn(document, api.bin.roots)).result),
      initialData: opened,
      staleTime: Infinity,
      retry: false,
    }),
  /** A file's header dependencies, standing on what the open answered until an edit. */
  dependencies: (document: BinDocumentId, opened: readonly Dependency[]) =>
    queryOptions<readonly Dependency[], AppError>({
      queryKey: ["bin-dependencies", document],
      queryFn: async () => unwrapForQuery((await sendOn(document, api.bin.dependencies)).result),
      initialData: opened,
      staleTime: Infinity,
      retry: false,
    }),
  /** The rows of an open bin whose name or value holds `query`. No scope asks nothing. */
  find: (scope: FindScope | null, query: string) =>
    queryOptions<BinFindResult, AppError>({
      queryKey: ["bin-find", scope?.document ?? null, scope?.entry ?? null, query],
      queryFn:
        scope === null || query.length === 0
          ? skipToken
          : async () => unwrapForQuery(await api.bin.find(scope.document, scope.entry, query)),
      placeholderData: keepPreviousData,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  /** The fields a holder can take, asked again after every edit. */
  addable: (document: BinDocumentId, entry: string, path: string) =>
    queryOptions<AddableFields, AppError>({
      queryKey: ["bin-addable", document, entry, path],
      queryFn: async () => {
        const { result: answer } = await sendOn(document, (id) =>
          api.bin.choices(id, { kind: "addableFields", entry, path }),
        );
        return unwrapForQuery(expectKind(answer, "fields")).fields;
      },
      staleTime: Infinity,
      retry: false,
    }),
  /** The classes an item, an option or a pointer at `path` can hold, asked again after every edit. */
  itemClasses: (document: BinDocumentId, entry: string, path: string) =>
    queryOptions<ClassChoice[], AppError>({
      queryKey: ["bin-item-classes", document, entry, path],
      queryFn: async () => {
        const { result: answer } = await sendOn(document, (id) =>
          api.bin.choices(id, { kind: "itemClasses", entry, path }),
        );
        return unwrapForQuery(expectKind(answer, "classes")).classes;
      },
      staleTime: Infinity,
      retry: false,
    }),
  /** The classes a new object can take: the ones the file holds, then every class the schema knows. */
  objectClasses: (document: BinDocumentId) =>
    queryOptions<ClassChoice[], AppError>({
      queryKey: ["bin-object-classes", document],
      queryFn: async () => {
        const { result: answer } = await sendOn(document, (id) =>
          api.bin.choices(id, { kind: "objectClasses" }),
        );
        return unwrapForQuery(expectKind(answer, "classes")).classes;
      },
      staleTime: Infinity,
      retry: false,
    }),
  /** An object's properties at depth zero, standing on what the open answered until an edit. */
  roots: (document: BinDocumentId, entry: string, opened: readonly BinRow[]) =>
    queryOptions<readonly BinRow[], AppError>({
      queryKey: ["bin-roots", document, entry],
      queryFn: async () =>
        unwrapForQuery(
          (await sendOn(document, (id) => api.bin.children(id, entry, "", 0, WHOLE))).result,
        ).rows,
      initialData: opened,
      staleTime: Infinity,
      retry: false,
    }),
};

/** The dependencies a file open pins over its rows, read again after an edit. */
export function useFileDependencies(handle: BinDocumentHandle): readonly Dependency[] {
  return useQuery(binQueries.dependencies(handle.document, handle.header.dependencies)).data;
}

/** The rows a file open draws at depth zero, read again after an edit. */
export function useFileRoots(handle: BinDocumentHandle): readonly BinRow[] {
  return useQuery(binQueries.fileRoots(handle.document, handle.rows)).data;
}

/**
 * The properties an object open draws at depth zero, read again after an edit.
 *
 * The open's own answer stands until then, so the first draw costs no call.
 */
export function useObjectRoots(handle: BinDocumentHandle): readonly BinRow[] {
  const entry = handle.object?.entry ?? "";
  return useQuery(binQueries.roots(handle.document, entry, handle.rows)).data;
}

/** One expanded node, and how many pages of it the list wants. */
export interface ChildrenRequest {
  readonly key: string;
  readonly pages: number;
}

/** What the queries answered for every expanded node, and whether the document is gone. */
export interface BinChildren {
  readonly loaded: ReadonlyMap<string, LoadedChildren>;
  /** The backend holds no document with this id. The caller reopens it. */
  readonly notOpen: boolean;
}

type ChildrenQuery = UseQueryOptions<
  BinRows,
  AppError,
  BinRows,
  ReturnType<typeof binKeys.children>
>;

/**
 * The children of every expanded node, one query per page, merged per node.
 *
 * A page that has not answered ends the node's rows at the page before it, and the
 * node reads as pending. The queries never go stale. A reopen changes the document id
 * and with it every key.
 */
export function useBinChildren(
  document: BinDocumentId,
  requests: readonly ChildrenRequest[],
): BinChildren {
  const queries: ChildrenQuery[] = requests.flatMap((request) => {
    const [entry, path] = splitKey(request.key);
    return Array.from({ length: request.pages }, (_, page) => ({
      queryKey: binKeys.children(document, request.key, page),
      queryFn: async () =>
        unwrapForQuery(await api.bin.children(document, entry, path, page * PAGE_SIZE, PAGE_SIZE)),
      staleTime: Infinity,
      retry: false,
    }));
  });
  const results = useQueries({ queries });

  const loaded = new Map<string, LoadedChildren>();
  let notOpen = false;
  let at = 0;
  for (const request of requests) {
    const merged = mergePages(results.slice(at, at + request.pages));
    at += request.pages;
    if (!merged) continue;
    loaded.set(request.key, merged);
    if (merged.error?.code === "BIN_NOT_OPEN") notOpen = true;
  }

  return { loaded, notOpen };
}
