import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Re-export the filter hook for consumers
export const useComboboxFilter = BaseCombobox.useFilter;

// Root
export interface ComboboxRootProps<
  Value = string,
  Multiple extends boolean | undefined = false,
> extends BaseCombobox.Root.Props<Value, Multiple> {
  children?: ReactNode;
}

export function ComboboxRoot<Value = string, Multiple extends boolean | undefined = false>({
  children,
  ...props
}: ComboboxRootProps<Value, Multiple>) {
  return <BaseCombobox.Root<Value, Multiple> {...props}>{children}</BaseCombobox.Root>;
}
ComboboxRoot.displayName = "Combobox.Root";

// Input
export interface ComboboxInputProps extends Omit<BaseCombobox.Input.Props, "className"> {
  className?: string;
  hasError?: boolean;
}

export const ComboboxInput = forwardRef<HTMLInputElement, ComboboxInputProps>(
  ({ className, hasError, ...props }, ref) => {
    return (
      <BaseCombobox.Input
        ref={ref}
        className={twMerge(
          "w-full rounded-lg border px-4 py-2.5 text-sm transition-colors",
          "bg-surface-700 text-surface-50 placeholder:text-surface-400",
          "border-surface-500 hover:border-surface-400",
          "focus:border-accent-500 focus:ring-1 focus:ring-accent-500 focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          hasError && "border-red-500 focus:border-red-500 focus:ring-red-500",
          className,
        )}
        {...props}
      />
    );
  },
);
ComboboxInput.displayName = "Combobox.Input";

// Trigger
export interface ComboboxTriggerProps extends Omit<BaseCombobox.Trigger.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxTrigger = forwardRef<HTMLButtonElement, ComboboxTriggerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Trigger
        ref={ref}
        className={twMerge(
          "inline-flex items-center justify-center text-surface-400 transition-colors hover:text-surface-200",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </BaseCombobox.Trigger>
    );
  },
);
ComboboxTrigger.displayName = "Combobox.Trigger";

// Icon
export interface ComboboxIconProps extends Omit<BaseCombobox.Icon.Props, "className"> {
  className?: string;
}

export const ComboboxIcon = forwardRef<HTMLDivElement, ComboboxIconProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseCombobox.Icon ref={ref} className={twMerge("text-surface-400", className)} {...props}>
        <ChevronDown className="h-4 w-4" />
      </BaseCombobox.Icon>
    );
  },
);
ComboboxIcon.displayName = "Combobox.Icon";

// Portal
export interface ComboboxPortalProps extends BaseCombobox.Portal.Props {
  children?: ReactNode;
}

export const ComboboxPortal = ({ children, ...props }: ComboboxPortalProps) => {
  return <BaseCombobox.Portal {...props}>{children}</BaseCombobox.Portal>;
};
ComboboxPortal.displayName = "Combobox.Portal";

// Positioner
export interface ComboboxPositionerProps extends Omit<BaseCombobox.Positioner.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxPositioner = forwardRef<HTMLDivElement, ComboboxPositionerProps>(
  ({ className, children, side = "bottom", sideOffset = 4, ...props }, ref) => {
    return (
      <BaseCombobox.Positioner
        ref={ref}
        side={side}
        sideOffset={sideOffset}
        className={twMerge("z-50", className)}
        {...props}
      >
        {children}
      </BaseCombobox.Positioner>
    );
  },
);
ComboboxPositioner.displayName = "Combobox.Positioner";

// Popup
export interface ComboboxPopupProps extends Omit<BaseCombobox.Popup.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxPopup = forwardRef<HTMLDivElement, ComboboxPopupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Popup
        ref={ref}
        className={twMerge(
          "max-h-60 overflow-y-auto",
          "rounded-lg border border-surface-600 bg-surface-700 py-1 shadow-xl",
          "animate-fade-in",
          "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BaseCombobox.Popup>
    );
  },
);
ComboboxPopup.displayName = "Combobox.Popup";

// List
export interface ComboboxListProps extends Omit<BaseCombobox.List.Props, "className"> {
  className?: string;
}

export const ComboboxList = forwardRef<HTMLDivElement, ComboboxListProps>(
  ({ className, ...props }, ref) => {
    return <BaseCombobox.List ref={ref} className={className} {...props} />;
  },
);
ComboboxList.displayName = "Combobox.List";

// Item
export interface ComboboxItemProps extends Omit<BaseCombobox.Item.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxItem = forwardRef<HTMLDivElement, ComboboxItemProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Item
        ref={ref}
        className={twMerge(
          "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-none select-none",
          "text-surface-200 data-[highlighted]:bg-surface-600",
          "data-[disabled]:opacity-50",
          className,
        )}
        {...props}
      >
        <BaseCombobox.ItemIndicator className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <Check className="h-3.5 w-3.5" />
        </BaseCombobox.ItemIndicator>
        {children}
      </BaseCombobox.Item>
    );
  },
);
ComboboxItem.displayName = "Combobox.Item";

// Empty
export interface ComboboxEmptyProps extends Omit<BaseCombobox.Empty.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxEmpty = forwardRef<HTMLDivElement, ComboboxEmptyProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Empty
        ref={ref}
        className={twMerge("px-3 py-6 text-center text-sm text-surface-400", className)}
        {...props}
      >
        {children ?? "No results found"}
      </BaseCombobox.Empty>
    );
  },
);
ComboboxEmpty.displayName = "Combobox.Empty";

