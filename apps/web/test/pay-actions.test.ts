import { beforeEach, describe, expect, it, vi } from 'vitest';

// "I've sent it" answers the player straight away; the "Payment to check" email to the team goes out after the
// reply (next/server `after`). Here the email's work never finishes, so an action that waited for it never answers.
const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  refresh: vi.fn(),
  submitClaim: vi.fn(),
  payBooking: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('next/cache', () => ({ refresh: mocks.refresh }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/service-client', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/tenancy/player', () => ({
  getSitePlayer: async () => ({
    profileId: 'profile-1',
    user: { id: 'user-1' },
    brand: { id: 'brand-1', name: 'Chattoturf', timezone: 'Asia/Dhaka', branding: {}, sections: [] },
  }),
}));
vi.mock('@/lib/payments/claims', () => ({ submitClaim: mocks.submitClaim, payBooking: mocks.payBooking }));

const { submitClaimAction } = await import('@/app/(site)/me/bookings/[id]/pay/actions');

function form(): FormData {
  const data = new FormData();
  data.set('method', 'bkash');
  data.set('senderPhone', '01911111111');
  data.set('trxId', '9JK7ABC123');
  return data;
}

describe('submitClaimAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitClaim.mockResolvedValue('submitted');
    mocks.payBooking.mockReturnValue(new Promise(() => {})); // the team email's lookup never finishes
  });

  it('answers straight away and tells the team after the reply', async () => {
    const answer = await Promise.race([
      submitClaimAction('booking-1', { ok: false }, form()),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 500)),
    ]);
    expect(answer).toEqual({ ok: true, message: 'Payment sent — waiting for the venue to confirm' });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.payBooking).not.toHaveBeenCalled(); // not until after the reply
    mocks.after.mock.calls[0]![0](); // the work handed to `after` is the team email
    expect(mocks.payBooking).toHaveBeenCalledOnce();
  });

  it('a refused send tells nobody', async () => {
    mocks.submitClaim.mockResolvedValue('trx_used');
    expect(await submitClaimAction('booking-1', { ok: false }, form())).toEqual({ ok: false, errors: { trxId: 'That transaction ID has already been used.' } });
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
