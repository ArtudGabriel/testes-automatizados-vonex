/**
 * Falhas que a Cloud API devolve de verdade, com o código que a Meta usa.
 *
 * O preset existe para o cenário não precisar decorar número de erro: o que
 * importa é o comportamento que se quer provocar na plataforma ("estourou o
 * rate limit", "token venceu"), não o `131047`.
 */
export const SINK_FAULT_IDS = [
  'rate-limit',
  'spam-rate-limit',
  'server-error',
  'unavailable',
  'outside-window',
  'expired-token',
  'undeliverable',
] as const;

export type SinkFaultId = (typeof SINK_FAULT_IDS)[number];

export interface SinkFaultPreset {
  status: number;
  /** Código de erro da Cloud API. */
  code: number;
  /** Como a Meta chama o erro — vai para `error.message`. */
  message: string;
  /** Uma linha sobre o que a plataforma deveria fazer diante dele. */
  expectation: string;
}

export const SINK_FAULT_PRESETS: Record<SinkFaultId, SinkFaultPreset> = {
  'rate-limit': {
    status: 429,
    code: 130429,
    message: 'Rate limit hit',
    expectation: 'reenviar com backoff',
  },
  'spam-rate-limit': {
    status: 429,
    code: 131048,
    message: 'Spam rate limit hit',
    expectation: 'reenviar com backoff longo, ou desistir sem perder a conversa',
  },
  'server-error': {
    status: 500,
    code: 131000,
    message: 'Something went wrong',
    expectation: 'reenviar — o erro é transitório do lado da Meta',
  },
  unavailable: {
    status: 503,
    code: 131016,
    message: 'Service unavailable',
    expectation: 'reenviar com backoff',
  },
  'outside-window': {
    status: 400,
    code: 131047,
    message:
      'Message failed to send because more than 24 hours have passed since the customer last replied to this number',
    expectation: 'abrir a janela com template aprovado — reenviar o mesmo texto não resolve',
  },
  'expired-token': {
    status: 401,
    code: 190,
    message: 'Access token has expired',
    expectation: 'renovar a credencial e avisar — reenviar em loop só queima log',
  },
  undeliverable: {
    status: 400,
    code: 131026,
    message: 'Message undeliverable',
    expectation: 'não reenviar: o número não recebe. Encerrar ou escalar.',
  },
};

export function faultPresetIds(): SinkFaultId[] {
  return [...SINK_FAULT_IDS];
}
