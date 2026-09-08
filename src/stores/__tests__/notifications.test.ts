import { useNotificationStore } from "../notifications";

describe("notifications store", () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  });

  describe("addNotification", () => {
    it("adds a notification with id, timestamp, and read=false", () => {
      useNotificationStore.getState().addNotification({
        title: "Test",
        type: "success",
      });
      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe("Test");
      expect(notifications[0].type).toBe("success");
      expect(notifications[0].read).toBe(false);
      expect(notifications[0].id).toBeDefined();
      expect(notifications[0].timestamp).toBeGreaterThan(0);
    });

    it("prepends new notifications", () => {
      const store = useNotificationStore.getState();
      store.addNotification({ title: "First", type: "info" });
      store.addNotification({ title: "Second", type: "info" });
      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].title).toBe("Second");
      expect(notifications[1].title).toBe("First");
    });

    it("updates unread count", () => {
      useNotificationStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationStore.getState().addNotification({ title: "B", type: "info" });
      expect(useNotificationStore.getState().unreadCount).toBe(2);
    });

    it("caps at 100 notifications", () => {
      for (let i = 0; i < 110; i++) {
        useNotificationStore.getState().addNotification({ title: `N${i}`, type: "info" });
      }
      expect(useNotificationStore.getState().notifications).toHaveLength(100);
    });
  });

  describe("markAllRead", () => {
    it("marks all notifications as read and resets unread count", () => {
      useNotificationStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationStore.getState().addNotification({ title: "B", type: "info" });
      useNotificationStore.getState().markAllRead();
      const state = useNotificationStore.getState();
      expect(state.unreadCount).toBe(0);
      expect(state.notifications.every((n) => n.read)).toBe(true);
    });
  });

  describe("dismissAll", () => {
    it("clears all notifications", () => {
      useNotificationStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationStore.getState().dismissAll();
      const state = useNotificationStore.getState();
      expect(state.notifications).toHaveLength(0);
      expect(state.unreadCount).toBe(0);
    });
  });

  describe("dismissOne", () => {
    it("removes a specific notification by id", () => {
      useNotificationStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationStore.getState().addNotification({ title: "B", type: "info" });
      const id = useNotificationStore.getState().notifications[0].id;
      useNotificationStore.getState().dismissOne(id);
      const state = useNotificationStore.getState();
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0].id).not.toBe(id);
    });

    it("updates unread count after dismiss", () => {
      useNotificationStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationStore.getState().addNotification({ title: "B", type: "info" });
      const id = useNotificationStore.getState().notifications[0].id;
      useNotificationStore.getState().dismissOne(id);
      expect(useNotificationStore.getState().unreadCount).toBe(1);
    });
  });
});
