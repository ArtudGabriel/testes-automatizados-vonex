import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getConfig } from '../config/env.config';
import type { AssertionResult } from '../runner/run-result.types';
import { getAnthropicClient } from '../shared/anthropic.client';
import { logger } from '../shared/logger';

const verdictSchema = z.object({
  passed: z.boolean().describe('true se a resposta atende ao critério'),
  reason: z
    .string()
    .describe('justificativa curta em português, citando o trecho que decidiu o veredito'),
});

const JUDGE_SYSTEM = `Você avalia respostas de um agente de IA que atende clientes por WhatsApp.

Recebe a transcrição da conversa, o turno que deve ser avaliado e um critério.
Responde se o turno cumpre o critério.

Regras de avaliação:
- Avalie SOMENTE o critério informado. Outros defeitos da resposta não importam aqui.
- Julgue o conteúdo, não a forma: sinônimos, ordem diferente e variação de tom são aceitáveis.
- Se o critério exige uma informação específica (data, valor, nome, protocolo), ela precisa
  aparecer de fato — não vale "a IA deu a entender".
- Um turno pode ter várias mensagens; considere todas juntas.
- Não invente contexto que não está na transcrição.
- Na dúvida entre passar e reprovar, reprove e explique o que faltou.`;

export interface JudgeInput {
  criteria: string;
  mustNot?: string;
  /** Transcrição até o turno anterior, já formatada. */
  transcript: string;
  /** Texto do turno avaliado. */
  turnText: string;
  userMessage: string;
}

export async function evaluateJudge(input: JudgeInput): Promise<AssertionResult> {
  const expected = input.mustNot
    ? `${input.criteria} (e não pode: ${input.mustNot})`
    : input.criteria;

  try {
    const verdict = await requestVerdict(input);
    return {
      kind: 'judge',
      passed: verdict.passed,
      expected,
      actual: verdict.reason,
    };
  } catch (error) {
    // Falha do judge não é falha da jornada, mas também não pode passar batido.
    logger.error('judge falhou', { error: (error as Error).message });
    return {
      kind: 'judge',
      passed: false,
      expected,
      actual: `erro ao consultar o judge: ${(error as Error).message}`,
    };
  }
}

async function requestVerdict(input: JudgeInput): Promise<z.infer<typeof verdictSchema>> {
  const client = getAnthropicClient();
  const { JUDGE_MODEL } = getConfig();

  const prompt = [
    '<transcricao>',
    input.transcript || '(início da conversa)',
    '</transcricao>',
    '',
    '<turno_avaliado>',
    `Cliente: ${input.userMessage}`,
    `IA: ${input.turnText || '(a IA não respondeu)'}`,
    '</turno_avaliado>',
    '',
    '<criterio>',
    input.criteria,
    '</criterio>',
    ...(input.mustNot
      ? ['', '<nao_pode>', input.mustNot, '</nao_pode>']
      : []),
  ].join('\n');

  const response = await client.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: zodOutputFormat(verdictSchema),
    },
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('judge recusou avaliar o conteúdo');
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error('judge não retornou veredito no formato esperado');
  }

  return parsed;
}
