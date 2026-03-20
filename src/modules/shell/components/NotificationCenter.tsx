import { formatDistanceToNow } from "date-fns";
import { Bell, CircleAlert, CircleCheck, CircleX, Info, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { IconButton, Popover, type ToastType, Tooltip } from "@/components";
import { type Notification, useNotificationStore } from "@/stores/notifications";

const typeIcons: Record<ToastType, React.ReactNode> = {
  success: <CircleCheck className="h-4 w-4 text-green-500" />,
  error: <CircleX className="h-4 w-4 text-red-500" />,
  warning: <CircleAlert className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
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
        <p className="mt-0.5 text-xs text-surface-500">
          {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(notification.id)}
        className="shrink-0 rounded p-0.5 text-surface-500 transition-colors hover:bg-surface-700 hover:text-surface-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, dismissAll, dismissOne } =
    useNotificationStore();
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
        aria-label="Notifications"
        className="relative flex h-full items-center px-3 text-surface-400 transition-colors hover:text-surface-200"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4}>
          <Popover.Popup className="w-80">
            <div className="flex items-center justify-between border-b border-surface-700 px-3 py-2">
              <Popover.Title>Notifications</Popover.Title>
              {notifications.length > 0 && (
                <Tooltip content="Clear all">
                  <IconButton
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    variant="ghost"
                    size="xs"
                    onClick={dismissAll}
                    aria-label="Clear all"
                    className="text-surface-400 hover:text-surface-200"
                  />
                </Tooltip>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-surface-500">
                  No notifications yet
                </p>
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
