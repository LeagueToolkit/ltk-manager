import {
  GearIcon,
  HouseIcon,
  MinusIcon,
  SquareIcon,
  StethoscopeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ComponentType, useEffect, useRef, useState } from "react";

import {
  ChromeSlot,
  CollectionIcon,
  IconButton,
  LootIcon,
  MinionIcon,
  PoroIcon,
  ScuttleIcon,
  Separator,
  Tooltip,
  useChromeGrounded,
} from "@/components";
import { usePlatformSupport, useResizeObserver } from "@/hooks";
import { m } from "@/i18n";
import { api, type AppInfo, type VerdictKind } from "@/lib/tauri";
import { isInformational, useIncidents, useLatestIncident } from "@/modules/diagnostics";
import { useHomeUnread } from "@/modules/home";
import { type AppMark, useAppMark, useRollAppMark } from "@/stores";
import { twMerge } from "@/utils";

import { AppMenu } from "./AppMenu";
import { cellActive, cellBase, cellInactive, iconLiftClass } from "./cells";
import { NotificationCenter } from "./NotificationCenter";
import { type TitleBarFold, titleBarFold } from "./titleBarFold";
import { UpdateButton } from "./UpdateButton";

const navItems = [
  { to: "/", label: m.home_nav_label(), icon: HouseIcon, exact: true },
  { to: "/mods", label: m.library_nav_label(), icon: CollectionIcon, exact: false },
  { to: "/workshop", label: m.workshop_nav_label(), icon: LootIcon, exact: false },
] as const;

/* The height of the field a page draws in the middle, so the row reads as one line of controls. */
const tabBaseClass = `flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors ${iconLiftClass}`;
const tabActiveClass = cellActive;
/* DS-VEIL */
const tabInactiveClass = "text-surface-400 hover:bg-surface-veil hover:text-surface-200";

const windowControlClass = "h-full w-10 rounded-none text-surface-400 hover:text-surface-200";

function NavLink({
  to,
  label,
  icon: Icon,
  exact,
  dot = false,
  folded,
}: {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact: boolean;
  /** The page holds something the reader has not seen, in the diagnostics dot's shape. */
  dot?: boolean;
  /** Draw the icon alone, with the label as its tooltip. */
  folded: boolean;
}) {
  const link = (
    <Link
      to={to}
      aria-label={label}
      activeOptions={{ exact }}
      activeProps={{ className: twMerge(tabBaseClass, tabActiveClass) }}
      inactiveProps={{ className: twMerge(tabBaseClass, tabInactiveClass) }}
    >
      <span className="relative">
        <Icon className="size-4" />
        {dot && (
          <span
            aria-hidden
            data-ui="TitleBar:unread"
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-accent-400"
          />
        )}
      </span>
      {!folded && label}
    </Link>
  );

  if (!folded) {
    return link;
  }

  return (
    <Tooltip content={label} side="bottom">
      {link}
    </Tooltip>
  );
}

/**
 * A verdict that reports facts without blaming anything is information. One
 * that names a failure is a warning, and the dot says which is waiting.
 */
const incidentDotClass: Record<"informational" | "failure", string> = {
  informational: "bg-warning",
  failure: "bg-danger",
};

function incidentDotKind(kind: VerdictKind) {
  return isInformational(kind) ? "informational" : "failure";
}

function diagnosticsTooltip(pending: number): string {
  if (pending === 0) return m.shell_diagnostics_label();
  return m.shell_diagnostics_pending_label({ count: pending });
}

const mascotMarks = {
  poro: PoroIcon,
  minion: MinionIcon,
  scuttle: ScuttleIcon,
};

const UNLOCK_CLICKS = 10;
const UNLOCK_GAP = 1500;

function MarkGlyph({ mark }: { mark: AppMark }) {
  if (mark === "ltk") return <img src="/icon.svg" alt="LTK" className="size-5" />;

  const Mascot = mascotMarks[mark];
  return <Mascot className="size-6" />;
}

function TitleMark() {
  const mark = useAppMark();
  const rollAppMark = useRollAppMark();
  const run = useRef({ count: 0, expiresAt: 0 });

  function handleClick() {
    const now = Date.now();
    const count = now < run.current.expiresAt ? run.current.count + 1 : 1;

    if (count < UNLOCK_CLICKS) {
      run.current = { count, expiresAt: now + UNLOCK_GAP };
      return;
    }

    run.current = { count: 0, expiresAt: 0 };
    rollAppMark();
  }

  return (
    <span
      className="-m-1.5 flex size-8 shrink-0 items-center justify-center p-1"
      onClick={handleClick}
      data-tauri-drag-region="false"
      data-ui="TitleBar:mark"
    >
      <MarkGlyph mark={mark} />
    </span>
  );
}

/* Equal shares on both sides, so what a page draws between them centres in the window. */
const SIDE = "flex h-full min-w-max flex-1 basis-0 items-center";

interface TitleBarProps {
  title?: string;
  appInfo?: AppInfo;
}

