import { type RefObject, useEffect, useRef } from "react";

import { mountScope, nextSerial } from "../state/keyScopes";
import type { KeyHandler } from "../utils/dispatch";
import type { CommandId } from "../utils/registry";
import type { ScopeId } from "../utils/scopes";

/** The handlers of one scope instance, by command id. */
export type KeyHandlers = Partial<Record<CommandId, KeyHandler>>;

export interface KeysOptions {
  /** False keeps the instance mounted and answering nothing. Defaults to `true`. */
  readonly enabled?: boolean;
  /** The element that a press must come from. Absent answers presses from the whole page. */
  readonly ref?: RefObject<Element | null>;
}

/**
 * Answers the commands of `scope` with `handlers` while the component is mounted.
 *
 * One listener on the page runs a press through every mounted scope, narrowest first, and the
 * first command that takes it stops it there. `handlers` and `options` are read at the press, so
 * a fresh object per render costs nothing. Per "The dispatcher" in docs/ux/KEYS.md.
 */
export function useKeys(scope: ScopeId, handlers: KeyHandlers, options: KeysOptions = {}): void {
  const latest = useRef({ handlers, options });
  latest.current = { handlers, options };

  useEffect(
    () =>
      mountScope({
        scope,
        element: () => {
          const ref = latest.current.options.ref;

          return ref === undefined ? undefined : ref.current;
        },
        enabled: () => latest.current.options.enabled !== false,
        handler: (command) => latest.current.handlers[command as CommandId],
        serial: nextSerial(),
      }),
    [scope],
  );
}
