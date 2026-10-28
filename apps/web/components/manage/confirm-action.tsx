"use client";

import { useState } from "react";
import { ActionButton, type FormAction } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";

/** A button that asks first: the question, then the action itself or a way back. */
export function ConfirmAction({ action, label, question, confirmLabel, cancelLabel }: { action: FormAction; label: string; question: string; confirmLabel: string; cancelLabel: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2 rounded-lg bg-raised px-3 py-2 text-sm">
      <span>{question}</span>
      <ActionButton action={action} label={confirmLabel} variant="destructive" />
      <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)}>
        {cancelLabel}
      </Button>
    </div>
  );
}
