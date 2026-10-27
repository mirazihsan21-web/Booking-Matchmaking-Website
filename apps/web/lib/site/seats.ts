/** How full a game is, for its seats bar: amber when almost full (2 seats or fewer), "full" at none. */
export function seatsLevel(left: number): 'plenty' | 'low' | 'full' {
  if (left <= 0) return 'full';
  return left <= 2 ? 'low' : 'plenty';
}
