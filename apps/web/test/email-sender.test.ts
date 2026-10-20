import { describe, expect, it } from 'vitest';
import { createEmailSender } from '../lib/email/sender';

describe('createEmailSender', () => {
  it('needs a transport', () => {
    expect(() => createEmailSender({})).toThrow('EMAIL_TRANSPORT');
    expect(() => createEmailSender({ EMAIL_TRANSPORT: 'pigeon', EMAIL_FROM: 'a@b.c' })).toThrow('EMAIL_TRANSPORT');
  });

  it('names the missing SMTP setting', () => {
    expect(() => createEmailSender({ EMAIL_TRANSPORT: 'smtp', SMTP_PORT: '54325', EMAIL_FROM: 'a@b.c' })).toThrow('SMTP_HOST');
  });

  it('needs a Resend key for Resend', () => {
    expect(() => createEmailSender({ EMAIL_TRANSPORT: 'resend', EMAIL_FROM: 'a@b.c' })).toThrow('RESEND_API_KEY');
  });

  it('needs a sender address', () => {
    expect(() => createEmailSender({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325' })).toThrow('EMAIL_FROM');
  });

  it('builds a working sender when configured', () => {
    expect(typeof createEmailSender({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', EMAIL_FROM: 'a@b.c' }).send).toBe('function');
  });
});
