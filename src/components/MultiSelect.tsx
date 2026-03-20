import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { twMerge } from "tailwind-merge";

import { Combobox, useComboboxFilter } from "./Combobox";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  variant?: "compact" | "field";
}

export function MultiSelect({
  options,
  selected,
  onChange,
  label,
  placeholder,
  disabled,
  className,
  variant = "compact",
}: MultiSelectProps) {
  const filter = useComboboxFilter();

  const selectedOptions = useMemo(
    () => options.filter((o) => selected.has(o.value)),
    [options, selected],
  );

  const sortedItems = useMemo(() => {
    const sortByLabel = (a: MultiSelectOption, b: MultiSelectOption) =>
      a.label.localeCompare(b.label);
    const sel = options.filter((o) => selected.has(o.value)).sort(sortByLabel);
    const unsel = options.filter((o) => !selected.has(o.value)).sort(sortByLabel);
    return [...sel, ...unsel];
  }, [options, selected]);

  return (
    <Combobox.Root<MultiSelectOption, true>
      multiple
      value={selectedOptions}
      onValueChange={(opts) => onChange(new Set(opts.map((o) => o.value)))}
      items={sortedItems}
      filter={(item, query) => filter.contains(item, query, (o) => o.label)}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      disabled={disabled}
    >
      {variant === "compact" ? (
        <Combobox.Trigger
          className={twMerge(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
            "border-surface-500 bg-surface-700 text-surface-200",
            "hover:border-surface-400",
            "focus:border-accent-500 focus:ring-1 focus:ring-accent-500 focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {label && <span className="text-surface-300">{label}</span>}
          {selected.size > 0 && (
            <span className="rounded-full bg-accent-500/20 px-1.5 text-xs text-accent-400">
              {selected.size}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-surface-400" />
        </Combobox.Trigger>
      ) : (
        <Combobox.Trigger
          className={twMerge(
            "flex min-h-[42px] w-full items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
            "border-surface-500 bg-surface-700 text-surface-200",
            "hover:border-surface-400",
            "focus:border-accent-500 focus:ring-1 focus:ring-accent-500 focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {selectedOptions.length > 0 ? (
              selectedOptions.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center rounded bg-surface-600 px-1.5 py-0.5 text-xs text-surface-200"
                >
                  {o.label}
                </span>
              ))
            ) : (
              <span className="text-surface-400">{label ?? "Select..."}</span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-surface-400" />
        </Combobox.Trigger>
      )}
      <Combobox.Portal>
        <Combobox.Positioner side="bottom" sideOffset={4} className="z-50">
          <Combobox.Popup
            className={twMerge(
              "w-64 rounded-lg border border-surface-600 bg-surface-700/60 shadow-xl backdrop-blur-lg",
              "animate-fade-in",
              "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            )}
          >
            <div className="border-b border-surface-600 px-3 py-2">
              <Combobox.Input
                placeholder={placeholder}
                className="w-full border-0 bg-transparent text-sm text-surface-50 outline-none placeholder:text-surface-400 focus:ring-0"
              />
            </div>
            <Combobox.List className="max-h-60 overflow-y-auto py-1">
              {(item: MultiSelectOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  disabled={item.disabled}
                  className={twMerge(
                    "text-surface-400 data-[highlighted]:bg-surface-600",
                    "data-[selected]:text-surface-100",
                  )}
                >
                  {item.label}
                </Combobox.Item>
              )}
            </Combobox.List>
            <Combobox.Empty>
              <p className="px-3 py-6 text-center text-sm text-surface-400">No results found</p>
            </Combobox.Empty>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
MultiSelect.displayName = "MultiSelect";
