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
 * SMTP connection settings: `SMTP_HOST` / `SMTP_PORT`, plus `SMTP_USER` / `SMTP_PASS` for a server that
 * needs a login (e.g. Gmail with an App Password: smtp.gmail.com, port 465). Port 465 is TLS from the
 * start; other ports (587, Mailpit's 54325) upgrade with STARTTLS when the server offers it.
 */
export function smtpOptions(env: Record<string, string | undefined>): {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
} {
  const host = required(env, 'SMTP_HOST');
  const port = Number(required(env, 'SMTP_PORT'));
  const options = { host, port, secure: port === 465 };
  if (!env.SMTP_USER && !env.SMTP_PASS) return options;
  return { ...options, auth: { user: required(env, 'SMTP_USER'), pass: required(env, 'SMTP_PASS') } };
}

/**
 * The sender the job tick uses, from environment variables:
 * - `EMAIL_TRANSPORT=smtp` with `smtpOptions` (Mailpit locally on 54325, or Gmail);
 * - `EMAIL_TRANSPORT=resend` with `RESEND_API_KEY` (needs a verified domain).
 * Both need `EMAIL_FROM` (for Gmail, the Gmail address itself). Misconfiguration throws at creation,
 * naming the missing variable.
 */
export function createEmailSender(env: Record<string, string | undefined>): EmailSender {
  const transport = env.EMAIL_TRANSPORT;
  if (transport !== 'smtp' && transport !== 'resend') throw new Error('EMAIL_TRANSPORT must be "smtp" or "resend"');

  if (transport === 'smtp') {
    const options = smtpOptions(env);
    const from = required(env, 'EMAIL_FROM');
    const mailer = nodemailer.createTransport(options);
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
