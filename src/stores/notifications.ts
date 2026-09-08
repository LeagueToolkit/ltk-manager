import { create } from "zustand";

// eslint-disable-next-line no-restricted-imports -- the leaf, so the barrel does not close a cycle back to this store
import type { ToastType } from "@/components/toastType";

export interface Notification {
  id: string;
  title: string;
  description?: string;
  type: ToastType;
  timestamp: number;
  read: boolean;
}

const MAX_NOTIFICATIONS = 100;

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => void;
  markAllRead: () => void;
  dismissAll: () => void;
  dismissOne: (id: string) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (notification) =>
    set((state) => {
      const newNotification: Notification = {
        ...notification,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        read: false,
      };
      const notifications = [newNotification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  dismissAll: () => set({ notifications: [], unreadCount: 0 }),

  dismissOne: (id) =>
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),
}));
