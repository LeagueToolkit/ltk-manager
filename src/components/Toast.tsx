import { Toast as BaseToast, type ToastManager } from "@base-ui/react/toast";
import { XIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { describeError, errorMessage } from "@/i18n/errors";
import { m } from "@/paraglide/messages";
import { openGetHelp } from "@/stores/getHelp";
import { useNotificationsStore } from "@/stores/notifications";
import { twMerge } from "@/utils";
import { type ErrorDetails, errorDetails, isAppError } from "@/utils/errors";

import { focusRing } from "./focus";
import { ToastProgressBar, ToastTaskBar } from "./ToastBars";
import { ErrorDetailsBlock, ToastActionButton, ToastErrorActions } from "./ToastErrorDetails";
import { type ToastType } from "./toastType";
import { statusGlyph, type StatusTone, statusText } from "./tone";

/** How many toasts are on screen at once. */
export const MAX_TOASTS = 4;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  type?: ToastType;
  /** How long the toast counts down for. Without one it stays until it is dismissed. */
  timeout?: number;
  /** The notification center already holds this toast. */
  notified?: boolean;
  /** The actions under the description, in one row. */
  actions?: ToastAction[];
  /**
   * The facts of the backend error that the toast reports.
   *
   * A toast with them offers `Details`, and offers `Get help` beside it if the code is one
   * that the manager does not expect in normal use.
   */
  error?: ErrorDetails;
  /**
   * A mark of the toast's own, where the type's glyph is not the subject.
   *
   * Sized as the type glyphs are, `size-5`, and coloured by the caller. The
   * stripe and the countdown stay the type's either way, so the line is still
   * found as an info toast by everything except its mark.
   */
  icon?: ReactNode;
  /**
   * How far a running task has got, 0-100, in the countdown's place.
   *
   * A toast that stays until its work ends has no dismissal to count down, so
   * the strip along its bottom reports the work instead.
   */
  progress?: number;
}

export interface ToastOptions {
  /** Also record the toast in the notification center. Off by default. */
  notify?: boolean;
}

export interface FailureOptions extends ToastOptions {
  /** The text under the title. The error's own words without one. */
  description?: string;
}

/** A handle on a toast that stays open until the work behind it ends. */
export interface ToastTask {
  /** Move the strip along the bottom, and say what is happening now. */
  report: (percent: number, description: string) => void;
  close: () => void;
}

/**
 * The one manager every toast goes through, outside React.
 *
 * Base UI's `useToastManager` subscribes its caller to the list of toasts on
 * screen, so a hook built on it re-rendered every caller on every report of a
 * running task. Bound here, raising a toast subscribes to nothing.
 */
export const toastManager = heldUntilListened(BaseToast.createToastManager<ToastData>());

/**
 * Report a failure nothing else speaks for, from outside React.
 *
 * The data layer's last resort, so a mutation with no `onError` still reaches
 * the reader rather than the devtools alone. A `title` names the action that
 * failed, and the error's own title moves into the description when nothing
 * else would fill it.
 */
export function reportUnhandledFailure(error: unknown, title?: string): void {
  const copy = isAppError(error)
    ? describeError(error)
    : { title: m.common_action_failed_title(), detail: errorMessage(error) };
  const summary = copy.detail ?? copy.description;

  toastManager.add({
    title: title ?? copy.title,
    description: title === undefined ? summary : (summary ?? copy.title),
    data: { type: "error", error: isAppError(error) ? errorDetails(error) : undefined },
    timeout: 0,
  });
}

type LiveToast = BaseToast.Root.ToastObject<ToastData>;

/** Whether the toast dismisses itself once its countdown runs out. */
function isTimed(toast: LiveToast): boolean {
  return toast.data?.progress === undefined && (toast.data?.timeout ?? 0) > 0;
}

/**
 * The toast to close so that no more than `max` are on screen, or null while they fit.
 *
 * `toasts` is newest first, as the manager holds them. The newest is never the one closed.
 * The oldest timed toast goes first. Where every other toast stays until dismissed, the oldest
 * of those that is not a running task goes, and a task is never closed for room.
 */
export function toastToEvict(toasts: LiveToast[], max: number = MAX_TOASTS): LiveToast | null {
  const live = toasts.filter((toast) => toast.transitionStatus !== "ending");
  if (live.length <= max) return null;

  const oldestFirst = live.slice(1).reverse();
  const timed = oldestFirst.find(isTimed);
  if (timed) return timed;

  return oldestFirst.find((toast) => toast.data?.progress === undefined) ?? null;
}

/**
 * `manager`, holding what is raised before the provider listens.
 *
 * The provider subscribes from its own effect, and effects run children first,
 * so a toast raised from a mount effect under it would be emitted to nobody.
 * The launch announcement of what the sweep found is one.
 */
