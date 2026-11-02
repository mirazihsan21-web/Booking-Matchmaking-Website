import type { ReactNode } from "react";
import { m } from "@/messages";
import { ChatTabs } from "./chat-tabs";

/** The private pages' frame: the chat's title and the Everyone · Private tabs. */
export function PrivateShell({ children, privateUnread }: { children: ReactNode; privateUnread: number }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl uppercase tracking-wide">{m.chat.title}</h1>
        <ChatTabs active="private" privateUnread={privateUnread} />
      </header>
      {children}
    </main>
  );
}
