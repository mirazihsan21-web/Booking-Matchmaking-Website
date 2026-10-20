import Link from "next/link";
import { Suspense } from "react";
import { MarkAllRead } from "@/components/notifications/mark-all-read";
import { requireUser } from "@/lib/auth/dal";
import { formatNight } from "@/lib/format";
import { listNotifications } from "@/lib/notifications/inbox";
import { renderNotification } from "@/lib/notifications/render";
import { createClient } from "@/lib/supabase/server";
import { getPlayer } from "@/lib/tenancy/player";
import { cn } from "@/lib/utils";
import { m } from "@/messages";
import { markAllReadAction } from "./actions";

async function Notifications({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireUser("/me/notifications");
  const player = await getPlayer(slug);
  if (!player?.profileId) return <p className="text-foreground/60">{m.notifications.none}</p>;
  const items = await listNotifications(await createClient(), player.profileId, player.org.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{m.notifications.title}</h1>
      <MarkAllRead action={markAllReadAction.bind(null, slug)} />
      {items.length === 0 ? (
        <p className="text-foreground/60">{m.notifications.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => {
            const { title, body } = renderNotification(n, player.org.timezone);
            return (
              <li key={n.id}>
                <Link href={n.link} className={cn("flex flex-col gap-1 rounded-lg border border-border px-4 py-3 hover:bg-foreground/5", !n.readAt && "border-primary")}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium">{title}</span>
                    <span className="text-xs text-foreground/60">{formatNight(n.createdAt, player.org.timezone)}</span>
                  </span>
                  {body && <span className="text-sm text-foreground/80">{body}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function NotificationsPage({ params }: PageProps<"/t/[slug]/me/notifications">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <Suspense fallback={null}>
        <Notifications params={params} />
      </Suspense>
    </main>
  );
}
