import type { EmailVerificationPurpose } from './accountSecurity.js';

export interface SendVerificationEmailResult {
  ok: boolean;
  configured: boolean;
  messageId?: string;
  error?: string;
}

const DEFAULT_FROM_EMAIL = 'noreply@apostlesofdeathmarried.ru';

/**
 * Sends a 6-digit email verification code via Resend REST API.
 * Uses process.env.RESEND_API_KEY and process.env.RESEND_FROM_EMAIL.
 * Never crashes the server when RESEND_API_KEY is unset.
 */
export async function sendVerificationCodeEmail(params: {
  to: string;
  code: string;
  purpose: EmailVerificationPurpose;
}): Promise<SendVerificationEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL).trim() || DEFAULT_FROM_EMAIL;

  if (!apiKey) {
    console.warn('[EmailService] RESEND_API_KEY is not configured; cannot send verification email to', params.to);
    return {
      ok: false,
      configured: false,
      error: 'Сервис отправки писем временно не настроен на сервере (RESEND_API_KEY). Попробуйте позже.',
    };
  }

  const subject =
    params.purpose === 'register'
      ? `Код подтверждения регистрации: ${params.code} — apostles of deathmarried`
      : `Код подтверждения почты: ${params.code} — apostles of deathmarried`;

  const actionText =
    params.purpose === 'register'
      ? 'Для завершения регистрации аккаунта в фан-сообществе apostles of deathmarried введите этот 6-значный код:'
      : 'Для подтверждения адреса электронной почты в профиле apostles of deathmarried введите этот 6-значный код:';

  const html = `
<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:24px;background-color:#08080a;color:#ded9d2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background-color:#111015;border:1px solid #2b262d;border-radius:12px;padding:28px;">
      <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#a8848c;margin-bottom:8px;">
        apostles of deathmarried
      </div>
      <h1 style="margin:0 0 14px 0;font-size:20px;font-weight:600;color:#f4f0ea;">
        Подтверждение электронной почты
      </h1>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#c2bbb0;">
        ${actionText}
      </p>
      <div style="background-color:#09090c;border:1px solid #721b2b;border-radius:10px;padding:18px;text-align:center;margin-bottom:20px;">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.32em;color:#f7f4ee;">
          ${params.code}
        </span>
      </div>
      <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#8e877e;">
        Код действителен в течение 10 минут. Никому не сообщайте этот код.
      </p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#6f6860;">
        Если вы не запрашивали подтверждение почты на apostlesofdeathmarried.ru, просто проигнорируйте это письмо.
      </p>
    </div>
  </body>
</html>
  `.trim();

  const text = [
    'apostles of deathmarried — Подтверждение электронной почты',
    '',
    actionText,
    '',
    `Ваш код: ${params.code}`,
    '',
    'Код действителен 10 минут. Если вы не запрашивали письмо, просто проигнорируйте его.',
  ].join('\n');

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail.includes('<') ? fromEmail : `apostles of deathmarried <${fromEmail}>`,
        to: [params.to],
        subject,
        html,
        text,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok) {
      console.error('[EmailService] Resend API error:', response.status, data?.message || data);
      return {
        ok: false,
        configured: true,
        error: 'Не удалось отправить письмо с кодом. Проверьте корректность адреса или повторите через минуту.',
      };
    }

    return {
      ok: true,
      configured: true,
      messageId: data.id,
    };
  } catch (err: any) {
    console.error('[EmailService] Network error calling Resend:', err?.message || err);
    return {
      ok: false,
      configured: true,
      error: 'Сетевая ошибка при отправке письма. Повторите попытку чуть позже.',
    };
  }
}
