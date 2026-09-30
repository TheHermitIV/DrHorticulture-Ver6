import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_BUCKET: z.string().min(1).default('scan-images'),
    INFERENCE_MODE: z.enum(['mock', 'remote']).default('mock'),
    INFERENCE_URL: z.url().optional(),
    INFERENCE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
    ADMIN_API_KEY: z.string().min(16),
    AUTH_REQUIRED: booleanString,
  })
  .refine((env) => env.INFERENCE_MODE !== 'remote' || Boolean(env.INFERENCE_URL), {
    message: 'is required when INFERENCE_MODE=remote',
    path: ['INFERENCE_URL'],
  });

// Messages name the variable and the rule only, never the value, so secrets can't leak into logs.
export function loadEnv(source) {
  const values = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(values);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return Object.freeze(result.data);
}
