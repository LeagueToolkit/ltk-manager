import { vi } from "vitest";

export const mockInvoke = vi.fn();
export const mockListen = vi.fn(() => Promise.resolve(vi.fn()));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readDir: vi.fn(),
  exists: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
  Command: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = vi.fn((key: string) => Promise.resolve(localStorage.getItem(key)));
    set = vi.fn((key: string, value: unknown) => {
      localStorage.setItem(key, value as string);
      return Promise.resolve();
    });
    delete = vi.fn((key: string) => {
      localStorage.removeItem(key);
      return Promise.resolve();
    });
  },
}));
