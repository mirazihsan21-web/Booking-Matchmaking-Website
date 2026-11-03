-- Paying for online bookings by bKash or Nagad: the new enum values, in their own migration (a value can't be
-- used in the transaction that adds it). A booking can be pending while the venue checks the payment; a player
-- hears when their hold ended or their payment wasn't found.
alter type public.resource_booking_status add value if not exists 'pending';
alter type public.notification_kind add value if not exists 'booking_hold_expired';
alter type public.notification_kind add value if not exists 'booking_payment_rejected';
