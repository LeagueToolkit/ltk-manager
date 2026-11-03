import { type RefObject, useRef } from "react";

import { type KeyHandlers, useKeys } from "@/modules/keys";

import { SKIN_KEYS, type SkinKeyTarget, SOCKET_KEYS } from "../utils/skinKeys";

const KEYS = [...Object.values(SKIN_KEYS), ...Object.values(SOCKET_KEYS)];

/**
 * Answers the keys of `SKIN_KEYS` and `SOCKET_KEYS` while focus is inside the box the returned ref is on.
 *
 * The box contains the preview and its transport, and takes focus, so a click on bare preview
 * arms the keys and a press on a transport control keeps them.
 */
export function useSkinKeys(target: SkinKeyTarget): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const handlers: KeyHandlers = Object.fromEntries(
    KEYS.map((key) => [key.command, () => key.run(target)]),
  );

  useKeys("document:skin", handlers, { ref });

  return ref;
}
