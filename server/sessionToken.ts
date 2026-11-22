import crypto from 'crypto';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_PREFIX = 'apst';

export interface SignedSessionPayload {
  sid: string;
  uid: string;
  nick: string;
  role: string;
  iat: number;
  exp: number;
}

let warnedMissingSecret = false;

/**
 * Derives a stable HMAC signing secret from environment variables so signed session
 * tokens remain valid across all Vercel serverless cold starts and concurrent instances.
 * Never generates a per-process random secret.
 */
export function resolveSessionSecret(
  env: Record<string, string | undefined> = process.env
): string {
  const explicit =
    env.SESSION_SECRET?.trim() ||
    env.AUTH_SECRET?.trim() ||
    env.JWT_SECRET?.trim();
  if (explicit && explicit.length >= 16) {
    return explicit;
  }

  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRole && serviceRole.length >= 16) {
    return crypto
      .createHmac('sha256', serviceRole)
      .update('apostles-of-deathmarried:session-signing-key:v1')
      .digest('hex');
  }

  if (!warnedMissingSecret && env.VERCEL) {
    warnedMissingSecret = true;
    console.warn(
      '[Auth] SESSION_SECRET is not explicitly configured; deriving deterministic fallback from deployment metadata. Set SESSION_SECRET in Vercel Environment Variables for dedicated key isolation.'
    );
  }

  const stableSeed = [
    'apostles-of-deathmarried:stable-session-v1',
    env.VERCEL_PROJECT_ID || '',
    env.SUPABASE_URL || '',
    env.APP_URL || 'https://apostlesofdeathmarried.ru',
  ].join('|');

  return crypto.createHash('sha256').update(stableSeed).digest('hex');
}

export function isSignedSessionToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith(`${TOKEN_PREFIX}.`);
}

export function signSessionToken(
  input: {
    sid: string;
    uid: string;
    nick: string;
    role: string;
    ttlMs?: number;
  },
  secret: string = resolveSessionSecret(),
  nowMs: number = Date.now()
): { token: string; expiresAt: string; exp: number } {
  const ttl = input.ttlMs ?? SESSION_TTL_MS;
  const iat = Math.floor(nowMs / 1000);
  const exp = Math.floor((nowMs + ttl) / 1000);

  const payload: SignedSessionPayload = {
    sid: input.sid,
    uid: input.uid,
    nick: input.nick,
    role: input.role,
    iat,
    exp,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `${TOKEN_PREFIX}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    exp,
  };
}

export function verifySessionToken(
  token: string | null | undefined,
  secret: string = resolveSessionSecret(),
  nowSec: number = Math.floor(Date.now() / 1000)
): SignedSessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;

  const [prefix, encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${prefix}.${encodedPayload}`)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Partial<SignedSessionPayload>;

    if (
      typeof parsed.sid !== 'string' ||
      !parsed.sid ||
      typeof parsed.uid !== 'string' ||
      !parsed.uid ||
      typeof parsed.nick !== 'string' ||
      !parsed.nick ||
      typeof parsed.role !== 'string' ||
      typeof parsed.exp !== 'number' ||
      !Number.isFinite(parsed.exp)
    ) {
      return null;
    }

    if (parsed.exp <= nowSec) {
      return null;
    }

    return {
      sid: parsed.sid,
      uid: parsed.uid,
      nick: parsed.nick,
      role: parsed.role,
      iat: typeof parsed.iat === 'number' ? parsed.iat : 0,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}
