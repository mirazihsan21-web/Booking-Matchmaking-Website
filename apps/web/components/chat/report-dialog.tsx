"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { reportAction } from "@/app/(site)/chat/actions";
import { Button } from "@/components/ui/button";
import { m } from "@/messages";

/**
 * Report a message: spam, rude or abusive, or other, with an optional note. `onReported` gets the thanks, so the
 * menu can keep showing it even when this report is the one that hides the message (and the form goes away).
 */
export function ReportDialog({ messageId, onReported }: { messageId: string; onReported: (thanks: string) => void }) {
  const [state, action, pending] = useActionState(reportAction, null);
  const reported = useRef(onReported);
  useEffect(() => {
    reported.current = onReported;
  }, [onReported]);
  useEffect(() => {
    if (state?.ok && state.message) reported.current(state.message);
  }, [state]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 p-2 text-sm">
      <input type="hidden" name="messageId" value={messageId} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-semibold">{m.chat.reportTitle}</legend>
        {(["spam", "abuse", "other"] as const).map((reason) => (
          <label key={reason} className="flex items-center gap-2">
            <input type="radio" name="reason" value={reason} defaultChecked={reason === "spam"} className="accent-foreground" />
            {m.chat.reasons[reason]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span>{m.chat.reportNote}</span>
        <textarea name="note" rows={2} className="rounded-lg border border-input bg-transparent px-2 py-1" />
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {m.chat.sendReport}
      </Button>
      {state && !state.ok && state.message && (
        <p role="status" className="text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
