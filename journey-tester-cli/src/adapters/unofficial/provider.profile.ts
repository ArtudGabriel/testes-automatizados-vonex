import type { AppConfig } from '../../config/env.config';

export const UNOFFICIAL_PROVIDERS = ['z-api', 'evolution', 'uazapi'] as const;
export type UnofficialProvider = (typeof UNOFFICIAL_PROVIDERS)[number];

export interface HttpCall {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  query?: Record<string, string | number>;
}

/**
 * Contrato HTTP de um provedor não-oficial. Os três fazem a mesma coisa com
 * shapes diferentes, então o adapter é um só e o que muda é o perfil.
 *
 * Os caminhos e o header de auth podem ser sobrescritos por env
 * (`WA_PROVIDER_SEND_PATH`, `WA_PROVIDER_FETCH_PATH`, `WA_PROVIDER_AUTH_HEADER`)
 * — se o contrato do seu provedor divergir do embutido aqui, é configuração,
 * não código.
 */
export interface ProviderProfile {
  id: UnofficialProvider;
  label: string;
  /** Prefixo comum às chamadas, montado a partir de instância/token. */
  baseUrl(config: AppConfig): string;
  authHeaders(config: AppConfig): Record<string, string>;
  send(config: AppConfig, phone: string, text: string): HttpCall;
  /** undefined quando o provedor não expõe leitura de histórico (só webhook). */
  fetchMessages?(config: AppConfig, phone: string): HttpCall;
  /**
   * Consulta de estado da instância. Sessão de API não-oficial cai sozinha e o
   * sintoma é "a IA não respondeu" — checar antes economiza a caçada.
   */
  health?(config: AppConfig): HttpCall;
}

/**
 * Lê "está conectado?" da resposta de health de qualquer provedor. Cada um
 * responde de um jeito, então procuramos os sinais conhecidos em vez de fixar
 * um shape.
 */
export function isConnectedState(payload: unknown): boolean | undefined {
  const record = asRecord(payload);

  for (const candidate of [record, asRecord(record.instance), asRecord(record.data)]) {
    const state = candidate.state ?? candidate.status ?? candidate.connectionStatus;
    if (typeof state === 'string') {
      const normalized = state.toLowerCase();
      if (['open', 'connected', 'online', 'authenticated'].includes(normalized)) return true;
      if (['close', 'closed', 'connecting', 'disconnected', 'offline'].includes(normalized)) {
        return false;
      }
    }
    if (typeof candidate.connected === 'boolean') return candidate.connected;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireInstance(config: AppConfig): string {
  const value = config.WA_PROVIDER_INSTANCE;
  if (!value) throw new Error('WA_PROVIDER_INSTANCE é obrigatória');
  return value;
}

function requireToken(config: AppConfig): string {
  const value = config.WA_PROVIDER_TOKEN;
  if (!value) throw new Error('WA_PROVIDER_TOKEN é obrigatório');
  return value;
}

const zApi: ProviderProfile = {
  id: 'z-api',
  label: 'Z-API',
  // Z-API põe instância e token no caminho, não em header.
  baseUrl: (config) =>
    `${config.WA_PROVIDER_BASE_URL}/instances/${requireInstance(config)}/token/${requireToken(config)}`,
  authHeaders: (config) =>
    config.WA_PROVIDER_CLIENT_TOKEN
      ? { [config.WA_PROVIDER_AUTH_HEADER ?? 'client-token']: config.WA_PROVIDER_CLIENT_TOKEN }
      : {},
  send: (config, phone, text) => ({
    method: 'POST',
    path: config.WA_PROVIDER_SEND_PATH ?? '/send-text',
    body: { phone, message: text },
  }),
  fetchMessages: (config, phone) => ({
    method: 'GET',
    path: `${config.WA_PROVIDER_FETCH_PATH ?? '/chat-messages'}/${phone}`,
    query: { amount: config.WA_PROVIDER_POLL_AMOUNT },
  }),
  health: () => ({ method: 'GET', path: '/status' }),
};

const evolution: ProviderProfile = {
  id: 'evolution',
  label: 'Evolution API',
  // Evolution põe a instância no caminho de cada rota e a chave em header.
  baseUrl: (config) => config.WA_PROVIDER_BASE_URL,
  authHeaders: (config) => ({
    [config.WA_PROVIDER_AUTH_HEADER ?? 'apikey']: requireToken(config),
  }),
  send: (config, phone, text) => ({
    method: 'POST',
    path: `${config.WA_PROVIDER_SEND_PATH ?? '/message/sendText'}/${requireInstance(config)}`,
    body: { number: phone, text },
  }),
  fetchMessages: (config, phone) => ({
    method: 'POST',
    path: `${config.WA_PROVIDER_FETCH_PATH ?? '/chat/findMessages'}/${requireInstance(config)}`,
    body: {
      where: { key: { remoteJid: `${phone}@s.whatsapp.net` } },
      limit: config.WA_PROVIDER_POLL_AMOUNT,
    },
  }),
  health: (config) => ({
    method: 'GET',
    path: `/instance/connectionState/${requireInstance(config)}`,
  }),
};

const uazapi: ProviderProfile = {
  id: 'uazapi',
  label: 'Uazapi',
  baseUrl: (config) => config.WA_PROVIDER_BASE_URL,
  authHeaders: (config) => ({
    [config.WA_PROVIDER_AUTH_HEADER ?? 'token']: requireToken(config),
  }),
  send: (config, phone, text) => ({
    method: 'POST',
    path: config.WA_PROVIDER_SEND_PATH ?? '/send/text',
    body: { number: phone, text },
  }),
  fetchMessages: (config, phone) => ({
    method: 'POST',
    path: config.WA_PROVIDER_FETCH_PATH ?? '/message/find',
    body: { chatid: phone, limit: config.WA_PROVIDER_POLL_AMOUNT },
  }),
  health: () => ({ method: 'GET', path: '/instance/status' }),
};

const PROFILES: Record<UnofficialProvider, ProviderProfile> = {
  'z-api': zApi,
  evolution,
  uazapi,
};

export function getProviderProfile(provider: UnofficialProvider): ProviderProfile {
  return PROFILES[provider];
}
