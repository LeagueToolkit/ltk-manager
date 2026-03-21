import { Link } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-shell";
import type { LucideIcon } from "lucide-react";
import { Accessibility, Hammer, Library, Minus, Settings, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

import { IconButton, Tooltip } from "@/components";
import { api, type AppInfo } from "@/lib/tauri";

import { NotificationCenter } from "./NotificationCenter";

const navItems = [
  { to: "/", label: "Library", icon: Library, exact: true },
  { to: "/workshop", label: "Workshop", icon: Hammer, exact: false },
] as const;

const linkBaseClass =
  "relative flex h-full items-center gap-1.5 px-3 text-sm font-medium transition-colors";
const settingsLinkBase = "relative flex h-full items-center px-3 transition-colors";
const activeLinkClass = "text-accent-400";
const inactiveLinkClass = "text-surface-400 hover:text-surface-200";

function ActiveIndicator() {
  return <span className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent-500" />;
}

function NavLink({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      activeProps={{ className: twMerge(linkBaseClass, activeLinkClass) }}
      inactiveProps={{ className: twMerge(linkBaseClass, inactiveLinkClass) }}
    >
      {({ isActive }) => (
        <>
          <Icon className="h-4 w-4" />
          {label}
          {isActive && <ActiveIndicator />}
        </>
      )}
    </Link>
  );
}

function buildBugReportUrl(appInfo: AppInfo | undefined): string {
  const base = "https://github.com/LeagueToolkit/ltk-manager/issues/new?template=bug_report.yml";
  if (!appInfo) return base;

  const params = new URLSearchParams();
  params.set("template", "bug_report.yml");
  params.set("version", appInfo.version);
  params.set("os", `${appInfo.os} ${appInfo.arch}`);

  return `https://github.com/LeagueToolkit/ltk-manager/issues/new?${params.toString()}`;
}

interface TitleBarProps {
  title?: string;
  appInfo?: AppInfo;
}

export function TitleBar({ title = "LTK Manager", appInfo }: TitleBarProps) {
  const version = appInfo?.version;
  const bugReportUrl = buildBugReportUrl(appInfo);
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
      className="title-bar flex h-10 shrink-0 items-center justify-between border-b border-surface-600 bg-surface-950 select-none"
      data-tauri-drag-region
    >
      {/* Left: App icon, title, version, and navigation */}
      <div className="flex h-full items-center" data-tauri-drag-region>
        <div className="flex items-center gap-2 pr-4 pl-3" data-tauri-drag-region>
          <img src="/icon.svg" alt="LTK" className="h-5 w-5" data-tauri-drag-region />
          <span className="text-sm font-medium text-surface-100" data-tauri-drag-region>
            {title}
          </span>
          {version && (
            <span className="text-xs text-surface-500" data-tauri-drag-region>
              v{version}
            </span>
          )}
        </div>

        {/* Navigation tabs */}
        <nav className="flex h-full items-center gap-1">
          {navItems.map((item) => (
            <NavLink key={item.to} {...item} />
          ))}
        </nav>
      </div>

      {/* Right: Notifications, Settings, and window controls */}
      <div className="flex h-full items-center">
        <NotificationCenter />

        <Tooltip content="Report a Bug">
          <IconButton
            icon={<Accessibility className="h-5 w-5" />}
            variant="ghost"
            size="sm"
            onClick={() => open(bugReportUrl)}
            aria-label="Report a Bug"
            className="text-surface-400 hover:text-surface-200"
          />
        </Tooltip>

        {/* Settings button */}
        <Link
          to="/settings"
          activeProps={{
            className: twMerge(settingsLinkBase, activeLinkClass),
          }}
          inactiveProps={{
            className: twMerge(settingsLinkBase, inactiveLinkClass),
          }}
          aria-label="Settings"
        >
          {({ isActive }) => (
            <>
              <Settings className="h-4 w-4" />
              {isActive && <ActiveIndicator />}
            </>
          )}
        </Link>

        {/* Separator */}
        <div className="mx-2 h-5 w-px bg-surface-600" />

        {/* Window controls */}
        <IconButton
          icon={<Minus className="h-3.5 w-3.5" />}
          variant="ghost"
          size="sm"
          onClick={handleMinimize}
          aria-label="Minimize"
          className="mx-0.5 h-7 w-7 rounded-md text-surface-400 transition-[transform,background-color,color] duration-100 hover:bg-amber-500 hover:text-white active:scale-90 active:opacity-80"
        />
        <IconButton
          icon={
            isMaximized ? (
              <OverlappingSquares className="h-3 w-3" />
            ) : (
              <Square className="h-3 w-3" />
            )
          }
          variant="ghost"
          size="sm"
          onClick={handleMaximize}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          className="mx-0.5 h-7 w-7 rounded-md text-surface-400 transition-[transform,background-color,color] duration-100 hover:bg-green-500 hover:text-white active:scale-90 active:opacity-80"
        />
        <IconButton
          icon={<X className="h-3.5 w-3.5" />}
          variant="ghost"
          size="sm"
          onClick={handleClose}
          aria-label="Close"
          className="mx-0.5 mr-2 h-7 w-7 rounded-md text-surface-400 transition-[transform,background-color,color] duration-100 hover:bg-red-500 hover:text-white active:scale-90 active:opacity-80"
        />
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
