import { describe, expect, it } from 'vitest';
import { createEmailSender, smtpOptions } from '../lib/email/sender';

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

  it('connects to a local test inbox without a login', () => {
    expect(smtpOptions({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325' })).toEqual({ host: '127.0.0.1', port: 54325, secure: false });
  });

  it('logs in to a real mail server such as Gmail over a secure connection', () => {
    expect(smtpOptions({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'app-password' })).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'me@gmail.com', pass: 'app-password' },
    });
    expect(smtpOptions({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'x' }).secure).toBe(false);
  });

  it('names the missing half of a login', () => {
    expect(() => smtpOptions({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'me@gmail.com' })).toThrow('SMTP_PASS');
    expect(() => smtpOptions({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_PASS: 'x' })).toThrow('SMTP_USER');
  });

  it('builds a working sender when configured', () => {
    expect(typeof createEmailSender({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', EMAIL_FROM: 'a@b.c' }).send).toBe('function');
  });
});
