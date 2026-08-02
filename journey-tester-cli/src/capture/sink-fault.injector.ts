import type { SinkFaultSpec } from '../scenario/sink-fault.schema';
import { SINK_FAULT_PRESETS } from './sink-fault.presets';

export interface FaultDecision {
  /** Rótulo curto para relatório e log: `rate-limit (429/130429)`. */
  label: string;
  status: number;
  /** Corpo no formato de erro da Cloud API. */
  body: unknown;
  delayMs?: number;
  /** Derruba a conexão em vez de responder. */
  drop: boolean;
}

/**
 * Decide, por tentativa de entrega, se o sink devolve erro em vez de 200.
 *
 * Lógica separada do servidor de propósito: é a parte que erra fácil (janela
 * de uma regra, contagem incluindo reenvio) e a que dá para testar sem abrir
 * porta nenhuma.
 */
export class SinkFaultInjector {
  private attempts = 0;

  constructor(private readonly rules: SinkFaultSpec[] = []) {}

  get hasRules(): boolean {
    return this.rules.length > 0;
  }

  /** Conta a tentativa e devolve a falha a aplicar, se alguma regra pegar. */
  next(): FaultDecision | undefined {
    const index = this.attempts;
    this.attempts += 1;

    // Primeira regra que casar vence — o cenário controla a ordem.
    const rule = this.rules.find((entry) => coversAttempt(entry, index));
    return rule ? toDecision(rule) : undefined;
  }

  reset(): void {
    this.attempts = 0;
  }
}

/** `afterCalls` deixa passar N tentativas; `times` diz por quantas a regra vale. */
export function coversAttempt(rule: SinkFaultSpec, index: number): boolean {
  if (index < rule.afterCalls) return false;
  if (rule.times === 'all') return true;
  return index < rule.afterCalls + rule.times;
}

export function toDecision(rule: SinkFaultSpec): FaultDecision {
  const preset = rule.fault ? SINK_FAULT_PRESETS[rule.fault] : undefined;

  // `drop` não chega a ter resposta HTTP; o status fica só para o relatório.
  const status = rule.status ?? preset?.status ?? (rule.drop ? 0 : 500);
  const code = rule.code ?? preset?.code;
  const message = rule.message ?? preset?.message ?? 'Sink injected failure';

  const detail = rule.drop
    ? 'conexão derrubada'
    : `${status}${code === undefined ? '' : `/${code}`}`;

  return {
    label: `${rule.fault ?? 'custom'} (${detail})`,
    status,
    body: buildErrorBody(message, code),
    ...(rule.delayMs === undefined ? {} : { delayMs: rule.delayMs }),
    drop: rule.drop,
  };
}

/** Mesmo envelope de erro da Cloud API — a plataforma não deve notar diferença. */
function buildErrorBody(message: string, code?: number): unknown {
  return {
    error: {
      message,
      type: 'OAuthException',
      ...(code === undefined ? {} : { code }),
      error_data: {
        messaging_product: 'whatsapp',
        details: message,
      },
      fbtrace_id: 'SINK-INJECTED',
    },
  };
}
