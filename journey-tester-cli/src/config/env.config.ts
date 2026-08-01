import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Único ponto que lê process.env. O resto do código recebe `AppConfig`.
 */
const envSchema = z.object({
  // Judge (LLM-as-judge) e persona simulada
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  JUDGE_MODEL: z.string().min(1).default('claude-opus-5'),

  // Adapter http (webhook da plataforma + graph sink)
  PLATFORM_WEBHOOK_URL: z.string().url().optional(),
  GRAPH_SINK_PORT: z.coerce.number().int().positive().default(4020),
  GRAPH_SINK_HOST: z.string().default('127.0.0.1'),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default('100000000000000'),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default('200000000000000'),
  WHATSAPP_DISPLAY_PHONE_NUMBER: z.string().default('5511900000000'),

  // Spy das APIs externas que a jornada consome (CRM, agenda, ERP)
  API_SPY_HOST: z.string().default('127.0.0.1'),
  API_SPY_PORT: z.coerce.number().int().positive().default(4030),

  // Adapters não-oficiais (z-api | evolution | uazapi) — chip de teste
  WA_PROVIDER_BASE_URL: z.string().url().default('https://api.z-api.io'),
  WA_PROVIDER_INSTANCE: z.string().optional(),
  WA_PROVIDER_TOKEN: z.string().optional(),
  /** Z-API: Client-Token da conta. Ignorado nos outros provedores. */
  WA_PROVIDER_CLIENT_TOKEN: z.string().optional(),
  /** `poll` dispensa túnel público; `webhook` é mais rápido mas exige exposição. */
  WA_PROVIDER_CAPTURE: z.enum(['poll', 'webhook']).default('poll'),
  WA_PROVIDER_POLL_MS: z.coerce.number().int().positive().default(1_500),
  WA_PROVIDER_POLL_AMOUNT: z.coerce.number().int().positive().max(100).default(20),
  // Escapes: se o contrato do provedor divergir do perfil embutido, corrige-se
  // aqui sem tocar em código.
  WA_PROVIDER_SEND_PATH: z.string().optional(),
  WA_PROVIDER_FETCH_PATH: z.string().optional(),
  WA_PROVIDER_AUTH_HEADER: z.string().optional(),

  // Adapter cloud-api (canal real, número oficial da Meta)
  CLOUD_API_BASE_URL: z.string().url().default('https://graph.facebook.com/v21.0'),
  CLOUD_API_TOKEN: z.string().optional(),
  TESTER_PHONE_NUMBER_ID: z.string().optional(),
  BOT_PHONE_NUMBER: z.string().optional(),
  INBOUND_WEBHOOK_PORT: z.coerce.number().int().positive().default(4021),
  INBOUND_WEBHOOK_HOST: z.string().default('0.0.0.0'),
  INBOUND_VERIFY_TOKEN: z.string().default('journey-tester'),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Só para teste — permite reconstruir a config depois de mexer no ambiente. */
export function resetConfigCache(): void {
  cached = undefined;
}

export function requireConfig<K extends keyof AppConfig>(
  key: K,
  reason: string,
): NonNullable<AppConfig[K]> {
  const value = getConfig()[key];
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente ${String(key)} é obrigatória: ${reason}`);
  }
  return value as NonNullable<AppConfig[K]>;
}
