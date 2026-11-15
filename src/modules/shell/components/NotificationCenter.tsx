import { TrashIcon } from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { Bell, CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { EmptyState, IconButton, Popover, type ToastType } from "@/components";
import { m } from "@/i18n";
import { type Notification, useNotificationsStore } from "@/stores/notifications";
import { twMerge } from "@/utils";

import { cellBase, cellInactive } from "./cells";

const typeIcons: Record<ToastType, React.ReactNode> = {
  success: <CircleCheck className="size-4 text-success-text" />,
  error: <CircleX className="size-4 text-danger-text" />,
  warning: <CircleAlert className="size-4 text-warning-text" />,
  info: <Info className="size-4 text-info-text" />,
};

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-surface-700 px-3 py-2.5 last:border-b-0">
      <div className="mt-0.5 shrink-0">{typeIcons[notification.type]}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-surface-200">{notification.title}</p>
        {notification.description && (
          <p className="truncate text-xs text-surface-400">{notification.description}</p>
        )}
        {notification.error && (
          <p className="truncate font-mono text-xs text-surface-400 select-text">
            {[notification.error.code, notification.error.kind, notification.error.ref]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
        )}
        <p className="mt-0.5 text-xs text-surface-500">
          {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
        </p>
      </div>
      <button
        type="button"
        aria-label={m.shell_notifications_dismiss_action()}
        onClick={() => onDismiss(notification.id)}
        className="shrink-0 rounded-md p-0.5 text-surface-500 transition-colors hover:bg-surface-700 hover:text-surface-300"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, dismissAll, dismissOne } =
    useNotificationsStore();
  const hasMarkedRead = useRef(false);

  // Reset the ref when new notifications arrive so the next open marks them as read
  useEffect(() => {
    if (unreadCount > 0) {
      hasMarkedRead.current = false;
    }
  }, [unreadCount]);

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open && !hasMarkedRead.current) {
          markAllRead();
          hasMarkedRead.current = true;
        }
      }}
    >
      <Popover.Trigger
        aria-label={m.shell_notifications_label()}
        className={twMerge(cellBase, cellInactive, "relative")}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-fine font-bold text-on-accent">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Popover.Trigger>

      <Popover.Content side="bottom" align="end" sideOffset={4} className="w-80">
        <div className="flex items-center justify-between border-b border-surface-700 px-3 py-2">
          <Popover.Title>{m.shell_notifications_label()}</Popover.Title>
          {notifications.length > 0 && (
            <IconButton
              size="sm"
              icon={<TrashIcon />}
              onClick={dismissAll}
              muted
              label={m.shell_notifications_clear_action()}
            />
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <EmptyState size="sm" title={m.shell_notifications_empty()} />
          ) : (
            notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onDismiss={dismissOne}
              />
            ))
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
