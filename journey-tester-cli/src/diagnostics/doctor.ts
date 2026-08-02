import { createServer } from 'node:http';
import axios from 'axios';
import { getConfig } from '../config/env.config';
import {
  getProviderProfile,
  isConnectedState,
  UNOFFICIAL_PROVIDERS,
  type UnofficialProvider,
} from '../adapters/unofficial/provider.profile';
import type { LoadedScenario } from '../scenario/scenario.loader';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** O que fazer quando não está ok. */
  hint?: string;
}

/**
 * Pré-voo antes da primeira rodada real. A maioria das falhas de estreia é
 * configuração (webhook errado, porta ocupada, base URL da plataforma não
 * apontada para o sink) e se manifesta como "a IA não respondeu" — que não
 * diz nada sobre a causa.
 */
export async function runDoctor(scenarios: LoadedScenario[]): Promise<CheckResult[]> {
  const config = getConfig();
  const checks: CheckResult[] = [];

  const adapters = new Set(
    scenarios.map((scenario) => scenario.spec.adapter ?? config.DEFAULT_ADAPTER),
  );
  if (scenarios.length === 0) adapters.add(config.DEFAULT_ADAPTER);
  const usesHttp = adapters.has('http');

  if (usesHttp) {
    checks.push(await checkWebhook(config.PLATFORM_WEBHOOK_URL));
    checks.push(await checkPort('graph sink', config.GRAPH_SINK_HOST, config.GRAPH_SINK_PORT));
  }

  const unofficial = [...adapters].filter((name) =>
    (UNOFFICIAL_PROVIDERS as readonly string[]).includes(name),
  );
  for (const provider of unofficial) {
    const configCheck = checkUnofficial(config, provider);
    checks.push(configCheck);
    if (configCheck.status !== 'fail') {
      checks.push(await checkProviderConnection(provider as UnofficialProvider, config));
    }
  }

  const usesApiSpy = scenarios.some((scenario) => scenario.spec.apiSpy);
  if (usesApiSpy || scenarios.length === 0) {
    checks.push(await checkPort('api spy', config.API_SPY_HOST, config.API_SPY_PORT));
  }

  checks.push(checkAnthropicKey(scenarios, Boolean(config.ANTHROPIC_API_KEY)));
  checks.push(checkCloudApi(scenarios, config));

  const faultCheck = checkSinkFaults(scenarios, config);
  if (faultCheck) checks.push(faultCheck);

  return checks;
}

/**
 * `sinkFaults` só acontece no adapter http. Como o default do projeto é
 * `evolution`, um cenário que omite `adapter` herda um transporte sem sink e
 * passaria verde sem ter injetado falha nenhuma — o pior tipo de teste.
 */
export function checkSinkFaults(
  scenarios: LoadedScenario[],
  config: Pick<ReturnType<typeof getConfig>, 'DEFAULT_ADAPTER'>,
): CheckResult | undefined {
  const withFaults = scenarios.filter((scenario) => scenario.spec.sinkFaults?.length);
  if (withFaults.length === 0) return undefined;

  const name = 'injeção de falha no sink';
  const semSink = withFaults.filter(
    (scenario) => (scenario.spec.adapter ?? config.DEFAULT_ADAPTER) !== 'http',
  );

  if (semSink.length > 0) {
    return {
      name,
      status: 'fail',
      detail: `${semSink.length} cenário(s) declaram sinkFaults mas rodariam no adapter ${config.DEFAULT_ADAPTER}`,
      hint: 'declare `adapter: http` no cenário ou rode com `--adapter http` — sem sink não há falha a injetar',
    };
  }

  return {
    name,
    status: 'ok',
    detail: `${withFaults.length} cenário(s) vão exercitar o retry da plataforma`,
  };
}

