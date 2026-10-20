import { supabaseStatus } from '../../scripts/supabase-status.mjs';

/** Points the integration tests at the running local Supabase stack, unless env already says otherwise. */
export default function setup() {
  // Mailpit's SMTP port (supabase/config.toml [local_smtp] smtp_port).
  process.env.SMTP_HOST ??= '127.0.0.1';
  process.env.SMTP_PORT ??= '54325';
  process.env.EMAIL_FROM ??= 'Booking & Matchmaking <bookings@localhost>';

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return;
  }
  const status = supabaseStatus();
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= status.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= status.PUBLISHABLE_KEY;
  process.env.SUPABASE_SECRET_KEY ??= status.SECRET_KEY;
}