export function TitleBar({ title = "LTK Manager", appInfo }: TitleBarProps) {
  const { data: platform } = usePlatformSupport();
  const isMacOS = platform?.os === "macos";
  const latest = useLatestIncident();
  const { data: incidents } = useIncidents();
  const homeUnread = useHomeUnread();
  const grounded = useChromeGrounded();
  const pendingIncidents = incidents?.filter((incident) => !incident.dismissed).length ?? 0;

  const [fold, setFold] = useState<TitleBarFold>("full");
  const measure = useResizeObserver<HTMLElement>((bar) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    setFold(titleBarFold(bar.clientWidth, rem));
  });

  const version = appInfo?.version;
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    // Check initial maximized state
    appWindow.isMaximized().then(setIsMaximized);

    // Listen for resize events to update maximized state
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [appWindow]);

  const handleMinimize = () => {
    api.minimizeToTray();
  };
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <header
      ref={measure}
      /* Stacked over `main`, which the popup of what a page draws in the middle drops across. */
      className={twMerge(
        "title-bar relative z-50 flex h-10 shrink-0 items-center border-b border-surface-600 bg-surface-900 select-none",
        /* DS-GROUND */
        grounded && "border-transparent bg-surface-950",
        isMacOS && "pl-20",
      )}
      data-tauri-drag-region
    >
      {/* Left: App icon, title, version, and navigation */}
      <div className={twMerge(SIDE, "justify-start")} data-tauri-drag-region>
        <div
          className={twMerge(
            "flex shrink-0 items-center gap-2 pr-4 pl-3",
            fold === "bare" && "pr-2",
          )}
          data-tauri-drag-region
        >
          <TitleMark />
          {fold !== "bare" && (
            <div className="flex flex-col" data-tauri-drag-region>
              <span
                className="font-display text-sm leading-tight font-bold tracking-tight whitespace-nowrap text-accent-400"
                data-tauri-drag-region
              >
                {title}
              </span>
              {version && (
                <span
                  className="text-fine leading-none whitespace-nowrap text-surface-500"
                  data-tauri-drag-region
                >
                  v{version}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Navigation tabs */}
        <nav className="flex h-full items-center gap-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              {...item}
              dot={item.to === "/" && homeUnread}
              folded={fold !== "full"}
            />
          ))}
        </nav>
      </div>

      <ChromeSlot name="title" />

      {/* Right: the cells that report state, the app menu, and window controls */}
      <div className={twMerge(SIDE, "justify-end")} data-tauri-drag-region>
        <div className="flex h-full items-center gap-0.5 px-1.5">
          <UpdateButton />

          <NotificationCenter />

          <Tooltip content={diagnosticsTooltip(pendingIncidents)}>
            <Link
              to="/diagnostics"
              activeProps={{ className: twMerge(cellBase, cellActive) }}
              inactiveProps={{ className: twMerge(cellBase, cellInactive) }}
              aria-label={diagnosticsTooltip(pendingIncidents)}
              data-ui="TitleBar:diagnostics"
            >
              <span className="relative">
                <StethoscopeIcon className="size-4" />
                {latest && (
                  <span
                    aria-hidden
                    className={twMerge(
                      "absolute -top-0.5 -right-0.5 size-1.5 rounded-full",
                      incidentDotClass[incidentDotKind(latest.verdict.kind)],
                    )}
                  />
                )}
              </span>
            </Link>
          </Tooltip>

          <Tooltip content={m.shell_settings_label()}>
            <Link
              to="/settings"
              activeProps={{ className: twMerge(cellBase, cellActive) }}
              inactiveProps={{ className: twMerge(cellBase, cellInactive) }}
              aria-label={m.shell_settings_label()}
              data-ui="TitleBar:settings"
            >
              <GearIcon className="size-4" />
            </Link>
          </Tooltip>

          <AppMenu />
        </div>

        {!isMacOS && (
          <>
            <Separator orientation="vertical" className="mx-0 h-full" />

            <div className="flex h-full">
              <IconButton
                icon={<MinusIcon className="size-3.5" />}
                size="md"
                onClick={handleMinimize}
                aria-label={m.shell_window_minimize_action()}
                className={windowControlClass}
              />
              <IconButton
                icon={
                  isMaximized ? (
                    <OverlappingSquares className="size-3" />
                  ) : (
                    <SquareIcon className="size-3" />
                  )
                }
                size="md"
                onClick={handleMaximize}
                aria-label={
                  isMaximized ? m.shell_window_restore_action() : m.shell_window_maximize_action()
                }
                className={windowControlClass}
              />
              <IconButton
                icon={<XIcon />}
                size="md"
                onClick={handleClose}
                aria-label={m.shell_window_close_action()}
                className={twMerge(
                  windowControlClass,
                  "hover:bg-danger/15 hover:text-danger-text active:bg-danger/25",
                )}
              />
            </div>
          </>
        )}
      </div>
    </header>
  );
}

// Custom icon for restored/unmaximized state (overlapping squares)
function OverlappingSquares({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {/* Back square */}
      <rect x="4" y="1" width="9" height="9" rx="1" />
      {/* Front square */}
      <rect x="1" y="4" width="9" height="9" rx="1" fill="currentColor" fillOpacity="0.1" />
      <rect x="1" y="4" width="9" height="9" rx="1" />
    </svg>
  );
}
