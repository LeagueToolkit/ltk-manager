import { open } from "@tauri-apps/plugin-shell";
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { type AnchorHTMLAttributes, forwardRef, type MouseEvent } from "react";

import { twMerge } from "@/utils";

export interface ExternalLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "target" | "rel"
> {
  /** Hide the trailing external-link icon. */
  hideIcon?: boolean;
}

/**
 * A destination outside the app, opened in the reader's own browser.
 *
 * The webview never navigates. A press is cancelled and handed to the system,
 * so a link the app did not write cannot move the app off its own page.
 */
export const ExternalLink = forwardRef<HTMLAnchorElement, ExternalLinkProps>(
  ({ children, className, hideIcon, href, onClick, onAuxClick, ...props }, ref) => {
    return (
      <a
        ref={ref}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          onClick?.(event);
          leaveTheApp(event, href);
        }}
        onAuxClick={(event) => {
          onAuxClick?.(event);
          if (event.button === MIDDLE_BUTTON) leaveTheApp(event, href);
        }}
        className={twMerge(
          "inline-flex items-center gap-1 text-accent-400 transition-colors hover:text-accent-300",
          className,
        )}
        {...props}
      >
        {children}
        {!hideIcon && <ExternalLinkIcon className="h-3.5 w-3.5" />}
      </a>
    );
  },
);
ExternalLink.displayName = "ExternalLink";

/** The wheel press, which a webview would otherwise answer with a window of its own. */
const MIDDLE_BUTTON = 1;

/**
 * What a press may hand to the system, which is a page and a correspondent.
 *
 * `open` reaches the shell, so a scheme the reader did not expect is a scheme
 * a document's author chose for them.
 */
const LEAVABLE = /^(?:https?|mailto):/i;

/** Cancel the webview's own navigation and give `href` to the system instead. */
function leaveTheApp(event: MouseEvent<HTMLAnchorElement>, href: string | undefined) {
  event.preventDefault();
  if (href && LEAVABLE.test(href)) void open(href);
}

/** Whether `href` is a destination [`ExternalLink`] will open. */
export function isLeavable(href: string): boolean {
  return LEAVABLE.test(href);
}
