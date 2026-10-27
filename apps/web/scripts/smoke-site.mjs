// Quick check that site pages render what they should, signed out, on the running dev server.
//   node apps/web/scripts/smoke-site.mjs "/|Coming up;Join match" "/turf|Book a space"
// Each argument is `path|text1;text2`: the page (redirects followed) must contain every text.
// Status codes are not checked: pages stream inside Suspense, so a not-found can arrive with 200.
const base = process.env.SITE_URL ?? 'http://localhost:3000';
const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');

for (const arg of process.argv.slice(2)) {
  const [path, texts = ''] = arg.split('|');
  const res = await fetch(base + path, { redirect: 'follow' });
  const html = decode(await res.text());
  const missing = texts.split(';').filter((t) => t && !html.includes(t));
  if (missing.length) {
    console.error(`FAIL ${path} (${res.status}): missing ${missing.map((t) => `"${t}"`).join(', ')}`);
    process.exit(1);
  }
}
console.log('ok');