async function checkWebhook(url?: string): Promise<CheckResult> {
  if (!url) {
    return {
      name: 'PLATFORM_WEBHOOK_URL',
      status: 'fail',
      detail: 'não definida',
      hint: 'aponte para o endpoint de webhook do WhatsApp no ambiente de teste da vonex.ai',
    };
  }

  try {
    // GET é inofensivo: só queremos saber se alguém atende naquele endereço.
    const response = await axios.get(url, { timeout: 5_000, validateStatus: () => true });
    return {
      name: 'PLATFORM_WEBHOOK_URL',
      status: 'ok',
      detail: `${url} respondeu ${response.status}`,
    };
  } catch (error) {
    return {
      name: 'PLATFORM_WEBHOOK_URL',
      status: 'fail',
      detail: `${url} inacessível: ${(error as Error).message}`,
      hint: 'confira se a vonex.ai de teste está no ar e se a URL inclui o caminho do webhook',
    };
  }
}

async function checkPort(label: string, host: string, port: number): Promise<CheckResult> {
  const free = await isPortFree(host, port);
  return free
    ? { name: `porta do ${label}`, status: 'ok', detail: `${host}:${port} livre` }
    : {
        name: `porta do ${label}`,
        status: 'fail',
        detail: `${host}:${port} ocupada`,
        hint: 'feche a execução anterior ou troque a porta no .env',
      };
}

function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

function checkAnthropicKey(scenarios: LoadedScenario[], hasKey: boolean): CheckResult {
  const needing = scenarios.filter((scenario) => usesLlm(scenario));

  if (needing.length === 0) {
    return {
      name: 'ANTHROPIC_API_KEY',
      status: hasKey ? 'ok' : 'ok',
      detail: 'nenhum cenário usa judge ou persona',
    };
  }

  if (hasKey) {
    return {
      name: 'ANTHROPIC_API_KEY',
      status: 'ok',
      detail: `definida — ${needing.length} cenário(s) usam judge ou persona`,
    };
  }

  return {
    name: 'ANTHROPIC_API_KEY',
    status: 'fail',
    detail: `${needing.length} cenário(s) usam judge ou persona, mas a chave não está definida`,
    hint: 'defina ANTHROPIC_API_KEY no .env, ou rode só cenários determinísticos',
  };
}

