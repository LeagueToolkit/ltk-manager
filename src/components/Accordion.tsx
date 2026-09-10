import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { CaretDownIcon } from "@phosphor-icons/react";
import { forwardRef, type ReactNode } from "react";
import { match } from "ts-pattern";

import { twMerge } from "@/utils";

/**
 * `band` divides items with a rule and adds no surface, the shape a settings
 * group takes (DS-SETTING-LEVEL). `filled` runs edge to edge and recesses its
 * header and panel below the surface it sits on - depth from fills alone, no
 * box - for a group list inside a dialog. Each part takes the variant itself,
 * the way `Tabs` does.
 */
export type AccordionVariant = "band" | "filled";

// Root
export interface AccordionRootProps extends Omit<BaseAccordion.Root.Props, "className"> {
  variant?: AccordionVariant;
  className?: string;
}

export const AccordionRoot = forwardRef<HTMLDivElement, AccordionRootProps>(
  ({ variant = "band", className, ...props }, ref) => {
    const variantClasses = match(variant)
      .with("band", () => "")
      .with("filled", () => "")
      .exhaustive();

    return (
      <BaseAccordion.Root
        ref={ref}
        className={twMerge("flex flex-col", variantClasses, className)}
        {...props}
      />
    );
  },
);
AccordionRoot.displayName = "Accordion.Root";

// Item
export interface AccordionItemProps extends Omit<BaseAccordion.Item.Props, "className"> {
  variant?: AccordionVariant;
  className?: string;
}

export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ variant = "band", className, ...props }, ref) => {
    const variantClasses = match(variant)
      .with("band", () => "border-t border-surface-700/40 first:border-t-0")
      .with("filled", () => "border-t border-surface-700/40 first:border-t-0")
      .exhaustive();

    return (
      <BaseAccordion.Item ref={ref} className={twMerge(variantClasses, className)} {...props} />
    );
  },
);
AccordionItem.displayName = "Accordion.Item";

// Trigger
export interface AccordionTriggerProps extends Omit<BaseAccordion.Trigger.Props, "className"> {
  variant?: AccordionVariant;
  className?: string;
  children?: ReactNode;
}

/**
 * The whole header row is the press, with the caret drawn on its far end.
 *
 * Wraps base-ui's Header so a call site writes one element, and the heading
 * semantics cannot be forgotten.
 */
export const AccordionTrigger = forwardRef<HTMLButtonElement, AccordionTriggerProps>(
  ({ variant = "band", className, children, ...props }, ref) => {
    const variantClasses = match(variant)
      .with("band", () => "")
      .with("filled", () => "bg-surface-900/50")
      .exhaustive();

    return (
      <BaseAccordion.Header className="m-0">
        <BaseAccordion.Trigger
          ref={ref}
          className={twMerge(
            "group/accordion flex w-full items-center gap-2 px-3 py-2 text-left select-none",
            "hover:bg-surface-veil-soft focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none focus-visible:ring-inset",
            variantClasses,
            className,
          )}
          {...props}
        >
          {children}
          <CaretDownIcon
            weight="bold"
            className="ml-auto h-3.5 w-3.5 shrink-0 text-surface-400 transition-transform group-data-[panel-open]/accordion:rotate-180"
          />
        </BaseAccordion.Trigger>
      </BaseAccordion.Header>
    );
  },
);
AccordionTrigger.displayName = "Accordion.Trigger";

// Panel
export interface AccordionPanelProps extends Omit<BaseAccordion.Panel.Props, "className"> {
  variant?: AccordionVariant;
  className?: string;
}

export const AccordionPanel = forwardRef<HTMLDivElement, AccordionPanelProps>(
  ({ variant = "band", className, ...props }, ref) => {
    /* The body's wash fades out over a fixed run rather than filling the
       panel, because the panel's height breathes with its rows and a solid
       fill would drag a hard bottom edge around on every fold. Top edge only,
       like the library list's elevated surface - the dissolve is the bottom. */
    const variantClasses = match(variant)
      .with("band", () => "")
      .with(
        "filled",
        () =>
          "border-t border-surface-700/50 bg-linear-to-b from-surface-900/40 to-transparent to-[8rem]",
      )
      .exhaustive();

    return (
      <BaseAccordion.Panel
        ref={ref}
        className={twMerge(
          "h-[var(--accordion-panel-height)] overflow-hidden transition-[height] duration-150 ease-out",
          "data-[ending-style]:h-0 data-[starting-style]:h-0",
          variantClasses,
          className,
        )}
        {...props}
      />
    );
  },
);
AccordionPanel.displayName = "Accordion.Panel";

// Compound export
export const Accordion = {
  Root: AccordionRoot,
  Item: AccordionItem,
  Trigger: AccordionTrigger,
  Panel: AccordionPanel,
};
