import { cancelBookingAction } from "@/app/(root)/manage/bookings/actions";
import { setDeskStatusAction } from "@/app/(root)/manage/desk-actions";
import type { DeskBooking } from "@/lib/manage/desk-day";
import type { PanelActions, PanelBooking } from "./booking-panel";

/** A desk booking as its panel shows it, with its actions bound to that booking. */
export function panelFor(b: DeskBooking, spaceName: string): { booking: PanelBooking; actions: PanelActions } {
  return {
    booking: {
      id: b.id,
      name: b.name,
      phone: b.phone,
      status: b.status,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      pricePoisha: b.pricePoisha,
      spaceName,
      paidPoisha: b.payment?.amountPoisha ?? null,
    },
    actions: {
      arrived: setDeskStatusAction.bind(null, "space", b.id, "attended"),
      noShow: setDeskStatusAction.bind(null, "space", b.id, "no_show"),
      undo: setDeskStatusAction.bind(null, "space", b.id, "confirmed"),
      cancel: cancelBookingAction.bind(null, b.id),
    },
  };
}