function checkCloudApi(
  scenarios: LoadedScenario[],
  config: ReturnType<typeof getConfig>,
): CheckResult {
  const usingCloudApi = scenarios.filter((scenario) => scenario.spec.adapter === 'cloud-api');

  if (usingCloudApi.length === 0) {
    return { name: 'adapter cloud-api', status: 'ok', detail: 'nenhum cenário usa o canal real' };
  }

  const missing = (
    [
      ['CLOUD_API_TOKEN', config.CLOUD_API_TOKEN],
      ['TESTER_PHONE_NUMBER_ID', config.TESTER_PHONE_NUMBER_ID],
      ['BOT_PHONE_NUMBER', config.BOT_PHONE_NUMBER],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    return {
      name: 'adapter cloud-api',
      status: 'fail',
      detail: `faltando: ${missing.join(', ')}`,
      hint: 'o canal real exige número de teste, token e o número do bot',
    };
  }

  return {
    name: 'adapter cloud-api',
    status: 'warn',
    detail: `${usingCloudApi.length} cenário(s) vão gastar conversa cobrada pela Meta`,
    hint: 'o webhook de entrada precisa estar exposto publicamente (túnel) e registrado no app',
  };
}

/**
 * Sessão de API não-oficial cai sozinha (troca de celular, logout no app,
 * container reiniciado). Sem esta checagem o sintoma é um timeout genérico.
 */
async function checkProviderConnection(
  provider: UnofficialProvider,
  config: ReturnType<typeof getConfig>,
): Promise<CheckResult> {
  const profile = getProviderProfile(provider);
  const name = `sessão do ${profile.label}`;

  if (!profile.health) {
    return { name, status: 'warn', detail: 'provedor sem endpoint de status conhecido' };
  }

  try {
    const call = profile.health(config);
    const response = await axios.request({
      method: call.method,
      url: `${profile.baseUrl(config)}${call.path}`,
      headers: profile.authHeaders(config),
      params: call.query,
      data: call.body,
      timeout: 8_000,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      return {
        name,
        status: 'fail',
        detail: `${profile.label} respondeu ${response.status}`,
        hint: 'confira instância, token e se o serviço está no ar',
      };
    }

    const connected = isConnectedState(response.data);
    if (connected === false) {
      return {
        name,
        status: 'fail',
        detail: 'chip desconectado',
        hint: 'releia o QR no painel do provedor — a sessão caiu',
      };
    }

    return connected === true
      ? { name, status: 'ok', detail: 'chip conectado' }
      : {
          name,
          status: 'warn',
          detail: `estado não reconhecido: ${JSON.stringify(response.data).slice(0, 120)}`,
        };
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: `inacessível: ${(error as Error).message}`,
      hint: `o serviço está rodando em ${config.WA_PROVIDER_BASE_URL}?`,
    };
  }
}

function checkUnofficial(
  config: ReturnType<typeof getConfig>,
  providers: string,
): CheckResult {
  const name = `adapter ${providers}`;
  const missing = (
    [
      ['WA_PROVIDER_TOKEN', config.WA_PROVIDER_TOKEN],
      ['WA_PROVIDER_INSTANCE', config.WA_PROVIDER_INSTANCE],
      ['BOT_PHONE_NUMBER', config.BOT_PHONE_NUMBER],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    return {
      name,
      status: 'fail',
      detail: `faltando: ${missing.join(', ')}`,
      hint: 'instância e token vêm do painel do provedor; BOT_PHONE_NUMBER é o número da jornada',
    };
  }

  if (config.WA_PROVIDER_CAPTURE === 'webhook') {
    return {
      name,
      status: 'warn',
      detail: 'captura por webhook',
      hint: `exponha ${config.INBOUND_WEBHOOK_HOST}:${config.INBOUND_WEBHOOK_PORT} publicamente e cadastre no provedor`,
    };
  }

  return {
    name,
    status: 'ok',
    detail: `captura por polling a cada ${config.WA_PROVIDER_POLL_MS}ms (sem túnel) em ${config.WA_PROVIDER_BASE_URL}`,
  };
}

function usesLlm(scenario: LoadedScenario): boolean {
  if (scenario.spec.persona) return true;
  return (scenario.spec.steps ?? []).some((step) =>
    step.expect.some((assertion) => assertion.judge !== undefined),
  );
}

/** Lembretes do que precisa estar configurado do lado da plataforma. */
export function platformReminders(scenarios: LoadedScenario[]): string[] {
  const config = getConfig();
  const adapters = new Set(
    scenarios.map((scenario) => scenario.spec.adapter ?? config.DEFAULT_ADAPTER),
  );
  if (scenarios.length === 0) adapters.add(config.DEFAULT_ADAPTER);
  const reminders: string[] = [];

  // Os adapters não-oficiais não exigem nada da plataforma — é o ponto deles.
  if (adapters.has('http')) {
    reminders.push(
      `base URL da Cloud API na vonex.ai (ambiente de teste) → http://${config.GRAPH_SINK_HOST}:${config.GRAPH_SINK_PORT}`,
    );
  }

  if ([...adapters].some((name) => (UNOFFICIAL_PROVIDERS as readonly string[]).includes(name))) {
    reminders.push(
      'chip de teste conectado no provedor (QR lido) e nunca o número de trabalho',
    );
  }

  if (scenarios.some((scenario) => scenario.spec.apiSpy)) {
    reminders.push(
      `base URL das APIs externas da jornada → http://${config.API_SPY_HOST}:${config.API_SPY_PORT}`,
    );
  }

  // Só o adapter http assina o webhook; nos outros a assinatura não existe.
  if ((adapters.has('http') || scenarios.length === 0) && !config.WHATSAPP_APP_SECRET) {
    reminders.push(
      'WHATSAPP_APP_SECRET vazio: se a vonex.ai valida X-Hub-Signature-256, tudo volta 401',
    );
  }

  return reminders;
}
