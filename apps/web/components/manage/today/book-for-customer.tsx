import { X } from "lucide-react";
import Link from "next/link";
import { deskBookAction } from "@/app/(root)/manage/desk-actions";
import { ActionForm, Field, FieldError, SelectField } from "@/components/forms/action-form";
import { m } from "@/messages";

/**
 * The desk books a space for a walk-in or phone customer. Picking the space and day reloads the page with
 * that space's free starts (`?book=<space>&date=`); then start, length, name and phone → Book.
 */
export function BookForCustomer({
  groups,
  resourceId,
  date,
  starts,
  picked,
}: {
  groups: Array<{ name: string; spaces: Array<{ id: string; name: string }> }>;
  resourceId: string;
  date: string;
  starts: Array<{ value: string; label: string }>;
  picked: string | null;
}) {
  const b = m.manage.book;
  return (
    <section aria-labelledby="book-for-customer" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="book-for-customer" className="font-display text-2xl uppercase tracking-wide">
          {b.title}
        </h2>
        <Link href="/manage" aria-label={b.close} className="rounded-full p-1.5 hover:bg-raised">
          <X className="size-5" />
        </Link>
      </div>
      <form method="get" action="/manage" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {b.space}
          <select name="book" defaultValue={resourceId} className="h-9 rounded-lg border border-input bg-raised px-2">
            {groups.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {b.day}
          <input type="date" name="date" defaultValue={date} className="h-9 rounded-lg border border-input bg-raised px-2" />
        </label>
        <button type="submit" className="h-9 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-raised">
          {b.showTimes}
        </button>
      </form>
      {starts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{b.noTimes}</p>
      ) : (
        <ActionForm action={deskBookAction} submitLabel={b.book} resetOnSuccess className="gap-4">
          <input type="hidden" name="resourceId" value={resourceId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField name="startsAt" label={b.start} options={starts} defaultValue={picked ?? starts[0]!.value} />
            <SelectField
              name="slots"
              label={m.staffBookings.howLong}
              options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
              defaultValue="1"
            />
            <Field name="guestName" label={m.staffBookings.guestName} required maxLength={60} />
            <Field name="guestPhone" label={m.staffBookings.guestPhone} type="tel" placeholder="01712345678" required />
          </div>
          <FieldError name="startsAt" />
        </ActionForm>
      )}
    </section>
  );
}
