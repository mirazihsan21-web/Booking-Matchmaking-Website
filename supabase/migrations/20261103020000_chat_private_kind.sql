-- Players chat (stage C2): the unread private-message notification. On its own, so the value is committed before use.
alter type public.notification_kind add value if not exists 'chat_private_message';