function heldUntilListened(manager: ToastManager<ToastData>): ToastManager<ToastData> {
  let listening = 0;
  let held: Array<() => void> = [];
  let raised = 0;
  const once = (raise: () => void) => {
    if (listening > 0) raise();
    else held.push(raise);
  };

  return {
    " subscribe": (listener) => {
      const unsubscribe = manager[" subscribe"](listener);
      listening += 1;
      const pending = held;
      held = [];
      pending.forEach((raise) => raise());
      return () => {
        unsubscribe();
        listening -= 1;
      };
    },
    add: (options) => {
      const id = options.id ?? `held-toast-${(raised += 1)}`;
      once(() => manager.add({ ...options, id }));
      return id;
    },
    close: (id) => once(() => manager.close(id)),
    update: (id, updates) => once(() => manager.update(id, updates)),
    promise: (value, options) => {
      if (listening > 0) return manager.promise(value, options);
      held.push(() => manager.promise(value, options));
      return value;
    },
  };
}

/** `toast.error` is the method's name, and `danger` the tone it draws in: DS-TONE. */
const typeTone: Record<ToastType, StatusTone> = {
  success: "success",
  error: "danger",
  warning: "warning",
  info: "info",
};

const typeStripeClasses: Record<ToastType, string> = {
  success: "border-l-success",
  error: "border-l-danger",
  warning: "border-l-warning",
  info: "border-l-info",
};

interface ToastItemProps {
  toast: LiveToast;
  /** The countdown holds, because the pointer or the focus is somewhere in the stack. */
  paused: boolean;
}

export function ToastItem({ toast, paused }: ToastItemProps) {
  const type = toast.data?.type ?? "info";
  const timeout = toast.data?.timeout ?? 0;
  const progress = toast.data?.progress;
  const tone = typeTone[type];
  const Glyph = statusGlyph[tone];
  const actions = toast.data?.actions ?? [];
  const details = toast.data?.error;
  const title = typeof toast.title === "string" ? toast.title : m.common_action_failed_title();
  const [expanded, setExpanded] = useState(false);

  function handleGetHelp(error: ErrorDetails) {
    openGetHelp({
      origin: {
        kind: "error",
        error: { title, code: error.code, kind: error.kind, ref: error.ref },
      },
    });
    toastManager.close(toast.id);
  }

  return (
    <BaseToast.Root
      toast={toast}
      className={twMerge(
        "relative flex w-full flex-col overflow-hidden rounded-md border border-l-[3px] shadow-lg backdrop-blur-sm",
        "border-surface-700 bg-surface-800/95",
        typeStripeClasses[type],
        "transition-[transform,opacity,max-height] duration-350 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "data-[swipe=move]:transition-none",
        "data-[swipe=cancel]:translate-x-0",
        "animate-toast-slide-in",
        "data-[ending-style]:translate-x-[40%] data-[ending-style]:opacity-0",
      )}
      style={{
        transform: `translateX(var(--toast-swipe-movement-x, 0))`,
      }}
    >
      <BaseToast.Content className="flex flex-1 items-start gap-3 p-4">
        <div className="mt-0.5 shrink-0">
          {toast.data?.icon ?? (
            <Glyph weight="duotone" className={twMerge("size-5", statusText[tone])} />
          )}
        </div>
        {/* DS-GAP */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <BaseToast.Title className="text-sm font-medium text-surface-100" />
          <BaseToast.Description className="text-sm text-surface-400" />
          {(actions.length > 0 || details) && (
            <div className="flex items-center gap-3">
              {actions.map((action) => (
                <ToastActionButton
                  key={action.label}
                  /* The action is the way out as much as the ✕ is: a toast still
                     sitting there is a press the reader has to make twice. */
                  onClick={() => {
                    action.onClick();
                    toastManager.close(toast.id);
                  }}
                >
                  {action.label}
                </ToastActionButton>
              ))}
              {details && (
                <ToastErrorActions
                  title={title}
                  details={details}
                  expanded={expanded}
                  onToggle={() => setExpanded((open) => !open)}
                  onGetHelp={() => handleGetHelp(details)}
                />
              )}
            </div>
          )}
          {details && expanded && <ErrorDetailsBlock details={details} />}
        </div>
        <BaseToast.Close
          /* DS-VEIL */
          className={twMerge(
            "shrink-0 cursor-pointer rounded-md p-1 text-surface-400 transition-colors hover:bg-surface-veil hover:text-surface-200",
            focusRing,
          )}
          aria-label={m.common_close_action()}
        >
          <XIcon weight="bold" className="size-4" />
        </BaseToast.Close>
      </BaseToast.Content>
      {progress === undefined && timeout > 0 && (
        <ToastProgressBar
          timeout={timeout}
          type={type}
          paused={paused}
          onExpire={() => toastManager.close(toast.id)}
        />
      )}
      {progress !== undefined && <ToastTaskBar value={progress} />}
    </BaseToast.Root>
  );
}

/**
 * Where every toast draws, newest first.
 *
 * The pointer or the focus anywhere in the stack holds every countdown, so reading one toast
 * does not cost the reader the others. No more than `MAX_TOASTS` show: a toast past that
 * closes an older one, by `toastToEvict`. An error closed for room is recorded in the
 * notification center, since the reader did not dismiss it.
 */
export function ToastViewport() {
  const toasts = BaseToast.useToastManager().toasts as LiveToast[];
  const addNotification = useNotificationsStore((s) => s.addNotification);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const evicted = toastToEvict(toasts);
    if (evicted === null) return;

    const recorded = evicted.data?.notified === true || isTimed(evicted);
    if (!recorded && typeof evicted.title === "string") {
      const description = typeof evicted.description === "string" ? evicted.description : undefined;
      addNotification({
        title: evicted.title,
        description,
        type: evicted.data?.type ?? "info",
        error: evicted.data?.error,
      });
    }

    toastManager.close(evicted.id);
  }, [toasts, addNotification]);

  return (
    <BaseToast.Viewport
      data-toast-viewport
      className="fixed right-4 bottom-4 z-[9999] flex w-full max-w-[420px] flex-col gap-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} paused={hovered || focused} />
      ))}
    </BaseToast.Viewport>
  );
}

