import type { LoadedScenario } from '../scenario/scenario.loader';
import type { AdapterName } from '../scenario/scenario.schema';
import { sameNumber } from '../shared/phone.util';

export interface ConcurrencyPlan {
  concurrency: number;
  /** Por que o pedido foi reduzido — vai para o log, nunca é silencioso. */
  reason?: string;
}

export interface ConcurrencyInput {
  scenarios: LoadedScenario[];
  requested: number;
  defaultAdapter: AdapterName;
  /** `--adapter` sobrescreve o do cenário. */
  override?: AdapterName;
}

/**
 * Decide quantos cenários podem rodar ao mesmo tempo.
 *
 * Paralelismo aqui não é questão de porta: é de identidade. O sink é
 * compartilhado e roteia pelo destinatário, então dois cenários simultâneos
 * precisam de contatos diferentes. Fora isso, há recurso que simplesmente não
 * se divide — um chip só, uma falha injetada que atingiria o vizinho, uma
 * chamada de API que não dá para atribuir a quem a provocou.
 *
 * Na dúvida, cai para 1 e diz por quê. Cenário embaralhado em silêncio é pior
 * do que suíte lenta.
 */
export function planConcurrency(input: ConcurrencyInput): ConcurrencyPlan {
  const { scenarios, requested, defaultAdapter, override } = input;

  if (requested <= 1) return { concurrency: 1 };

  const adapters = scenarios.map((scenario) => override ?? scenario.spec.adapter ?? defaultAdapter);

  const naoHttp = adapters.find((adapter) => adapter !== 'http');
  if (naoHttp) {
    return {
      concurrency: 1,
      reason:
        `o adapter ${naoHttp} não roda em paralelo — ` +
        (naoHttp === 'cloud-api'
          ? 'é um número de teste só, e as conversas se misturariam'
          : 'é um chip só, e as conversas se misturariam no mesmo chat'),
    };
  }

  const comSpy = scenarios.find((scenario) => scenario.spec.apiSpy);
  if (comSpy) {
    return {
      concurrency: 1,
      reason:
        `"${comSpy.spec.name}" usa apiSpy: a chamada que chega no spy não diz de qual ` +
        'cenário veio, e as asserções de API sairiam trocadas',
    };
  }

  const comFalha = scenarios.find((scenario) => scenario.spec.sinkFaults?.length);
  if (comFalha) {
    return {
      concurrency: 1,
      reason:
        `"${comFalha.spec.name}" injeta falha no sink, que é compartilhado: a falha cairia ` +
        'também na entrega do cenário vizinho',
    };
  }

  const repetido = findDuplicateContact(scenarios);
  if (repetido) {
    return {
      concurrency: 1,
      reason:
        `o número ${repetido} está em mais de um cenário: o sink roteia pelo destinatário, ` +
        'então as respostas cairiam no cenário errado',
    };
  }

  return { concurrency: Math.min(requested, scenarios.length) };
}

function findDuplicateContact(scenarios: LoadedScenario[]): string | undefined {
  const seen: string[] = [];

  for (const scenario of scenarios) {
    const phone = scenario.spec.contact.phone;
    if (seen.some((other) => sameNumber(other, phone))) return phone;
    seen.push(phone);
  }

  return undefined;
}
