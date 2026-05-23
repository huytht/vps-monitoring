const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-change-me-in-production-please';

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Missing required environment variable: JWT_SECRET. Set it before starting the server.'
    );
  }
  return DEV_FALLBACK_SECRET;
}

export const env = {
  get MONGODB_URI(): string {
    return process.env.MONGODB_URI ?? 'mongodb://localhost:27017/vps-monitoring';
  },
  get TARGET_MONGODB_URI(): string | undefined {
    const raw = process.env.TARGET_MONGODB_URI?.trim();
    return raw && raw.length > 0 ? raw : undefined;
  },
  get JWT_SECRET(): string {
    return resolveJwtSecret();
  },
  get APP_URL(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  },
  get AGENT_OFFLINE_AFTER_SECONDS(): number {
    return Number(process.env.AGENT_OFFLINE_AFTER_SECONDS ?? 60);
  },
};
