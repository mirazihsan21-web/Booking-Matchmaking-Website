// Local development sends as bookings@localhost, so the domain needn't have a dot.
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/;

/**
 * The address people can write to about the site (privacy questions, deletion requests): the one the site sends
 * its email from, `EMAIL_FROM` ("Name <address>" or a bare address). Null when there is no usable address.
 */
export function contactEmail(from: string | undefined): string | null {
  const value = from?.trim() ?? '';
  const address = value.match(/<([^>]*)>\s*$/)?.[1]?.trim() ?? value;
  return ADDRESS.test(address) ? address : null;
}
