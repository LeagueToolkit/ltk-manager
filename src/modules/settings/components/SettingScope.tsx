import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useToast } from "@/components";
import type { BuiltinModSettings, Settings } from "@/lib/tauri";
import {
  APPEARANCE_DEFAULTS,
  LAYOUT_SETTING_DEFAULTS,
  useDisplayStore,
  useWorkshopLayoutStore,
} from "@/stores";

import { settingsKeys, useSaveSettings, useSettingDefaults, useSettings } from "../api";
import { inkingOf, loadingScreenOf } from "../builtinMods";
import { isSettingDefault, settingFormat, settingValue } from "../settingDefaults";
import { inkingField, loadingScreenField, type SettingKey } from "../settingKey";

/** A key mapped to whether the row holding it is currently drawing nothing. */
type Registry = ReadonlyMap<SettingKey, boolean>;

interface Register {
  register: (key: SettingKey, hidden: boolean) => () => void;
}

/* Split in two so a scope's own registrations cannot change the identity of the
   register function its children captured, which would re-run every row's
   effect on every registration and never settle. */
const RegisterContext = createContext<Register | null>(null);
const KeysContext = createContext<Registry | null>(null);

interface SettingScopeProps {
  children: ReactNode;
}

/**
 * Collects the keys of the rows below it, so a reset can offer exactly those.
 *
 * Scopes nest. A row inside a group inside a card registers with both, which is
 * what lets a card reset and a group reset agree about what a default is.
 */
