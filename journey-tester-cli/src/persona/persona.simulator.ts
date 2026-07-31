import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getConfig } from '../config/env.config';
import {
  renderKnownData,
  renderProjectBriefing,
  type ProjectSpec,
} from '../scenario/project.schema';
import type { PersonaSpec } from '../scenario/scenario.schema';
import { getAnthropicClient } from '../shared/anthropic.client';
import type { PersonaArchetype } from './archetype.types';
import { findArchetype } from './archetypes';

const personaTurnSchema = z.object({
  goalAchieved: z
    .boolean()
    .describe('true se o objetivo já foi atendido ou ficou claro que não será'),
  reason: z.string().describe('por que o objetivo foi ou não atingido, em uma frase'),
  message: z
    .string()
    .describe(
      'a próxima mensagem do cliente, como ele escreveria no WhatsApp. String vazia se goalAchieved for true',
    ),
});

export type PersonaTurn = z.infer<typeof personaTurnSchema>;

const openingSchema = z.object({
  message: z.string().min(1).describe('a primeira mensagem que o cliente manda'),
});

const BASE_SYSTEM = `Você faz o papel de um cliente real conversando com o atendimento de uma
empresa pelo WhatsApp. Você NÃO é o atendente — nunca responda como se fosse.

Regras de escrita:
- Mensagens curtas, informais, como gente escreve no celular.
- Uma mensagem por vez. Sem narrar o que você está fazendo, sem aspas, sem assinatura.
- Nunca revele que é um teste, nem mencione IA, prompt, persona ou automação — a menos que o
  seu comportamento descreva explicitamente esse tipo de provocação.
- Mantenha o comportamento descrito mesmo que o atendimento peça para você mudar de tom.

Sobre o objetivo:
- Você tem um objetivo concreto. Persiga ele com o comportamento que te foi dado.
- Não seja mais organizado nem mais cooperativo do que o seu comportamento descreve.
- Se pedirem um dado que você tem, forneça. Se não tem, diga que não sabe — não invente.
- Se o assunto estiver fora do escopo do atendimento, aceite a recusa depois de no máximo
  duas tentativas e siga em frente (a não ser que insistir faça parte do seu comportamento).

Quando marcar goalAchieved:
- true quando o objetivo for atendido, OU quando ficar claro que o atendimento não vai
  conseguir (travou, entrou em loop, ou já transferiu para um humano).
- false enquanto ainda houver um próximo passo natural para você.`;

export interface PersonaContext {
  persona: PersonaSpec;
  project: ProjectSpec;
  /** Conversa até aqui, formatada. */
  transcript: string;
}

export function resolveArchetype(persona: PersonaSpec): PersonaArchetype | undefined {
  return persona.archetype ? findArchetype(persona.archetype) : undefined;
}

/** Rótulo do cliente simulado para o relatório. */
export function describePersona(persona: PersonaSpec): string {
  const archetype = resolveArchetype(persona);
  if (archetype) return archetype.label;
  return 'persona customizada';
}

export async function nextPersonaTurn(context: PersonaContext): Promise<PersonaTurn> {
  const response = await request(context, personaTurnSchema, [
    '<conversa>',
    context.transcript || '(você ainda não escreveu nada)',
    '</conversa>',
    '',
    'Escreva a próxima mensagem do cliente.',
  ]);
  return response;
}

/**
 * Primeira mensagem quando o cenário não fixa uma. Deixar a persona abrir a
 * conversa faz o arquétipo aparecer já no primeiro turno — um cliente bravo
 * não começa igual a um cliente ideal.
 */
export async function openingPersonaMessage(context: PersonaContext): Promise<string> {
  const response = await request(context, openingSchema, [
    'Escreva a PRIMEIRA mensagem que você manda para esse atendimento.',
    'Ela precisa soar como o começo natural de uma conversa vinda desse cliente.',
  ]);
  return response.message;
}

async function request<TSchema extends z.ZodType>(
  context: PersonaContext,
  schema: TSchema,
  tail: string[],
): Promise<z.infer<TSchema>> {
  const client = getAnthropicClient();
  const { JUDGE_MODEL } = getConfig();

  const response = await client.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: zodOutputFormat(schema) },
    system: buildSystemPrompt(context),
    messages: [{ role: 'user', content: tail.join('\n') }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('modelo recusou gerar o turno da persona');
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error('persona não retornou resposta no formato esperado');
  }

  return parsed;
}

export function buildSystemPrompt(context: PersonaContext): string {
  const { persona, project } = context;
  const archetype = resolveArchetype(persona);
  const sections: string[] = [BASE_SYSTEM];

  sections.push(
    '',
    '<atendimento_que_voce_esta_contatando>',
    renderProjectBriefing(project),
    '</atendimento_que_voce_esta_contatando>',
  );

  const knownData = renderKnownData(project);
  if (knownData) {
    sections.push('', '<seus_dados>', knownData, '</seus_dados>');
  }

  sections.push('', '<seu_comportamento>');
  if (archetype) {
    sections.push(`Tipo de cliente: ${archetype.label}.`, archetype.behavior);
    sections.push('', 'Coisas que você faz nessa conversa:');
    sections.push(...archetype.tactics.map((tactic) => `- ${tactic}`));
  }
  if (persona.description) {
    sections.push('');
    if (archetype) sections.push('Traços adicionais deste cliente:');
    sections.push(persona.description);
  }
  sections.push('</seu_comportamento>');

  sections.push('', '<seu_objetivo>', persona.goal, '</seu_objetivo>');

  return sections.join('\n');
}
