import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandLine, envSummary, vaultSql, vercelAddArgs, vercelEnvironment } from '../scripts/vercel-env-core.mjs';

const secrets = {
  secretKey: 'sb_secret_TESTONLY0000',
  jobSecret: 'a'.repeat(64),
  gmailAppPassword: 'abcd efgh ijkl mnop',
};
const input = {
  supabaseUrl: 'https://rhycdpswtiitjhzoczfq.supabase.co',
  publishableKey: 'sb_publishable_TESTONLY',
  host: 'chattoturf-x1.vercel.app',
  brandSlug: 'chattoturf',
  gmail: 'chattoturf.bd@gmail.com',
  ...secrets,
};

describe('vercelEnvironment', () => {
  const vars = vercelEnvironment(input);
  const value = (name: string) => vars.find((v) => v.name === name)?.value;

  it('sets exactly the production variables', () => {
    expect(vars.map((v) => v.name)).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SECRET_KEY',
      'NEXT_PUBLIC_ROOT_DOMAIN',
      'NEXT_PUBLIC_GOOGLE_AUTH_ENABLED',
      'BRAND_SLUG',
      'JOB_SECRET',
      'EMAIL_TRANSPORT',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'EMAIL_FROM',
      'ENABLE_EXPERIMENTAL_COREPACK',
    ]);
  });

  it('uses the host it is given and the brand Gmail over SMTP', () => {
    expect(value('NEXT_PUBLIC_ROOT_DOMAIN')).toBe('chattoturf-x1.vercel.app');
    expect(value('NEXT_PUBLIC_GOOGLE_AUTH_ENABLED')).toBe('true');
    expect(value('BRAND_SLUG')).toBe('chattoturf');
    expect(value('EMAIL_TRANSPORT')).toBe('smtp');
    expect(value('SMTP_HOST')).toBe('smtp.gmail.com');
    expect(value('SMTP_PORT')).toBe('465');
    expect(value('SMTP_USER')).toBe('chattoturf.bd@gmail.com');
    expect(value('EMAIL_FROM')).toBe('Chattoturf <chattoturf.bd@gmail.com>');
    expect(value('ENABLE_EXPERIMENTAL_COREPACK')).toBe('1');
  });

  it('marks only the three secrets sensitive', () => {
    expect(vars.filter((v) => v.sensitive).map((v) => v.name)).toEqual(['SUPABASE_SECRET_KEY', 'JOB_SECRET', 'SMTP_PASS']);
  });

  it('tells the Vercel CLI the type of each variable, so plain ones stay readable (final review, Important 1)', () => {
    // --force replaces an existing value in one step, so a failure part-way never leaves a variable removed.
    expect(vercelAddArgs({ name: 'SMTP_USER', sensitive: false })).toEqual(['env', 'add', 'SMTP_USER', 'production', '--no-sensitive', '--force']);
    expect(vercelAddArgs({ name: 'SMTP_PASS', sensitive: true })).toEqual(['env', 'add', 'SMTP_PASS', 'production', '--sensitive', '--force']);
    for (const v of vars) expect(vercelAddArgs(v)).toContain(v.sensitive ? '--sensitive' : '--no-sensitive');
  });

  it('summarises by name, never by value (Review Focus 2)', () => {
    const summary = envSummary(vars);
    for (const v of vars) expect(summary).toContain(v.name);
    for (const s of Object.values(secrets)) expect(summary).not.toContain(s);
  });
});

describe('commandLine', () => {
  it('joins fixed words into one shell command, quoting a path with a space', () => {
    expect(commandLine(['pnpm', 'exec', 'supabase', 'db', 'query', '--linked', '-f', 'C:/Users/A B/Temp/vault.sql'])).toBe(
      'pnpm exec supabase db query --linked -f "C:/Users/A B/Temp/vault.sql"',
    );
  });

  it('refuses anything a shell could read as more than one word', () => {
    expect(() => commandLine(['pnpm', 'x"; rm -rf /'])).toThrow();
    expect(() => commandLine(['pnpm', 'a&b'])).toThrow();
  });
});

describe('vaultSql', () => {
  it('replaces both Vault secrets, pointing the tick at the site', () => {
    const sql = vaultSql({ appUrl: 'https://chattoturf-x1.vercel.app', jobSecret: secrets.jobSecret });
    expect(sql).toContain("'https://chattoturf-x1.vercel.app'");
    expect(sql.match(/vault\.create_secret/g)).toHaveLength(2);
    expect(sql).toMatch(/delete from vault\.secrets where name in \('app_url', 'job_secret'\)/);
  });

  it('refuses anything that is not an https address and a 64-hex secret', () => {
    expect(() => vaultSql({ appUrl: 'http://x', jobSecret: secrets.jobSecret })).toThrow();
    expect(() => vaultSql({ appUrl: "https://x.vercel.app'; drop table t; --", jobSecret: secrets.jobSecret })).toThrow();
    expect(() => vaultSql({ appUrl: 'https://x.vercel.app', jobSecret: "abc'; drop table x; --" })).toThrow();
  });
});

describe('deploy settings', () => {
  it('runs next to the database and deploys only main (Review Focus 3)', () => {
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(vercel.regions).toEqual(['icn1']);
    expect(vercel.git.deploymentEnabled).toEqual({ '**': false, main: true });
  });

  it('builds on Node 24', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.engines.node).toBe('24.x');
  });
});
