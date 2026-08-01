import { createServer } from 'node:http';
import axios from 'axios';
import { getConfig } from '../config/env.config';
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

  checks.push(await checkWebhook(config.PLATFORM_WEBHOOK_URL));
  checks.push(await checkPort('graph sink', config.GRAPH_SINK_HOST, config.GRAPH_SINK_PORT));

  const usesApiSpy = scenarios.some((scenario) => scenario.spec.apiSpy);
  if (usesApiSpy || scenarios.length === 0) {
    checks.push(await checkPort('api spy', config.API_SPY_HOST, config.API_SPY_PORT));
  }

  checks.push(checkAnthropicKey(scenarios, Boolean(config.ANTHROPIC_API_KEY)));
  checks.push(checkCloudApi(scenarios, config));

  return checks;
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

function usesLlm(scenario: LoadedScenario): boolean {
  if (scenario.spec.persona) return true;
  return (scenario.spec.steps ?? []).some((step) =>
    step.expect.some((assertion) => assertion.judge !== undefined),
  );
}

/** Lembretes do que precisa estar configurado do lado da plataforma. */
export function platformReminders(scenarios: LoadedScenario[]): string[] {
  const config = getConfig();
  const reminders = [
    `base URL da Cloud API na vonex.ai (ambiente de teste) → http://${config.GRAPH_SINK_HOST}:${config.GRAPH_SINK_PORT}`,
  ];

  if (scenarios.some((scenario) => scenario.spec.apiSpy)) {
    reminders.push(
      `base URL das APIs externas da jornada → http://${config.API_SPY_HOST}:${config.API_SPY_PORT}`,
    );
  }

  if (!config.WHATSAPP_APP_SECRET) {
    reminders.push(
      'WHATSAPP_APP_SECRET vazio: se a vonex.ai valida X-Hub-Signature-256, tudo volta 401',
    );
  }

  return reminders;
}
