"use client";

import { createContext, useActionState, useContext, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** What every form server action returns: a message and/or per-field errors. */
export type FormState = { ok: boolean; message?: string; errors?: Record<string, string> } | null;
export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const FormStateContext = createContext<FormState>(null);
export const useFormState = () => useContext(FormStateContext);

/** A form wired to a server action with useActionState; fields read their errors from context. */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  variant = "default",
}: {
  action: FormAction;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  variant?: "default" | "outline" | "destructive" | "ghost";
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <FormStateContext value={state}>
      <form action={formAction} className={cn("flex flex-col gap-3", className)}>
        {children}
        <div className="flex items-center gap-3">
          <Button type="submit" variant={variant} disabled={pending}>
            {submitLabel}
          </Button>
          {state?.message && (
            <p role="status" className={cn("text-sm", state.ok ? "text-foreground/70" : "text-destructive")}>
              {state.message}
            </p>
          )}
        </div>
      </form>
    </FormStateContext>
  );
}

/** A one-button form (toggle, delete, publish) that still shows the action's message. */
export function ActionButton({ action, label, variant = "outline" }: { action: FormAction; label: string; variant?: "default" | "outline" | "destructive" | "ghost" }) {
  return <ActionForm action={action} submitLabel={label} variant={variant} className="inline-flex" />;
}

export function FieldError({ name }: { name: string }) {
  const error = useFormState()?.errors?.[name];
  return error ? <p className="text-xs text-destructive">{error}</p> : null;
}

/** Label + input + its error. Extra props go to the input. */
export function Field({ name, label, ...props }: { name: string; label: string } & React.ComponentProps<"input">) {
  const invalid = Boolean(useFormState()?.errors?.[name]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={invalid || undefined} {...props} />
      <FieldError name={name} />
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError name={name} />
    </div>
  );
}
