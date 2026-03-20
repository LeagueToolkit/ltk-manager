import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { useNotificationStore } from "@/stores/notifications";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastData {
  type?: ToastType;
}

const typeIcons: Record<ToastType, ReactNode> = {
  success: <CircleCheck className="h-5 w-5 text-green-500" />,
  error: <CircleX className="h-5 w-5 text-red-500" />,
  warning: <CircleAlert className="h-5 w-5 text-amber-500" />,
  info: <Info className="h-5 w-5 text-blue-500" />,
};

const typeClasses: Record<ToastType, string> = {
  success: "border-l-green-500",
  error: "border-l-red-500",
  warning: "border-l-amber-500",
  info: "border-l-blue-500",
};

interface ToastItemProps {
  toast: BaseToast.Root.ToastObject<ToastData>;
}

export function ToastItem({ toast }: ToastItemProps) {
  const type = toast.data?.type ?? "info";
  const icon = typeIcons[type];

  return (
    <BaseToast.Root
      toast={toast}
      className={twMerge(
        "relative flex w-full items-start gap-3 rounded-lg border border-l-4 p-4 shadow-lg backdrop-blur-sm transition-all",
        "border-surface-700 bg-surface-800/95",
        typeClasses[type],
        "data-[swipe=move]:transition-none",
        "data-[swipe=cancel]:translate-x-0",
        "data-[starting-style]:translate-x-full data-[starting-style]:opacity-0",
        "data-[ending-style]:translate-x-full data-[ending-style]:opacity-0",
      )}
      style={{
        transform: `translateX(var(--toast-swipe-movement-x, 0))`,
      }}
    >
      <BaseToast.Content className="flex flex-1 items-start gap-3">
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
      if (options.title) {
        addNotification({ title: options.title, description: options.description, type });
      }
      return toastManager.add({
        title: options.title,
        description: options.description,
        data: { type },
        timeout: options.timeout ?? 5000,
      });
    },
    success: (title: string, description?: string) => {
      addNotification({ title, description, type: "success" });
      return toastManager.add({
        title,
        description,
        data: { type: "success" },
        timeout: 5000,
      });
    },
    error: (title: string, description?: string) => {
      addNotification({ title, description, type: "error" });
      return toastManager.add({
        title,
        description,
        data: { type: "error" },
        timeout: 7000,
      });
    },
    warning: (title: string, description?: string) => {
      addNotification({ title, description, type: "warning" });
      return toastManager.add({
        title,
        description,
        data: { type: "warning" },
        timeout: 6000,
      });
    },
    info: (title: string, description?: string) => {
      addNotification({ title, description, type: "info" });
      return toastManager.add({
        title,
        description,
        data: { type: "info" },
        timeout: 5000,
      });
    },
    dismiss: (toastId: string) => {
      toastManager.close(toastId);
    },
    promise: toastManager.promise,
  };
}
