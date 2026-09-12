import { Toast as BaseToast, type ToastManager } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeError, errorMessage } from "@/i18n/errors";
import { m } from "@/paraglide/messages";
import { useNotificationsStore } from "@/stores/notifications";
import { twMerge } from "@/utils";
import { isAppError } from "@/utils/errors";

import { type ToastType } from "./toastType";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  type?: ToastType;
  timeout?: number;
  /** The actions under the description, in one row. */
  actions?: ToastAction[];
  /**
   * A mark of the toast's own, where the type's glyph is not the subject.
   *
   * Sized as the type glyphs are, `h-5 w-5`, and coloured by the caller. The
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
 * the reader rather than the devtools alone.
 */
export function reportUnhandledFailure(error: unknown): void {
  const copy = isAppError(error)
    ? describeError(error)
    : { title: m.common_action_failed_title(), detail: errorMessage(error) };
  toastManager.add({
    title: copy.title,
    description: copy.detail ?? copy.description,
    data: { type: "error", timeout: 7000 },
    timeout: 7000,
  });
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

const typeIcons: Record<ToastType, ReactNode> = {
  success: <CircleCheck className="h-5 w-5 text-success-text" />,
  error: <CircleX className="h-5 w-5 text-danger-text" />,
  warning: <CircleAlert className="h-5 w-5 text-warning-text" />,
  info: <Info className="h-5 w-5 text-info-text" />,
};

const typeStripeClasses: Record<ToastType, string> = {
  success: "border-l-success",
  error: "border-l-danger",
  warning: "border-l-warning",
  info: "border-l-info",
};

const typeProgressColors: Record<ToastType, string> = {
  success: "bg-success",
  error: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

/**
 * The countdown, and what ends the toast when it runs out.
 *
 * The strip is what a reader is watching, so it is what decides: base-ui runs a
 * timer of its own and pauses it on rules this one does not share - a window
 * that was not focused when the toast arrived leaves it paused - which left
 * empty strips sitting on screen.
 */
function ToastProgressBar({
  timeout,
  type,
  paused,
  onExpire,
}: {
  timeout: number;
  type: ToastType;
  paused: boolean;
  onExpire: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const startTimeRef = useRef(Date.now());
  const elapsedBeforePauseRef = useRef(0);
  const rafRef = useRef<number>(undefined);
  const expire = useRef(onExpire);

  useEffect(() => {
    expire.current = onExpire;
  });

  useEffect(() => {
    if (paused) {
      elapsedBeforePauseRef.current += Date.now() - startTimeRef.current;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    startTimeRef.current = Date.now();

    const tick = () => {
      const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
      const remaining = Math.max(0, 100 - (elapsed / timeout) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      expire.current();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [paused, timeout]);

  return (
    <div className="absolute right-0 bottom-0 left-0 h-0.5 overflow-hidden rounded-b-lg">
      <div
        className={twMerge("h-full transition-none", typeProgressColors[type])}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

/* The accent rather than the type color, because this strip reports work
   rather than a status. */
function ToastTaskBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className="absolute right-0 bottom-0 left-0 h-1 overflow-hidden rounded-b-lg bg-surface-700">
      <div
        className="h-full bg-accent-500 transition-[width] duration-150"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

interface ToastItemProps {
  toast: BaseToast.Root.ToastObject<ToastData>;
}

export function ToastItem({ toast }: ToastItemProps) {
  const type = toast.data?.type ?? "info";
  const timeout = toast.data?.timeout ?? 5000;
  const progress = toast.data?.progress;
  const icon = toast.data?.icon ?? typeIcons[type];
  const actions = toast.data?.actions ?? [];
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <BaseToast.Content className="flex flex-1 items-start gap-3 p-4">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1 space-y-1">
          <BaseToast.Title className="text-sm font-medium text-surface-100" />
          <BaseToast.Description className="text-sm text-surface-400" />
          {actions.length > 0 && (
            <div className="mt-1 flex items-center gap-3">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  /* The action is the way out as much as the ✕ is: a toast still
                     sitting there is a press the reader has to make twice. */
                  onClick={() => {
                    action.onClick();
                    toastManager.close(toast.id);
                  }}
                  className="cursor-pointer text-sm font-medium text-accent-400 transition-colors hover:text-accent-300"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <BaseToast.Close
          className="shrink-0 rounded-md p-1 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </BaseToast.Close>
      </BaseToast.Content>
      {progress === undefined && (
        <ToastProgressBar
          timeout={timeout}
          type={type}
          paused={hovered}
          onExpire={() => toastManager.close(toast.id)}
        />
      )}
      {progress !== undefined && <ToastTaskBar value={progress} />}
    </BaseToast.Root>
  );
}

export function ToastList() {
  const { toasts } = BaseToast.useToastManager();

  return (
    <>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast as BaseToast.Root.ToastObject<ToastData>} />
      ))}
    </>
  );
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
      }) => {
        const type = options.type ?? "info";
        const timeout = options.timeout ?? 5000;
        if (options.notify && options.title) {
          /* The notification center stores what it can serialise, so a drawn
             description reaches the toast alone. */
          const stored = typeof options.description === "string" ? options.description : undefined;
          addNotification({ title: options.title, description: stored, type });
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
          },
          timeout,
        });
      },
      success: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "success" });
        }
        return toastManager.add({
          title,
          description,
          data: { type: "success", timeout: 5000 },
          timeout: 5000,
        });
      },
      error: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "error" });
        }
        return toastManager.add({
          title,
          description,
          data: { type: "error", timeout: 7000 },
          timeout: 7000,
        });
      },
      warning: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "warning" });
        }
        return toastManager.add({
          title,
          description,
          data: { type: "warning", timeout: 6000 },
          timeout: 6000,
        });
      },
      info: (title: string, description?: string, options?: ToastOptions) => {
        if (options?.notify) {
          addNotification({ title, description, type: "info" });
        }
        return toastManager.add({
          title,
          description,
          data: { type: "info", timeout: 5000 },
          timeout: 5000,
        });
      },
      /**
       * A toast that stays until the work behind it ends, reporting how far it
       * has got where a dismissing toast counts itself down.
       *
       * For work the user did not start and cannot cancel. Anything they can wait
       * on belongs in the UI that started it.
       */
      task: (title: string, description?: string): ToastTask => {
        const id = toastManager.add({
          title,
          description,
          data: { type: "info", progress: 0 },
          timeout: 0,
        });

        return {
          report: (percent: number, description: string) => {
            toastManager.update(id, {
              description,
              data: { type: "info", progress: percent },
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
