import nodemailer from 'nodemailer';

const DEFAULT_FROM = 'UltraGameStudio <noreply@mail.ultragamestudio.com>';
const DEFAULT_SMTP_HOST = 'smtp.qcloudmail.com';
const DEFAULT_SMTP_PORT = 465;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function codeMail({ code, purpose }) {
  const title =
    purpose === 'password_reset'
      ? 'UltraGameStudio 密码重置验证码'
      : 'UltraGameStudio 邮箱验证码';
  const action = purpose === 'password_reset' ? '重置密码' : '验证邮箱';
  const text = [
    `${title}`,
    '',
    `验证码：${code}`,
    '',
    `请在 5 分钟内输入验证码完成${action}。如果不是你本人操作，请忽略此邮件。`,
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#111827;line-height:1.6">
    <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
    <p>请使用下面验证码完成${escapeHtml(action)}：</p>
    <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0">${escapeHtml(code)}</div>
    <p style="color:#6b7280">验证码 5 分钟内有效。如果不是你本人操作，请忽略此邮件。</p>
  </body>
</html>`;
  return { subject: title, text, html };
}

export function makeMailer(env = process.env, logger = console) {
  const mode = String(env.UGS_MAILER ?? 'console').trim().toLowerCase();
  const from = env.UGS_MAIL_FROM || DEFAULT_FROM;

  async function sendConsole(email, code, purpose) {
    logger.log?.(`[ugs-runner] ${purpose} code for ${email}: ${code}`);
    return { ok: true, mode: 'console' };
  }

  async function sendSmtp(email, code, purpose) {
    const user = env.UGS_SES_SMTP_USER;
    const pass = env.UGS_SES_SMTP_PASS;
    if (!user || !pass) throw new Error('SMTP credentials are not configured');
    const message = codeMail({ code, purpose });
    const transport = nodemailer.createTransport({
      host: env.UGS_SES_SMTP_HOST || DEFAULT_SMTP_HOST,
      port: Number(env.UGS_SES_SMTP_PORT || DEFAULT_SMTP_PORT),
      secure: String(env.UGS_SES_SMTP_SECURE ?? 'true') !== 'false',
      auth: { user, pass },
    });
    await transport.sendMail({ from, to: email, ...message });
    return { ok: true, mode: 'smtp' };
  }

  async function sendApi(email, code, purpose) {
    const secretId = env.UGS_SES_SECRET_ID;
    const secretKey = env.UGS_SES_SECRET_KEY;
    if (!secretId || !secretKey) throw new Error('Tencent SES API credentials are not configured');
    const { ses } = await import('tencentcloud-sdk-nodejs-ses');
    const SesClient = ses.v20201002.Client;
    const message = codeMail({ code, purpose });
    const client = new SesClient({
      credential: { secretId, secretKey },
      region: env.UGS_SES_REGION || 'ap-hongkong',
      profile: { signMethod: 'TC3-HMAC-SHA256' },
    });
    await client.SendEmail({
      FromEmailAddress: from,
      Destination: [email],
      Subject: message.subject,
      Simple: {
        Html: Buffer.from(message.html).toString('base64'),
        Text: Buffer.from(message.text).toString('base64'),
      },
      TriggerType: 1,
    });
    return { ok: true, mode: 'api' };
  }

  async function send(email, code, purpose) {
    if (mode === 'smtp') return sendSmtp(email, code, purpose);
    if (mode === 'api') return sendApi(email, code, purpose);
    return sendConsole(email, code, purpose);
  }

  return {
    mode,
    sendVerificationCode(email, code) {
      return send(email, code, 'email_verify');
    },
    sendPasswordResetCode(email, code) {
      return send(email, code, 'password_reset');
    },
  };
}
