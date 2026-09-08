import { useNotificationsStore } from "../notifications";

describe("notifications store", () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [], unreadCount: 0 });
  });

  describe("addNotification", () => {
    it("adds a notification with id, timestamp, and read=false", () => {
      useNotificationsStore.getState().addNotification({
        title: "Test",
        type: "success",
      });
      const { notifications } = useNotificationsStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe("Test");
      expect(notifications[0].type).toBe("success");
      expect(notifications[0].read).toBe(false);
      expect(notifications[0].id).toBeDefined();
      expect(notifications[0].timestamp).toBeGreaterThan(0);
    });

    it("prepends new notifications", () => {
      const store = useNotificationsStore.getState();
      store.addNotification({ title: "First", type: "info" });
      store.addNotification({ title: "Second", type: "info" });
      const { notifications } = useNotificationsStore.getState();
      expect(notifications[0].title).toBe("Second");
      expect(notifications[1].title).toBe("First");
    });

    it("updates unread count", () => {
      useNotificationsStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationsStore.getState().addNotification({ title: "B", type: "info" });
      expect(useNotificationsStore.getState().unreadCount).toBe(2);
    });

    it("caps at 100 notifications", () => {
      for (let i = 0; i < 110; i++) {
        useNotificationsStore.getState().addNotification({ title: `N${i}`, type: "info" });
      }
      expect(useNotificationsStore.getState().notifications).toHaveLength(100);
    });
  });

  describe("markAllRead", () => {
    it("marks all notifications as read and resets unread count", () => {
      useNotificationsStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationsStore.getState().addNotification({ title: "B", type: "info" });
      useNotificationsStore.getState().markAllRead();
      const state = useNotificationsStore.getState();
      expect(state.unreadCount).toBe(0);
      expect(state.notifications.every((n) => n.read)).toBe(true);
    });
  });

  describe("dismissAll", () => {
    it("clears all notifications", () => {
      useNotificationsStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationsStore.getState().dismissAll();
      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(0);
      expect(state.unreadCount).toBe(0);
    });
  });

  describe("dismissOne", () => {
    it("removes a specific notification by id", () => {
      useNotificationsStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationsStore.getState().addNotification({ title: "B", type: "info" });
      const id = useNotificationsStore.getState().notifications[0].id;
      useNotificationsStore.getState().dismissOne(id);
      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0].id).not.toBe(id);
    });

    it("updates unread count after dismiss", () => {
      useNotificationsStore.getState().addNotification({ title: "A", type: "info" });
      useNotificationsStore.getState().addNotification({ title: "B", type: "info" });
      const id = useNotificationsStore.getState().notifications[0].id;
      useNotificationsStore.getState().dismissOne(id);
      expect(useNotificationsStore.getState().unreadCount).toBe(1);
    });
  });
});