/**
 * How long each type counts down for, in milliseconds.
 *
 * An error has no countdown. It stays until the reader dismisses it, since a failure read a
 * second too late is a failure nobody saw.
 */
const DEFAULT_TIMEOUT: Record<ToastType, number | undefined> = {
  success: 5000,
  info: 5000,
  warning: 6000,
  error: undefined,
};

/* Base UI's own timer is off for every toast (`timeout: 0`), so the countdown strip is the one
   thing that ends a toast, and what pauses it is what the reader sees pause. */
function raise(type: ToastType, title: string, description?: string, options?: ToastOptions) {
  return toastManager.add({
    title,
    description,
    data: { type, timeout: DEFAULT_TIMEOUT[type], notified: options?.notify === true },
    timeout: 0,
  });
}

/** The app's toasts, raised from anywhere. */
export function useToast() {
  const addNotification = useNotificationsStore((s) => s.addNotification);

  return useMemo(
    () => ({
      toast: (options: {
        title?: string;
        /** Markup where a value is quoted inside the sentence, per DS-CODE-CHIP. */
        description?: ReactNode;
        type?: ToastType;
        timeout?: number;
        action?: ToastAction;
        actions?: ToastAction[];
        icon?: ReactNode;
        notify?: boolean;
        /** The value that was thrown, for a toast that words the failure itself. */
        error?: unknown;
      }) => {
        const type = options.type ?? "info";
        const timeout = options.timeout ?? DEFAULT_TIMEOUT[type];
        const notified = Boolean(options.notify && options.title);
        const details = isAppError(options.error) ? errorDetails(options.error) : undefined;
        if (options.notify && options.title) {
          /* The notification center stores what it can serialise, so a drawn
             description reaches the toast alone. */
          const stored = typeof options.description === "string" ? options.description : undefined;
          addNotification({ title: options.title, description: stored, type, error: details });
        }
        return toastManager.add({
          title: options.title,
          description: options.description,
          data: {
            type,
            timeout,
            actions: [options.action, ...(options.actions ?? [])].filter(
              (action): action is ToastAction => action !== undefined,
            ),
            icon: options.icon,
            notified,
            error: details,
          },
          timeout: 0,
        });
      },
      success: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "success" });
        }
        return raise("success", title, description, options);
      },
      error: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "error" });
        }
        return raise("error", title, description, options);
      },
      /**
       * An error toast for a value that was thrown or returned as a failure.
       *
       * The description is the error's own words. A backend error adds `Details`, with its
       * code and the reference of its log line.
       */
      failure: (title: string, error: unknown, options?: FailureOptions) => {
        const description = options?.description ?? errorMessage(error);
        const details = isAppError(error) ? errorDetails(error) : undefined;
        if (options?.notify) {
          addNotification({ title, description, type: "error", error: details });
        }
        return toastManager.add({
          title,
          description,
          data: {
            type: "error",
            timeout: DEFAULT_TIMEOUT.error,
            notified: options?.notify === true,
            error: details,
          },
          timeout: 0,
        });
      },
      warning: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "warning" });
        }
        return raise("warning", title, description, options);
      },
      info: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "info" });
        }
        return raise("info", title, description, options);
      },
      /**
       * A toast that stays until the work behind it ends, reporting how far it
       * has got where a dismissing toast counts itself down.
       *
       * For work the user did not start. Anything they can wait on belongs in the
       * UI that started it. `action` stops the work, and `report` keeps it on
       * the toast.
       */
      task: (title: string, description?: string, action?: ToastAction): ToastTask => {
        const actions = action ? [action] : [];
        const id = toastManager.add({
          title,
          description,
          data: { type: "info", progress: 0, actions },
          timeout: 0,
        });

        return {
          report: (percent: number, description: string) => {
            toastManager.update(id, {
              description,
              data: { type: "info", progress: percent, actions },
            });
          },
          close: () => toastManager.close(id),
        };
      },
      dismiss: (toastId: string) => {
        toastManager.close(toastId);
      },
      promise: toastManager.promise,
    }),
    [addNotification],
  );
}