export function SettingScope({ children }: SettingScopeProps) {
  const parent = useContext(RegisterContext);
  const parentRegister = parent?.register;
  const [keys, setKeys] = useState<Registry>(() => new Map());

  const register = useCallback(
    (key: SettingKey, hidden: boolean) => {
      setKeys((prev) => new Map(prev).set(key, hidden));
      const releaseParent = parentRegister?.(key, hidden);

      return () => {
        setKeys((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        releaseParent?.();
      };
    },
    [parentRegister],
  );

  const value = useMemo<Register>(() => ({ register }), [register]);

  return (
    <RegisterContext.Provider value={value}>
      <KeysContext.Provider value={keys}>{children}</KeysContext.Provider>
    </RegisterContext.Provider>
  );
}

/** Announces a row's key to every scope above it, for as long as it is mounted. */
export function useRegisterSetting(key: SettingKey | undefined, hidden: boolean) {
  const register = useContext(RegisterContext)?.register;

  useEffect(() => {
    if (!key || !register) return;
    return register(key, hidden);
  }, [hidden, key, register]);
}

/* A blur belongs to an image the reader just removed, rather than being a choice
   that will mean something again. */
const PAIRED: Partial<Record<SettingKey, readonly SettingKey[]>> = {
  backdropImage: ["backdropBlur"],
};

function withPairs(keys: readonly SettingKey[]): SettingKey[] {
  return [...new Set(keys.flatMap((key) => [key, ...(PAIRED[key] ?? [])]))];
}

function defaultValue(key: SettingKey, defaults: Settings): unknown {
  return settingValue(key, defaults, APPEARANCE_DEFAULTS, LAYOUT_SETTING_DEFAULTS);
}

/**
 * Writes explicit values for a set of keys, across whichever stores own them.
 *
 * Backend keys go in one save, so resetting eight rows is one write rather than
 * eight. The settings it merges into are read at call time rather than at
 * render, because Undo runs against whatever is current when it is clicked.
 */
function useWriteSettings() {
  const queryClient = useQueryClient();
  const saveSettings = useSaveSettings();
  const save = saveSettings.mutate;

  return useCallback(
    (values: ReadonlyMap<SettingKey, unknown>) => {
      const current = queryClient.getQueryData<Settings>(settingsKeys.settings());
      if (!current) return;

      const next: Record<string, unknown> = { ...current };
      const display: Record<string, unknown> = {};
      const layout: Record<string, unknown> = {};
      const builtinMods: Record<string, unknown> = {};
      const inking: Record<string, unknown> = {};
      const loadingScreen: Record<string, unknown> = {};
      let touchesBackend = false;

      for (const [key, value] of values) {
        const inkingKey = inkingField(key);
        const lsKey = loadingScreenField(key);
        if (key.startsWith("display.")) display[key.slice(8)] = value;
        else if (key.startsWith("layout.")) layout[key.slice(7)] = value;
        else if (inkingKey) {
          inking[inkingKey] = value;
          touchesBackend = true;
        } else if (lsKey) {
          loadingScreen[lsKey] = value;
          touchesBackend = true;
        } else if (key.startsWith("builtinMods.")) {
          builtinMods[key.slice(12)] = value;
          touchesBackend = true;
        } else {
          next[key] = value;
          touchesBackend = true;
        }
      }
      if (Object.keys(inking).length > 0) {
        builtinMods.characterInking = { ...inkingOf(current), ...inking };
      }
      if (Object.keys(loadingScreen).length > 0) {
        builtinMods.loadingScreen = { ...loadingScreenOf(current), ...loadingScreen };
      }
      if (Object.keys(builtinMods).length > 0) {
        next.builtinMods = { ...current.builtinMods, ...builtinMods };
      }

      if (touchesBackend) save(next as unknown as Settings);
      if (Object.keys(display).length > 0) useDisplayStore.setState(display);
      if (Object.keys(layout).length > 0) useWorkshopLayoutStore.setState(layout);
    },
    [queryClient, save],
  );
}

/** One key's current value, subscribing only to the store that owns it. */
function useCurrentValue(key: SettingKey | undefined): unknown {
  const { data: settings } = useSettings();
  const display = useDisplayStore((state) =>
    key?.startsWith("display.")
      ? (state as unknown as Record<string, unknown>)[key.slice(8)]
      : undefined,
  );
  const layout = useWorkshopLayoutStore((state) =>
    key?.startsWith("layout.")
      ? (state as unknown as Record<string, unknown>)[key.slice(7)]
      : undefined,
  );

  if (!key) return undefined;
  if (key.startsWith("display.")) return display;
  if (key.startsWith("layout.")) return layout;
  const inking = inkingField(key);
  if (inking) return settings && inkingOf(settings)[inking];
  const lsField = loadingScreenField(key);
  if (lsField) return settings && loadingScreenOf(settings)[lsField];
  if (key.startsWith("builtinMods.")) {
    return settings?.builtinMods[key.slice(12) as keyof BuiltinModSettings];
  }
  return settings?.[key as keyof Settings];
}

export interface SettingDefault {
  /** A key with no format is addressable and never reset. */
  resettable: boolean;
  changed: boolean;
  /** What a fresh install shows, as the reader would read it. */
  label: string | undefined;
  reset: () => void;
}

/** What one row's gear needs to know: whether it can offer a reset, and to what. */
export function useSettingDefault(key: SettingKey | undefined): SettingDefault {
  const { data: defaults } = useSettingDefaults();
  const current = useCurrentValue(key);
  const write = useWriteSettings();

  const format = key === undefined ? undefined : settingFormat(key);
  const ready = key !== undefined && format !== undefined && defaults !== undefined;
  const fresh = ready ? defaultValue(key, defaults) : undefined;

  const reset = useCallback(() => {
    if (!ready) return;
    write(new Map(withPairs([key]).map((one) => [one, defaultValue(one, defaults)])));
  }, [defaults, key, ready, write]);

  if (!ready) return { resettable: false, changed: false, label: undefined, reset };

  return {
    resettable: true,
    changed: !isSettingDefault(key, current, fresh),
    label: format(fresh),
    reset,
  };
}

export interface SettingReset {
  /** Visible keys in this scope that are off their default. */
  changed: readonly SettingKey[];
  reset: () => void;
}

/**
 * The reset behind a group's or a card's own button.
 *
 * A hidden row never appears in `changed`, so a reset never offers to put back a
 * row nobody can see, and never writes one.
 */
export function useSettingReset(): SettingReset {
  const keys = useContext(KeysContext);
  const { data: defaults } = useSettingDefaults();
  const { data: settings } = useSettings();
  const display = useDisplayStore();
  const layout = useWorkshopLayoutStore();
  const write = useWriteSettings();
  const { toast } = useToast();

  const changed = useMemo<SettingKey[]>(() => {
    if (!keys || !defaults || !settings) return [];

    return [...keys]
      .filter(([key, hidden]) => !hidden && settingFormat(key) !== undefined)
      .filter(
        ([key]) =>
          !isSettingDefault(
            key,
            settingValue(key, settings, display, layout),
            defaultValue(key, defaults),
          ),
      )
      .map(([key]) => key);
  }, [defaults, display, keys, layout, settings]);

  const reset = useCallback(() => {
    if (!defaults || !settings || changed.length === 0) return;

    const written = withPairs(changed);
    /* The patch Undo applies, rather than a whole snapshot: a restore that
       reached past its own scope would revert an unrelated change made during
       the toast's five seconds. */
    const before = new Map(
      written.map((key) => [key, settingValue(key, settings, display, layout)]),
    );

    write(new Map(written.map((key) => [key, defaultValue(key, defaults)])));

    toast({
      title: `Reset ${changed.length} ${changed.length === 1 ? "setting" : "settings"}`,
      type: "success",
      action: { label: "Undo", onClick: () => write(before) },
    });
  }, [changed, defaults, display, layout, settings, toast, write]);

  return { changed, reset };
}
