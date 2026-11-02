"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { FormState } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { m } from "@/messages";
import { PhotoPicker } from "./photo-picker";

export type SendResult = (FormState & { conversationId?: string }) | null;
export type SendAction = (state: SendResult, formData: FormData) => Promise<SendResult>;

/**
 * The chat box (the room's or a private conversation's): words and/or a photo. Enter sends (Shift+Enter is a new
 * line); the box and the photo clear once the message is in. `hidden` adds fields (e.g. who a private message is for).
 */
export function Composer({
  action: send,
  hidden,
  userId,
  onSent,
}: {
  action: SendAction;
  hidden?: Record<string, string>;
  userId: string;
  onSent: (result: SendResult) => void;
}) {
  const [state, action, pending] = useActionState(send, null);
  const [round, setRound] = useState(0); // a new photo picker after each sent message
  const formRef = useRef<HTMLFormElement>(null);
  const sentRef = useRef(onSent);
  useEffect(() => {
    sentRef.current = onSent;
  }, [onSent]);

  // Each sent message gets a fresh photo picker (adjusted while rendering, as React suggests).
  const [handled, setHandled] = useState<SendResult>(null);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setRound((n) => n + 1);
  }

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      sentRef.current(state);
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
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
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
      <PhotoPicker key={round} userId={userId} />
      {state && !state.ok && state.message && (
        <p role="status" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
