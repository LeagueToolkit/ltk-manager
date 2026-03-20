import { Field as BaseField } from "@base-ui/react/field";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Field Root
export interface FieldRootProps extends Omit<BaseField.Root.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const FieldRoot = forwardRef<HTMLDivElement, FieldRootProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseField.Root ref={ref} className={twMerge("flex flex-col gap-1.5", className)} {...props}>
        {children}
      </BaseField.Root>
    );
  },
);
FieldRoot.displayName = "Field.Root";

// Field Label
export interface FieldLabelProps extends Omit<BaseField.Label.Props, "className"> {
  className?: string;
  required?: boolean;
  children?: ReactNode;
}

export const FieldLabel = forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ className, required, children, ...props }, ref) => {
    return (
      <BaseField.Label
        ref={ref}
        className={twMerge("text-sm font-medium text-surface-200", className)}
        {...props}
      >
        {children}
        {required && <span className="ml-1 text-red-400">*</span>}
      </BaseField.Label>
    );
  },
);
FieldLabel.displayName = "Field.Label";

// Field Description (helper text)
export interface FieldDescriptionProps extends Omit<BaseField.Description.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const FieldDescription = forwardRef<HTMLParagraphElement, FieldDescriptionProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseField.Description
        ref={ref}
        className={twMerge("text-xs text-surface-400", className)}
        {...props}
      >
        {children}
      </BaseField.Description>
    );
  },
);
FieldDescription.displayName = "Field.Description";

// Field Error
export interface FieldErrorProps extends Omit<BaseField.Error.Props, "className"> {
  className?: string;
  children?: ReactNode;
}

export const FieldError = forwardRef<HTMLParagraphElement, FieldErrorProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseField.Error ref={ref} className={twMerge("text-xs text-red-500", className)} {...props}>
        {children}
      </BaseField.Error>
    );
  },
);
FieldError.displayName = "Field.Error";

// Field Control (input wrapper)
export interface FieldControlProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className"
> {
  className?: string;
  hasError?: boolean;
}

export const FieldControl = forwardRef<HTMLInputElement, FieldControlProps>(
  ({ className, hasError, ...props }, ref) => {
    return (
      <BaseField.Control
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
FieldControl.displayName = "Field.Control";

// Compound export
export const Field = {
  Root: FieldRoot,
  Label: FieldLabel,
  Description: FieldDescription,
  Error: FieldError,
  Control: FieldControl,
};

// Simplified FormField component for common use cases
export interface FormFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "children"
> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
  inputClassName?: string;
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  (
    { label, description, error, required, className, inputClassName, id, name, ...inputProps },
    ref,
  ) => {
    const fieldId = id ?? name;

    return (
      <FieldRoot className={className}>
        {label && (
          <FieldLabel htmlFor={fieldId} required={required}>
            {label}
          </FieldLabel>
        )}
        {description && <FieldDescription>{description}</FieldDescription>}
        <FieldControl
          ref={ref}
          id={fieldId}
          name={name}
          hasError={!!error}
          className={inputClassName}
          {...inputProps}
        />
        {error && <FieldError>{error}</FieldError>}
      </FieldRoot>
    );
  },
);
FormField.displayName = "FormField";

// Textarea variant
export interface TextareaFieldProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "children"
> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
  textareaClassName?: string;
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  (
    { label, description, error, required, className, textareaClassName, id, name, ...props },
    ref,
  ) => {
    const fieldId = id ?? name;

    return (
      <FieldRoot className={className}>
        {label && (
          <FieldLabel htmlFor={fieldId} required={required}>
            {label}
          </FieldLabel>
        )}
        {description && <FieldDescription>{description}</FieldDescription>}
        <textarea
          ref={ref}
          id={fieldId}
          name={name}
          className={twMerge(
            "w-full rounded-lg border px-4 py-2.5 text-sm transition-colors",
            "bg-surface-700 text-surface-50 placeholder:text-surface-400",
            "border-surface-500 hover:border-surface-400",
            "focus:border-accent-500 focus:ring-1 focus:ring-accent-500 focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "min-h-[80px] resize-y",
            error && "border-red-500 focus:border-red-500 focus:ring-red-500",
            textareaClassName,
          )}
          {...props}
        />
        {error && <FieldError>{error}</FieldError>}
      </FieldRoot>
    );
  },
);
TextareaField.displayName = "TextareaField";
