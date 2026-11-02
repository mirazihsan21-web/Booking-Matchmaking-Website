import Link from "next/link";
import { cn } from "cn";
import { m } from "@/messages";

/** Everyone (the room) · Private (your conversations, with the unread count). */
export function ChatTabs({ active, privateUnread }: { active: "everyone" | "private"; privateUnread: number }) {
  const tab = (href: string, label: string, on: boolean, count = 0) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold", on ? "bg-raised text-foreground" : "text-muted-foreground hover:bg-raised")}
    >
      {label}
      {count > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{count}</span>}
    </Link>
  );
  return (
    <nav className="flex gap-1">
      {tab("/chat", m.chat.private.everyone, active === "everyone")}
      {tab("/chat/private", m.chat.private.title, active === "private", privateUnread)}
    </nav>
  );
}
