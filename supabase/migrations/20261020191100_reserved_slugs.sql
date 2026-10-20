-- Stage A review fix: with self-serve signup anyone can claim <slug>.<platform domain>, so names that
-- invite phishing on the platform's own domain are reserved, and so are punycode (xn--) labels, which
-- browsers show as look-alike Unicode. Mirrors RESERVED_SLUGS in apps/web/lib/tenancy/slug.ts.

alter table public.organizations drop constraint organizations_slug_check1;
alter table public.organizations add constraint organizations_slug_reserved_check check (
  slug !~ '^xn--'
  and slug not in (
    'www', 'app', 'admin', 'api', 'manage', 'auth', 'static', 't', 'help', 'support', 'status', 'docs', 'blog', 'mail',
    'login', 'signin', 'signup', 'register', 'account', 'accounts', 'verify', 'secure', 'security',
    'pay', 'payment', 'payments', 'checkout', 'billing', 'wallet', 'bkash', 'nagad',
    'dev', 'staging', 'cdn', 'assets', 'media', 'onboarding'
  )
);
