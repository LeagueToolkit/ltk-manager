import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface NavTab {
  to: string;
  params?: Record<string, string>;
  label: string;
  icon?: ReactNode;
  exact?: boolean;
}

interface NavTabsProps {
  tabs: NavTab[];
  className?: string;
}

const tabBase =
  "relative px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900";
const tabActive =
  "text-accent-400 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent-500";
const tabInactive = "text-surface-400 hover:text-surface-200";

export function NavTabs({ tabs, className }: NavTabsProps) {
  return (
    <div className={twMerge("flex items-center gap-0 border-b border-surface-700", className)}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={tab.params ?? {}}
          activeOptions={{ exact: tab.exact ?? false }}
          activeProps={{ className: twMerge(tabBase, tabActive) }}
          inactiveProps={{ className: twMerge(tabBase, tabInactive) }}
        >
          {tab.icon && <span className="mr-1.5 inline-flex">{tab.icon}</span>}
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
