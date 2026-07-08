import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { type AnchorHTMLAttributes, forwardRef } from "react";
import { twMerge } from "tailwind-merge";

export interface ExternalLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "target" | "rel"
> {
  /** Hide the trailing external-link icon. */
  hideIcon?: boolean;
}

export const ExternalLink = forwardRef<HTMLAnchorElement, ExternalLinkProps>(
  ({ children, className, hideIcon, ...props }, ref) => {
    return (
      <a
        ref={ref}
        target="_blank"
        rel="noopener noreferrer"
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
