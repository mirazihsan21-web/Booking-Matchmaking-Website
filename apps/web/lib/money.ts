/** Money is stored as integer poisha (1 BDT = 100 poisha). */

const AMOUNT = /^\d+(\.\d{1,2})?$/;

/** Parses what an owner types ("2500", "2,500", "৳2,500.50") into poisha; null if it isn't a valid amount. */
export function bdtToPoisha(input: string): number | null {
  const cleaned = input.trim().replace(/^৳/, '').replace(/,/g, '').trim();
  if (!AMOUNT.test(cleaned)) return null;
  const [taka, poisha = ''] = cleaned.split('.');
  return Number(taka) * 100 + Number(poisha.padEnd(2, '0'));
}

/** `250000` → `'৳2,500'`; `250050` → `'৳2,500.50'`. */
export function formatBdt(poisha: number): string {
  const taka = Math.floor(poisha / 100);
  const rest = poisha % 100;
  const whole = taka.toLocaleString('en-US');
  return rest === 0 ? `৳${whole}` : `৳${whole}.${String(rest).padStart(2, '0')}`;
}
