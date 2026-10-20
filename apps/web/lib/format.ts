/** `'8pm'`, `'8:30pm'`, `'10am'` in the venue's timezone. */
export function formatShortTime(iso: string, timeZone: string): string {
  const text = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
  return text.toLowerCase().replace(/\s/g, '').replace(':00', '');
}

/** `'Sat 24 Oct, 8pm'` in the venue's timezone. */
export function formatNight(iso: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone })
    .format(new Date(iso))
    .replace(',', '');
  return `${day}, ${formatShortTime(iso, timeZone)}`;
}
