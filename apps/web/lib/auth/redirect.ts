/** Only same-site relative paths are allowed after sign-in, so a crafted link can't bounce users elsewhere. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next;
}