// Clear
export interface ComboboxClearProps extends Omit<BaseCombobox.Clear.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxClear = forwardRef<HTMLButtonElement, ComboboxClearProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Clear
        ref={ref}
        className={twMerge(
          "inline-flex items-center justify-center text-surface-400 transition-colors hover:text-surface-200",
          className,
        )}
        {...props}
      >
        {children ?? <X className="h-4 w-4" />}
      </BaseCombobox.Clear>
    );
  },
);
ComboboxClear.displayName = "Combobox.Clear";

// Chips
export interface ComboboxChipsProps extends Omit<BaseCombobox.Chips.Props, "className"> {
  className?: string;
}

export const ComboboxChips = forwardRef<HTMLDivElement, ComboboxChipsProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseCombobox.Chips
        ref={ref}
        className={twMerge("flex flex-wrap gap-1", className)}
        {...props}
      />
    );
  },
);
ComboboxChips.displayName = "Combobox.Chips";

// Chip
export interface ComboboxChipProps extends Omit<BaseCombobox.Chip.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxChip = forwardRef<HTMLDivElement, ComboboxChipProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Chip
        ref={ref}
        className={twMerge(
          "inline-flex items-center gap-1 rounded-md bg-surface-600 px-2 py-0.5 text-sm text-surface-100",
          className,
        )}
        {...props}
      >
        {children}
      </BaseCombobox.Chip>
    );
  },
);
ComboboxChip.displayName = "Combobox.Chip";

// ChipRemove
export interface ComboboxChipRemoveProps extends Omit<BaseCombobox.ChipRemove.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxChipRemove = forwardRef<HTMLButtonElement, ComboboxChipRemoveProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.ChipRemove
        ref={ref}
        className={twMerge(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm",
          "text-surface-400 transition-colors hover:bg-surface-500 hover:text-surface-200",
          className,
        )}
        {...props}
      >
        {children ?? <X className="h-3 w-3" />}
      </BaseCombobox.ChipRemove>
    );
  },
);
ComboboxChipRemove.displayName = "Combobox.ChipRemove";

// Group
export interface ComboboxGroupProps extends Omit<BaseCombobox.Group.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxGroup = forwardRef<HTMLDivElement, ComboboxGroupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Group ref={ref} className={className} {...props}>
        {children}
      </BaseCombobox.Group>
    );
  },
);
ComboboxGroup.displayName = "Combobox.Group";

// GroupLabel
export interface ComboboxGroupLabelProps extends Omit<BaseCombobox.GroupLabel.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxGroupLabel = forwardRef<HTMLDivElement, ComboboxGroupLabelProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.GroupLabel
        ref={ref}
        className={twMerge("px-3 py-1.5 text-xs font-medium text-surface-500", className)}
        {...props}
      >
        {children}
      </BaseCombobox.GroupLabel>
    );
  },
);
ComboboxGroupLabel.displayName = "Combobox.GroupLabel";

// Status
export interface ComboboxStatusProps extends Omit<BaseCombobox.Status.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const ComboboxStatus = forwardRef<HTMLDivElement, ComboboxStatusProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseCombobox.Status ref={ref} className={twMerge("sr-only", className)} {...props}>
        {children}
      </BaseCombobox.Status>
    );
  },
);
ComboboxStatus.displayName = "Combobox.Status";

// Compound export
export const Combobox = {
  Root: ComboboxRoot,
  Input: ComboboxInput,
  Trigger: ComboboxTrigger,
  Icon: ComboboxIcon,
  Portal: ComboboxPortal,
  Positioner: ComboboxPositioner,
  Popup: ComboboxPopup,
  List: ComboboxList,
  Item: ComboboxItem,
  Empty: ComboboxEmpty,
  Clear: ComboboxClear,
  Chips: ComboboxChips,
  Chip: ComboboxChip,
  ChipRemove: ComboboxChipRemove,
  Group: ComboboxGroup,
  GroupLabel: ComboboxGroupLabel,
  Status: ComboboxStatus,
};

// --- Simplified ComboboxField for common use cases ---

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxFieldProps {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
  inputClassName?: string;
}

export function ComboboxField({
  label,
  description,
  error,
  required,
  placeholder,
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
  className,
  inputClassName,
}: ComboboxFieldProps) {
  const filter = useComboboxFilter();

  const selectedOption = value != null ? options.find((o) => o.value === value) : undefined;
  const defaultOption =
    defaultValue != null ? options.find((o) => o.value === defaultValue) : undefined;

  return (
    <div className={twMerge("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-surface-200">
          {label}
          {required && <span className="ml-1 text-red-400">*</span>}
        </label>
      )}
      {description && <p className="text-xs text-surface-400">{description}</p>}
      <ComboboxRoot<ComboboxOption>
        value={selectedOption}
        defaultValue={defaultOption}
        onValueChange={(opt) => onValueChange?.(opt?.value ?? null)}
        disabled={disabled}
        name={name}
        items={options}
        filter={(item, query) => filter.contains(item, query, (o) => o.label)}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
      >
        <div className="relative">
          <ComboboxInput
            placeholder={placeholder}
            hasError={!!error}
            className={twMerge("pr-8", inputClassName)}
          />
          <ComboboxTrigger className="absolute top-0 right-0 flex h-full items-center pr-3">
            <ComboboxIcon />
          </ComboboxTrigger>
        </div>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxList>
                {(item: ComboboxOption) => (
                  <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
              <ComboboxEmpty />
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </ComboboxRoot>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
ComboboxField.displayName = "ComboboxField";
