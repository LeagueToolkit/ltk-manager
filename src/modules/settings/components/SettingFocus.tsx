import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useReducedMotion } from "@/hooks";
import { twMerge } from "@/utils";

import { settingFocusTab } from "../settingsIndex";

/** How long the mark holds before it fades. */
const MARK_MS = 2000;

/* DS-KIND-HUE: nothing went wrong, so the mark is the accent and not a status hue. */
const MARK_RING = "ring-2 ring-accent-500/40 ring-offset-4 ring-offset-surface-900";

interface SettingFocus {
  /** The public id `?focus=` named, until the group or row carrying it has marked itself. */
  target: string | null;
  redirect: (id: string) => void;
  release: () => void;
}

const SettingFocusContext = createContext<SettingFocus | null>(null);

interface SettingFocusProviderProps {
  children: ReactNode;
}

/** Carries `?focus=` down the mounted panel, so the target marks itself. */
export function SettingFocusProvider({ children }: SettingFocusProviderProps) {
  const { focus } = useSearch({ from: "/settings" });
  const navigate = useNavigate({ from: "/settings" });
  const [target, setTarget] = useState<string | null>(focus ?? null);
  /* Each request is read once. Mirroring the param on every render would undo a hidden
     row's handover to the group around it, which happens before the param is cleared. */
  const requested = useRef(focus);

  useEffect(() => {
    if (focus === requested.current) return;
    requested.current = focus;
    if (focus) setTarget(focus);
  }, [focus]);

  useEffect(() => {
    if (!focus) return;
    /* The id's namespace answers which tab holds the target, so one param settles
       both and a link carries one name. Dropping focus as it is read keeps a refresh
       from re-flashing a mark, and Back from walking two spellings of the same page. */
    void navigate({
      search: (prev) => ({ ...prev, tab: settingFocusTab(focus), focus: undefined }),
      replace: true,
    });
  }, [focus, navigate]);

  const value = useMemo<SettingFocus>(
    () => ({
      target,
      redirect: (id) => setTarget(id),
      release: () => setTarget(null),
    }),
    [target],
  );

  return <SettingFocusContext.Provider value={value}>{children}</SettingFocusContext.Provider>;
}

interface SettingMark {
  ref: (node: HTMLElement | null) => void;
  className: string;
  tabIndex: number | undefined;
}

/**
 * Marks whichever group or row `?focus=` named, once its tab has mounted it.
 *
 * An inactive panel is unmounted, so the target does not exist until its tab is
 * selected. It claims the focus on mount rather than being found by a query.
 */
export function useSettingMark(id: string | undefined, enabled = true): SettingMark {
  const focus = useContext(SettingFocusContext);
  const node = useRef<HTMLElement | null>(null);
  const [marked, setMarked] = useState(false);
  const reducedMotion = useReducedMotion();

  const matched = enabled && id !== undefined && focus?.target === id;

  useEffect(() => {
    const element = node.current;
    if (!matched || !element) return;

    element.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    /* Focus lands on the row itself rather than the control inside it, so a reader
       arriving by keyboard reads the label before they can change the value. */
    element.focus({ preventScroll: true });
    setMarked(true);
    focus?.release();
  }, [focus, matched, reducedMotion]);

  useEffect(() => {
    if (!marked) return;
    const timer = window.setTimeout(() => setMarked(false), MARK_MS);
    return () => window.clearTimeout(timer);
  }, [marked]);

  const ref = useCallback((element: HTMLElement | null) => {
    node.current = element;
  }, []);

  return {
    ref,
    className: twMerge(
      "rounded-lg",
      !reducedMotion && "transition-shadow duration-300",
      marked && MARK_RING,
    ),
    tabIndex: matched || marked ? -1 : undefined,
  };
}

/**
 * Hands a hidden row's mark to the group around it.
 *
 * Marking a row that draws nothing would be a link that appears to fail, and the
 * group header sits above the toggle that gates what the reader came for.
 */
export function useMarkRedirect(from: string | undefined, to: string | undefined, active: boolean) {
  const focus = useContext(SettingFocusContext);

  useEffect(() => {
    if (!active || !from || !to || !focus || focus.target !== from) return;
    focus.redirect(to);
  }, [active, focus, from, to]);
}
