import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

// Root
export const TableRoot = forwardRef<HTMLTableElement, ComponentPropsWithoutRef<"table">>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={twMerge("w-full border-separate border-spacing-0 text-sm", className)}
      {...props}
    />
  ),
);
TableRoot.displayName = "Table.Root";

// Header
export const TableHeader = forwardRef<HTMLTableSectionElement, ComponentPropsWithoutRef<"thead">>(
  ({ className, ...props }, ref) => <thead ref={ref} className={className} {...props} />,
);
TableHeader.displayName = "Table.Header";

// Body
export const TableBody = forwardRef<HTMLTableSectionElement, ComponentPropsWithoutRef<"tbody">>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={className} {...props} />,
);
TableBody.displayName = "Table.Body";

// Row
export const TableRow = forwardRef<HTMLTableRowElement, ComponentPropsWithoutRef<"tr">>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={twMerge("group", className)} {...props} />
  ),
);
TableRow.displayName = "Table.Row";

// Head cell
export const TableHead = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<"th">>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={twMerge(
        "border-b border-surface-700 bg-surface-800 px-3 py-2 text-left align-middle text-xs font-medium text-surface-400",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "Table.Head";

// Body cell
export const TableCell = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<"td">>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={twMerge("border-b border-surface-700/40 px-3 py-2 align-top", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "Table.Cell";

// Sort button — placed inside a Head cell to make a column sortable. Kept
// separate from Head so non-interactive affordances (e.g. a hint icon) can sit
// beside it without nesting buttons.
export interface TableSortButtonProps extends ComponentPropsWithoutRef<"button"> {
  /** Current sort of this column: `"asc"`, `"desc"`, or `false` when unsorted. */
  direction: "asc" | "desc" | false;
  children: ReactNode;
}

export const TableSortButton = forwardRef<HTMLButtonElement, TableSortButtonProps>(
  ({ direction, className, children, ...props }, ref) => {
    const Icon = match(direction)
      .with("asc", () => ChevronUp)
      .with("desc", () => ChevronDown)
      .otherwise(() => ChevronsUpDown);

    return (
      <button
        ref={ref}
        type="button"
        className={twMerge(
          "inline-flex items-center gap-1 rounded transition-colors hover:text-surface-200",
          "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-900 focus-visible:outline-none",
          direction && "text-surface-200",
          className,
        )}
        {...props}
      >
        {children}
        <Icon
          className={twMerge("h-3.5 w-3.5", direction ? "text-accent-400" : "text-surface-500")}
        />
      </button>
    );
  },
);
TableSortButton.displayName = "Table.SortButton";

// Compound export
export const Table = {
  Root: TableRoot,
  Header: TableHeader,
  Body: TableBody,
  Row: TableRow,
  Head: TableHead,
  Cell: TableCell,
  SortButton: TableSortButton,
};
