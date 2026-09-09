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
  CollectionIcon,
  IconButton,
  LootIcon,
  MinionIcon,
  PoroIcon,
  ScuttleIcon,
  Separator,
  Tooltip,
} from "@/components";
import { usePlatformSupport } from "@/hooks";
import { m } from "@/i18n";
import { api, type AppInfo, type VerdictKind } from "@/lib/tauri";
import { isInformational, useIncidents, useLatestIncident } from "@/modules/diagnostics";
import { useHomeUnread } from "@/modules/home";
import { type AppMark, useAppMark, useRollAppMark } from "@/stores";
import { twMerge } from "@/utils";

import { AppMenu } from "./AppMenu";
import { cellActive, cellBase, cellInactive, iconLiftClass } from "./cells";
import { NotificationCenter } from "./NotificationCenter";
import { UpdateButton } from "./UpdateButton";

const navItems = [
  { to: "/", label: m.home_nav_label(), icon: HouseIcon, exact: true },
  { to: "/mods", label: m.library_nav_label(), icon: CollectionIcon, exact: false },
  { to: "/workshop", label: m.workshop_nav_label(), icon: LootIcon, exact: false },
] as const;

const tabBaseClass = `relative flex h-full items-center gap-1.5 px-3 text-sm font-medium transition-colors hover:bg-surface-700 ${iconLiftClass}`;
const tabActiveClass = "text-accent-400";
const tabInactiveClass = "text-surface-400 hover:text-surface-200";

const windowControlClass = "h-full w-10 rounded-none text-surface-400 hover:text-surface-200";

function ActiveIndicator() {
  return (
    <span className="absolute right-0 bottom-0 left-0 h-0.5 bg-linear-to-r from-accent-500 to-accent-400" />
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  exact,
  dot = false,
}: {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact: boolean;
  /** The page holds something the reader has not seen, in the diagnostics dot's shape. */
  dot?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      activeProps={{ className: twMerge(tabBaseClass, tabActiveClass) }}
      inactiveProps={{ className: twMerge(tabBaseClass, tabInactiveClass) }}
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <Icon className="h-4 w-4" />
            {dot && (
              <span
                aria-hidden
                data-ui="TitleBar:unread"
                className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent-400"
              />
            )}
          </span>
          {label}
          {isActive && <ActiveIndicator />}
        </>
      )}
    </Link>
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
  const pendingIncidents = incidents?.filter((incident) => !incident.dismissed).length ?? 0;

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
      className={twMerge(
        "title-bar flex h-9 shrink-0 items-center justify-between border-b border-surface-600 bg-surface-900 select-none",
        isMacOS && "pl-20",
      )}
      data-tauri-drag-region
    >
      {/* Left: App icon, title, version, and navigation */}
      <div className="flex h-full items-center" data-tauri-drag-region>
        <div className="flex shrink-0 items-center gap-2 pr-4 pl-3" data-tauri-drag-region>
          <TitleMark />
          <div className="flex flex-col" data-tauri-drag-region>
            <span
              className="font-display text-sm leading-tight font-bold tracking-tight whitespace-nowrap text-accent-400"
              data-tauri-drag-region
            >
              {title}
            </span>
            {version && (
              <span
                className="text-[0.625rem] leading-none whitespace-nowrap text-surface-500"
                data-tauri-drag-region
              >
                v{version}
              </span>
            )}
          </div>
        </div>

        {/* Navigation tabs */}
        <nav className="flex h-full items-center">
          {navItems.map((item) => (
            <NavLink key={item.to} {...item} dot={item.to === "/" && homeUnread} />
          ))}
        </nav>
      </div>

      {/* Right: the cells that report state, the app menu, and window controls */}
      <div className="flex h-full items-center">
        <div className="flex h-full items-center">
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
                <StethoscopeIcon className="h-4 w-4" />
                {latest && (
                  <span
                    aria-hidden
                    className={twMerge(
                      "absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full",
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
              <GearIcon className="h-4 w-4" />
            </Link>
          </Tooltip>

          <AppMenu appInfo={appInfo} />
        </div>

        {!isMacOS && (
          <>
            <Separator orientation="vertical" className="mx-0 h-full" />

            <div className="flex h-full">
              <IconButton
                icon={<MinusIcon className="h-3.5 w-3.5" />}
                variant="ghost"
                size="sm"
                onClick={handleMinimize}
                aria-label={m.shell_window_minimize_action()}
                className={windowControlClass}
              />
              <IconButton
                icon={
                  isMaximized ? (
                    <OverlappingSquares className="h-3 w-3" />
                  ) : (
                    <SquareIcon className="h-3 w-3" />
                  )
                }
                variant="ghost"
                size="sm"
                onClick={handleMaximize}
                aria-label={
                  isMaximized ? m.shell_window_restore_action() : m.shell_window_maximize_action()
                }
                className={windowControlClass}
              />
              <IconButton
                icon={<XIcon className="h-4 w-4" />}
                variant="ghost"
                size="sm"
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
