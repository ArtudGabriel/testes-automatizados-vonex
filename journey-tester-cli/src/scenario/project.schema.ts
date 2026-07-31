import { z } from 'zod';

/**
 * Briefing da jornada sob teste. Sem isto o cliente simulado improvisa: não
 * sabe o que a jornada faz, inventa CPF quando a IA pede identificação e
 * insiste em pedido que está fora do escopo.
 *
 * Costuma ser o mesmo para todos os cenários de uma implantação — por isso
 * pode morar num arquivo separado e ser referenciado por `projectFile`.
 */
export const projectSchema = z.strictObject({
  name: z.string().min(1),
  /** Setor do cliente: "clínica odontológica", "e-commerce de moda"... */
  segment: z.string().min(1).optional(),
  /** O que a jornada faz, em uma ou duas frases. */
  description: z.string().min(1),
  /** O que a IA deve conseguir resolver. */
  capabilities: z.array(z.string().min(1)).default([]),
  /** O que está fora do escopo — o cliente simulado não insiste eternamente nisso. */
  outOfScope: z.array(z.string().min(1)).default([]),
  /**
   * Dados que o cliente simulado "possui" e informa quando a IA pedir.
   * Use dados fictícios: isto vai para a plataforma e para o modelo.
   */
  knownData: z.record(z.string().min(1), z.string()).default({}),
  /** Termos do negócio que o cliente pode usar ou ouvir. */
  glossary: z
    .array(
      z.strictObject({
        term: z.string().min(1),
        meaning: z.string().min(1),
      }),
    )
    .default([]),
  /** Quando e como a jornada deve passar para um humano. */
  escalation: z.string().min(1).optional(),
});

export type ProjectSpec = z.infer<typeof projectSchema>;

/** Formata o briefing para entrar no prompt da persona e do judge. */
export function renderProjectBriefing(project: ProjectSpec): string {
  const lines: string[] = [
    `Empresa/projeto: ${project.name}`,
    ...(project.segment ? [`Segmento: ${project.segment}`] : []),
    `O que este atendimento faz: ${project.description}`,
  ];

  if (project.capabilities.length > 0) {
    lines.push('', 'O atendimento deve conseguir resolver:');
    lines.push(...project.capabilities.map((entry) => `- ${entry}`));
  }

  if (project.outOfScope.length > 0) {
    lines.push('', 'Está fora do escopo deste atendimento:');
    lines.push(...project.outOfScope.map((entry) => `- ${entry}`));
  }

  if (project.glossary.length > 0) {
    lines.push('', 'Termos do negócio:');
    lines.push(...project.glossary.map((entry) => `- ${entry.term}: ${entry.meaning}`));
  }

  if (project.escalation) {
    lines.push('', `Passagem para humano: ${project.escalation}`);
  }

  return lines.join('\n');
}

/** Dados do cliente simulado, para ele responder quando a IA pedir identificação. */
export function renderKnownData(project: ProjectSpec): string {
  const entries = Object.entries(project.knownData);
  if (entries.length === 0) return '';

  return [
    'Dados que você tem e informa quando o atendimento pedir (não invente outros):',
    ...entries.map(([key, value]) => `- ${key}: ${value}`),
  ].join('\n');
}
