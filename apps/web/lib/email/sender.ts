import nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The sender the job tick uses, from environment variables:
 * - `EMAIL_TRANSPORT=smtp` with `SMTP_HOST` / `SMTP_PORT` (Mailpit locally on 54325);
 * - `EMAIL_TRANSPORT=resend` with `RESEND_API_KEY` (production, Stage E).
 * Both need `EMAIL_FROM`. Misconfiguration throws at creation, naming the missing variable.
 */
export function createEmailSender(env: Record<string, string | undefined>): EmailSender {
  const transport = env.EMAIL_TRANSPORT;
  if (transport !== 'smtp' && transport !== 'resend') throw new Error('EMAIL_TRANSPORT must be "smtp" or "resend"');

  if (transport === 'smtp') {
    const host = required(env, 'SMTP_HOST');
    const port = Number(required(env, 'SMTP_PORT'));
    const from = required(env, 'EMAIL_FROM');
    const mailer = nodemailer.createTransport({ host, port, secure: false });
    return {
      async send(message) {
        await mailer.sendMail({ from, ...message });
      },
    };
  }

  const apiKey = required(env, 'RESEND_API_KEY');
  const from = required(env, 'EMAIL_FROM');
  return {
    async send(message) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, ...message }),
      });
      if (!response.ok) throw new Error(`Resend refused the email (HTTP ${response.status})`);
    },
  };
}
