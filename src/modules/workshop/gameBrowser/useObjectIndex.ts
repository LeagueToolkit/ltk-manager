import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { api, type AppError } from "@/lib/tauri";
import { useSearchObjects } from "@/stores";
import { mutationFn } from "@/utils/query";

import { gameKeys } from "./keys";
import { objectIndexQueries } from "./queries";

const NO_OBJECTS = new Set<string>();

/**
 * One step of the index's lifecycle, after which every held object search is
 * asked again so a row that read "building" is replaced.
 */
function useObjectIndexStep(step: () => Promise<Awaited<ReturnType<typeof api.warmObjectIndex>>>) {
  const queryClient = useQueryClient();

  return useMutation<void, AppError, void>({
    mutationFn: mutationFn(step),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gameKeys.objectSearches });
    },
  });
}

/** Build the object index, unless one is built or building. */
export function useWarmObjectIndex() {
  return useObjectIndexStep(api.warmObjectIndex);
}

/** Drop the object index, so the bar stops answering for objects. */
export function useDropObjectIndex() {
  return useObjectIndexStep(api.dropObjectIndex);
}

/** The slot an answer of the object index reports it in. */
export type ObjectIndexSlot = "absent" | "building" | "failed" | "ready";

/**
 * Warm the index for a view whose answer reports it absent, and the retry that asks again.
 *
 * Once per absence: the poll behind the answer asks again until the build lands, and a
 * build the state is already running is asked for no second time.
 */
export function useWarmOnAbsent(slot: ObjectIndexSlot | undefined): () => void {
  const warm = useWarmObjectIndex();
  const warmMutate = warm.mutate;

  const asked = useRef(false);
  useEffect(() => {
    if (slot !== "absent") {
      asked.current = false;
      return;
    }
    if (asked.current) return;
    asked.current = true;
    warmMutate();
  }, [slot, warmMutate]);

  return useCallback(() => warmMutate(), [warmMutate]);
}

/**
 * Every declaration the install holds for each of `objectHashes`, in the slot the
 * index is in.
 *
 * Asked whatever the Objects switch says, and asked again each second while a build
 * runs. The answer is the install's for the session. A ready one never refetches on
 * its own, and a warm or a drop settling asks again.
 */
export function useObjectDeclarations(objectHashes: readonly string[]) {
  return useQuery(objectIndexQueries.declarations(objectHashes));
}

/**
 * Which of `objectHashes` the install's index declares, as a set.
 *
 * Empty while the switch is off or the index has not landed, and asked again
 * once a warm or a drop settles.
 */
export function useDeclaredObjects(objectHashes: readonly string[]): ReadonlySet<string> {
  const setting = useSearchObjects();
  const { data } = useObjectDeclarations(setting ? objectHashes : []);

  return useMemo(
    () => (data?.index.status === "ready" ? new Set(Object.keys(data.objects)) : NO_OBJECTS),
    [data],
  );
}

/**
 * Keep the object index in step with the Objects switch.
 *
 * Mounted once at the root: the index warms at startup while the switch is
 * on, warms when the switch is turned on, and drops when it is turned off. A
 * warm of an index that is built or building does nothing.
 */
export function useObjectIndexLifecycle() {
  const searchObjects = useSearchObjects();
  const warm = useWarmObjectIndex();
  const drop = useDropObjectIndex();
  const warmMutate = warm.mutate;
  const dropMutate = drop.mutate;

  /* Off at startup is nothing to drop, so the first run with the switch off
     is told apart from a turn-off. */
  const was = useRef<boolean | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = searchObjects;
    if (searchObjects) warmMutate();
    else if (before === true) dropMutate();
  }, [dropMutate, searchObjects, warmMutate]);
}
