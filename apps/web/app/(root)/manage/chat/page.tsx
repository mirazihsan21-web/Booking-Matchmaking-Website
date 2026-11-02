import Link from "next/link";
import { Suspense } from "react";
import { ActionButton, ActionForm, Field } from "@/components/forms/action-form";
import { blockedWords, listMutes, listOpenReports } from "@/lib/chat/moderation";
import { chatTime } from "@/lib/chat/time";
import { formatNight } from "@/lib/format";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { addWordAction, muteFromReportAction, removeWordAction, resolveReportsAction, unmuteAction } from "./actions";

const t = m.manage.chat;

async function ChatAdmin() {
  const { org } = await requireManager("staff");
  const db = createServiceClient();
  const [reports, mutes, words] = await Promise.all([listOpenReports(db, org.id), listMutes(db, org.id), blockedWords(db, org.id)]);
  const now = new Date();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl uppercase tracking-wide">{t.title}</h1>
        <p className="text-muted-foreground">{t.intro}</p>
        <Link href="/chat" className="self-start text-sm font-semibold underline">
          {t.openChat}
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">{t.reportsTitle}</h2>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noReports}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((r) => (
              <li key={r.messageId} className="flex flex-col gap-3 rounded-xl bg-card p-4">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{r.authorName}</span> · {chatTime(r.createdAt, org.timezone, now)}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{r.bodyCopy ?? t.noText}</p>
                  {r.state === "hidden_by_reports" && <p className="text-xs font-semibold text-destructive">{t.hidden}</p>}
                </div>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {r.reports.map((report, i) => (
                    <li key={i}>
                      {t.reportedBy(report.reporterName, m.chat.reasons[report.reason] ?? report.reason)}
                      {report.note ? ` — “${report.note}”` : ""}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={resolveReportsAction.bind(null, r.messageId, "remove")} label={t.remove} variant="destructive" />
                  <ActionButton action={resolveReportsAction.bind(null, r.messageId, "dismiss")} label={t.dismiss} />
                  {r.authorProfileId &&
                    (["1", "7", "forever"] as const).map((length) => (
                      <ActionButton key={length} action={muteFromReportAction.bind(null, r.authorProfileId!, length)} label={m.chat.muteFor[length]!} />
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">{t.mutesTitle}</h2>
        {mutes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noMutes}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mutes.map((mute) => (
              <li key={mute.profileId} className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3">
                <span className="font-semibold">{mute.name}</span>
                <span className="text-sm text-muted-foreground">{mute.until ? t.until(formatNight(mute.until, org.timezone)) : t.untilUnmuted}</span>
                <span className="ml-auto">
                  <ActionButton action={unmuteAction.bind(null, mute.profileId)} label={t.unmute} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">{t.wordsTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.wordsIntro}</p>
        <ActionForm action={addWordAction} submitLabel={t.addWord} resetOnSuccess className="max-w-sm">
          <Field name="word" label={t.wordLabel} autoComplete="off" />
        </ActionForm>
        {words.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noWords}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {words.sort().map((word) => (
              <li key={word} className="flex items-center gap-2 rounded-lg bg-card py-1 pl-3 pr-1 text-sm">
                {word}
                <ActionButton action={removeWordAction.bind(null, word)} label={t.removeWord} variant="ghost" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ManageChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatAdmin />
    </Suspense>
  );
}
