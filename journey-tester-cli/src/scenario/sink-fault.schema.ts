import { z } from 'zod';
import { SINK_FAULT_IDS } from '../capture/sink-fault.presets';

/**
 * Regra de injeção de falha no graph sink.
 *
 * Em produção a Meta falha: rate limit, 500, janela de 24h fechada. A jornada
 * na vonex.ai trata (ou não) esses erros, e hoje isso nunca é exercitado —
 * o sink sempre responde 200. Aqui o cenário provoca a falha de propósito e
 * assevera o que a plataforma faz depois.
 */
export const sinkFaultSchema = z
  .strictObject({
    /** Preset com status e código reais da Cloud API. */
    fault: z.enum(SINK_FAULT_IDS).optional(),
    /** Sobrescreve o status do preset, ou define a falha sem preset. */
    status: z.number().int().min(100).max(599).optional(),
    /** Sobrescreve o código de erro da Meta. */
    code: z.number().int().optional(),
    /** Sobrescreve a mensagem de erro. */
    message: z.string().min(1).optional(),
    /**
     * Quantas chamadas passam antes de a regra valer. Conta tentativas de
     * entrega, reenvio incluído — não mensagens distintas.
     */
    afterCalls: z.number().int().nonnegative().default(0),
    /** Quantas chamadas seguidas falham. `all` falha até o fim do cenário. */
    times: z.union([z.number().int().positive(), z.literal('all')]).default(1),
    /** Segura a resposta antes de devolver o erro (testa timeout da plataforma). */
    delayMs: z.number().int().nonnegative().optional(),
    /** Derruba a conexão em vez de responder — a plataforma vê socket hang up. */
    drop: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.fault === undefined && value.status === undefined && !value.drop) {
      ctx.addIssue({
        code: 'custom',
        message: `regra de sinkFaults precisa de \`fault\` (${SINK_FAULT_IDS.join(' | ')}), \`status\` ou \`drop: true\``,
      });
    }
  });

export type SinkFaultSpec = z.infer<typeof sinkFaultSchema>;

/** Asserção sobre reenvio: a plataforma insistiu depois da falha? Quantas vezes? */
export const sinkRetriesSchema = z
  .strictObject({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  })
  .refine((value) => value.min !== undefined || value.max !== undefined, {
    message: 'sinkRetries precisa de pelo menos min ou max',
  });

export type SinkRetriesSpec = z.infer<typeof sinkRetriesSchema>;
