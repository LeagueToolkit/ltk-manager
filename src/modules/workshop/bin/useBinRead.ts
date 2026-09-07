import { useQueries, type UseQueryOptions } from "@tanstack/react-query";

import { api, type AppError, type BinDocumentId, type BinRows } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { PAGE_SIZE, splitKey } from "./binRows";

/**
 * How many rows one projected read answers, past which the backend refuses it.
 *
 * `READ_ROW_CAP` in `crates/ltk-manager-core/src/bin_document.rs`. A caller batches
 * under it here, so the refusal is the guard rather than the path a reader meets.
 */
export const READ_ROW_CAP = 2000;

/** One node a projected read wants. */
export interface ReadRequest {
  /** The node's key, its entry and its wire path, as `rowKey` writes one. */
  readonly key: string;
  /** How many rows sit under it, which the row asking for them already carries. */
  readonly rows: number;
}

/** One call: the entry the paths are under, and the paths in the order asked. */
export interface ReadBatch {
  readonly entry: string;
  readonly paths: readonly string[];
}

/**
 * `requests` cut into calls, each over one entry and each under the row cap.
 *
 * Sorted by key, which groups an entry's paths together and drops a key asked for
 * twice. A path answers one page at most, so its cost is the smaller of the two.
 */
export function readBatches(requests: readonly ReadRequest[]): ReadBatch[] {
  const wanted = new Map<string, number>();
  for (const request of requests) wanted.set(request.key, request.rows);

  const open: { entry: string; paths: string[]; rows: number }[] = [];
  for (const key of [...wanted.keys()].sort()) {
    const [entry, path] = splitKey(key);
    const cost = Math.min(wanted.get(key) ?? 0, PAGE_SIZE);
    const last = open.at(-1);
    if (last === undefined || last.entry !== entry || last.rows + cost > READ_ROW_CAP) {
      open.push({ entry, paths: [path], rows: cost });
      continue;
    }
    last.paths.push(path);
    last.rows += cost;
  }

  return open.map(({ entry, paths }) => ({ entry, paths }));
}

export const readKeys = {
  read: (document: BinDocumentId, entry: string, paths: readonly string[]) =>
    ["bin-read", document, entry, paths] as const,
};

type ReadQuery = UseQueryOptions<BinRows[], AppError, BinRows[], ReturnType<typeof readKeys.read>>;

/**
 * The rows under every requested node, by key, in as few calls as the cap allows.
 *
 * "The projected read" in docs/ux/BIN_EDITOR.md. A query is keyed on its batch's
 * paths, so a set that changes before an answer lands leaves that answer behind
 * rather than folding it in. A node whose call has not answered is absent.
 */
export function useBinRead(
  document: BinDocumentId,
  requests: readonly ReadRequest[],
): ReadonlyMap<string, BinRows> {
  const batches = readBatches(requests);
  const queries: ReadQuery[] = batches.map((batch) => ({
    queryKey: readKeys.read(document, batch.entry, batch.paths),
    queryFn: async () => unwrapForQuery(await api.binRead(document, batch.entry, batch.paths)),
    staleTime: Infinity,
    retry: false,
  }));
  const results = useQueries({ queries });

  const loaded = new Map<string, BinRows>();
  batches.forEach((batch, at) => {
    const answer = results[at]?.data;
    if (!answer) return;
    batch.paths.forEach((path, index) => {
      const page = answer[index];
      if (page) loaded.set(`${batch.entry}:${path}`, page);
    });
  });
  return loaded;
}
