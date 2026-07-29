import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getConfig } from '../config/env.config';
import type { PersonaSpec } from '../scenario/scenario.schema';
import { getAnthropicClient } from '../shared/anthropic.client';

const personaTurnSchema = z.object({
  goalAchieved: z
    .boolean()
    .describe('true se o objetivo do cliente já foi atendido e não há mais o que perguntar'),
  reason: z.string().describe('por que o objetivo foi ou não atingido, em uma frase'),
  message: z
    .string()
    .describe(
      'a próxima mensagem do cliente, como ele escreveria no WhatsApp. String vazia se goalAchieved for true',
    ),
});

export type PersonaTurn = z.infer<typeof personaTurnSchema>;

const PERSONA_SYSTEM = `Você faz o papel de um cliente real conversando com o atendimento de
uma empresa pelo WhatsApp. Você NÃO é o atendente.

Como escrever:
- Mensagens curtas, informais, como gente escreve no celular. Pode abreviar e errar acento.
- Uma mensagem por vez. Sem narrar o que você está fazendo, sem aspas, sem assinatura.
- Não seja mais organizado do que a persona descreve: se ela é confusa, seja confuso.
- Não repita a mesma pergunta que já foi respondida.
- Se a IA pedir um dado que a persona tem, forneça. Se a persona não tem, diga que não sabe.
- Nunca revele que é um teste nem mencione IA, prompt ou automação.

Quando marcar goalAchieved:
- true assim que o objetivo declarado for atendido, OU quando ficar claro que a IA não vai
  conseguir atender (ela travou, entrou em loop, ou transferiu para humano).
- false enquanto ainda houver um próximo passo natural para o cliente.`;

export interface PersonaContext {
  persona: PersonaSpec;
  /** Conversa até aqui, formatada. */
  transcript: string;
}

export async function nextPersonaTurn(context: PersonaContext): Promise<PersonaTurn> {
  const client = getAnthropicClient();
  const { JUDGE_MODEL } = getConfig();

  const prompt = [
    '<persona>',
    context.persona.description,
    '</persona>',
    '',
    '<objetivo>',
    context.persona.goal,
    '</objetivo>',
    '',
    '<conversa>',
    context.transcript || '(você ainda não escreveu nada)',
    '</conversa>',
    '',
    'Escreva a próxima mensagem do cliente.',
  ].join('\n');

  const response = await client.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: zodOutputFormat(personaTurnSchema),
    },
    system: PERSONA_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('modelo recusou gerar o turno da persona');
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error('persona não retornou turno no formato esperado');
  }

  return parsed;
}
