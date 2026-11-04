"use client";

import { useState } from "react";
import { ActionForm, Field, type FormAction } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { m } from "@/messages";

/** Reject a payment, asking first, with an optional reason the player sees (up to 200 characters). */
export function RejectPayment({ action }: { action: FormAction }) {
  const [asking, setAsking] = useState(false);
  const t = m.manage.payments;
  if (!asking) {
    return (
      <Button type="button" variant="ghost" onClick={() => setAsking(true)}>
        {t.reject}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={t.rejectQuestion} className="flex w-full flex-col gap-2 rounded-lg bg-raised p-3 text-sm">
      <p>{t.rejectQuestion}</p>
      <ActionForm action={action} submitLabel={t.yesReject} variant="destructive">
        <Field name="reason" label={t.reason} maxLength={200} placeholder="Payment not found" />
      </ActionForm>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAsking(false)}>
        {t.keep}
      </Button>
    </div>
  );
}
