import Link from "next/link";
import { Suspense } from "react";
import { cn } from "cn";
import { MarkAllRead } from "@/components/notifications/mark-all-read";
import { MeTabs } from "@/components/site/me-tabs";
import { sectionStyle } from "@/components/site/section-style";
import { requireUser } from "@/lib/auth/dal";
import { formatNight } from "@/lib/format";
import { listNotifications } from "@/lib/notifications/inbox";
import { renderNotification } from "@/lib/notifications/render";
import { createClient } from "@/lib/supabase/server";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { markAllReadAction } from "./actions";

async function Notifications() {
  await requireUser("/me/notifications");
  const player = await getSitePlayer();
  const items = player?.profileId ? await listNotifications(await createClient(), player.profileId, player.brand.id) : [];
  const tz = player?.brand.timezone ?? "Asia/Dhaka";
  // A notification names its section (payload.section_name); its row takes that section's colour.
  const sectionNamed = (name: unknown) => player?.brand.sections.find((s) => s.name === name);

  return (
    <div className="flex flex-col gap-6">
      <MeTabs active="notifications" />
      <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">{m.notifications.title}</h1>
      {player?.profileId && <MarkAllRead action={markAllReadAction} />}
      {items.length === 0 ? (
        <p className="text-muted-foreground">{m.notifications.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => {
            const { title, body } = renderNotification(n, tz);
            const section = sectionNamed(n.payload.section_name);
            return (
              <li key={n.id} style={section ? sectionStyle(section.accent) : undefined}>
                <Link
                  href={n.link}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border-l-[3px] bg-card px-4 py-3 hover:bg-raised",
                    section ? "border-section" : "border-border",
                    !n.readAt && "ring-1 ring-foreground/30",
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">
                      {!n.readAt && <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-warning align-middle" />}
                      {title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatNight(n.createdAt, tz)}</span>
                  </span>
                  {body && <span className="text-sm text-muted-foreground">{body}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <Notifications />
      </Suspense>
    </main>
  );
}
