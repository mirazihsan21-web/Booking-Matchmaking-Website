-- Players chat (stage C1): the notifications the chat sends. On their own, so the new values are committed before
-- anything uses them (Postgres refuses a new enum value inside the transaction that added it).
alter type public.notification_kind add value if not exists 'chat_join_request';
alter type public.notification_kind add value if not exists 'chat_join_accepted';
alter type public.notification_kind add value if not exists 'chat_join_declined';
alter type public.notification_kind add value if not exists 'chat_join_left';
alter type public.notification_kind add value if not exists 'chat_card_closed';
alter type public.notification_kind add value if not exists 'chat_game_cancelled';
