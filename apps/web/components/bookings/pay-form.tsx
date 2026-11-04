"use client";

import { useState } from "react";
import { ActionForm, Field, FieldError, type FormAction } from "@/components/forms/action-form";
import { m } from "@/messages";

/** One of the venue's numbers to send money to, with a Copy button (mobile apps paste it into Send Money). */
export function PayNumber({ method, number }: { method: "bkash" | "nagad"; number: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg bg-raised px-3 py-2">
      <span className="font-semibold">{m.payments[method]}</span>
      <span className="font-mono text-lg">{number}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(number).then(() => setCopied(true), () => undefined);
        }}
        className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-card"
      >
        {copied ? m.payments.copied : m.payments.copy}
      </button>
    </li>
  );
}

/**
 * What the player sent: bKash or Nagad (only the services the venue has a number for; picked already when there is
 * one), the number they sent from, and the transaction ID from their confirmation message.
 */
export function PayForm({ action, methods }: { action: FormAction; methods: Array<"bkash" | "nagad"> }) {
  return (
    <ActionForm action={action} submitLabel={m.payments.sent} variant="section">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">{m.payments.paidWith}</legend>
        <div className="flex gap-4">
          {methods.map((method) => (
            <label key={method} className="flex items-center gap-2">
              <input type="radio" name="method" value={method} defaultChecked={methods.length === 1} className="accent-foreground" />
              {m.payments[method]}
            </label>
          ))}
        </div>
        <FieldError name="method" />
      </fieldset>
      <Field name="senderPhone" label={m.payments.senderPhone} inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" />
      <Field name="trxId" label={m.payments.trxId} autoComplete="off" autoCapitalize="characters" />
    </ActionForm>
  );
}
