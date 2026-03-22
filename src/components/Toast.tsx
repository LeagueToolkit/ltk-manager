import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { useNotificationStore } from "@/stores/notifications";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastData {
  type?: ToastType;
  timeout?: number;
}

const typeIcons: Record<ToastType, ReactNode> = {
  success: <CircleCheck className="h-5 w-5 text-green-500" />,
  error: <CircleX className="h-5 w-5 text-red-500" />,
  warning: <CircleAlert className="h-5 w-5 text-amber-500" />,
  info: <Info className="h-5 w-5 text-blue-500" />,
};

const typeStripeClasses: Record<ToastType, string> = {
  success: "border-l-green-500",
  error: "border-l-red-500",
  warning: "border-l-amber-500",
  info: "border-l-blue-500",
};

const typeProgressColors: Record<ToastType, string> = {
  success: "bg-green-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

function ToastProgressBar({
  timeout,
  type,
  paused,
}: {
  timeout: number;
  type: ToastType;
  paused: boolean;
}) {
  const [progress, setProgress] = useState(100);
  const startTimeRef = useRef(Date.now());
  const elapsedBeforePauseRef = useRef(0);
  const rafRef = useRef<number>(undefined);

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
      }
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

interface ToastItemProps {
  toast: BaseToast.Root.ToastObject<ToastData>;
}

export function ToastItem({ toast }: ToastItemProps) {
  const type = toast.data?.type ?? "info";
  const timeout = toast.data?.timeout ?? 5000;
  const icon = typeIcons[type];
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
        </div>
        <BaseToast.Close
          className="shrink-0 rounded-md p-1 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </BaseToast.Close>
      </BaseToast.Content>
      <ToastProgressBar timeout={timeout} type={type} paused={hovered} />
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

// Re-export hook for convenience
export const useToastManager = BaseToast.useToastManager;

// Helper function to create typed toasts
export function useToast() {
  const toastManager = BaseToast.useToastManager();
  const addNotification = useNotificationStore((s) => s.addNotification);

  return {
    toast: (options: {
      title?: string;
      description?: string;
      type?: ToastType;
      timeout?: number;
    }) => {
      const type = options.type ?? "info";
      const timeout = options.timeout ?? 5000;
      if (options.title) {
        addNotification({ title: options.title, description: options.description, type });
      }
      return toastManager.add({
        title: options.title,
        description: options.description,
        data: { type, timeout },
        timeout,
      });
    },
    success: (title: string, description?: string) => {
      addNotification({ title, description, type: "success" });
      return toastManager.add({
        title,
        description,
        data: { type: "success", timeout: 5000 },
        timeout: 5000,
      });
    },
    error: (title: string, description?: string) => {
      addNotification({ title, description, type: "error" });
      return toastManager.add({
        title,
        description,
        data: { type: "error", timeout: 7000 },
        timeout: 7000,
      });
    },
    warning: (title: string, description?: string) => {
      addNotification({ title, description, type: "warning" });
      return toastManager.add({
        title,
        description,
        data: { type: "warning", timeout: 6000 },
        timeout: 6000,
      });
    },
    info: (title: string, description?: string) => {
      addNotification({ title, description, type: "info" });
      return toastManager.add({
        title,
        description,
        data: { type: "info", timeout: 5000 },
        timeout: 5000,
      });
    },
    dismiss: (toastId: string) => {
      toastManager.close(toastId);
    },
    promise: toastManager.promise,
  };
}
