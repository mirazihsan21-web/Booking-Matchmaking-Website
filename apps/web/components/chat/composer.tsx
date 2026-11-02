"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { sendMessageAction } from "@/app/(site)/chat/actions";
import { m } from "@/messages";

/** The chat box: Enter sends (Shift+Enter is a new line); the box clears once the message is in. */
export function Composer({ onSent }: { onSent: () => void }) {
  const [state, action, pending] = useActionState(sendMessageAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const sentRef = useRef(onSent);
  useEffect(() => {
    sentRef.current = onSent;
  }, [onSent]);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      sentRef.current();
    }
  }, [state]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <textarea
          name="body"
          rows={2}
          aria-label={m.chat.boxLabel}
          placeholder={m.chat.placeholder}
          onKeyDown={keyDown}
          className="min-h-11 flex-1 resize-none rounded-xl border border-input bg-transparent px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {m.chat.send}
        </Button>
      </div>
      {state && !state.ok && state.message && (
        <p role="status" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
