import { z } from 'zod';
import { archetypeIds } from '../persona/archetypes';
import { apiCallAssertionSchema, apiSpySchema } from './api-spy.schema';
import { projectSchema } from './project.schema';

export const ADAPTER_NAMES = ['http', 'cloud-api'] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];

const judgeSchema = z.union([
  z.string().min(1),
  z.strictObject({
    criteria: z.string().min(1),
    mustNot: z.string().min(1).optional(),
  }),
]);

const messageCountSchema = z
  .strictObject({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  })
  .refine((value) => value.min !== undefined || value.max !== undefined, {
    message: 'messageCount precisa de pelo menos min ou max',
  });

/**
 * Cada asserção carrega exatamente uma chave. Objeto strict + refine dá
 * mensagem de erro melhor do que z.union para chave escrita errado.
 */
export const assertionSchema = z
  .strictObject({
    contains: z.string().min(1).optional(),
    notContains: z.string().min(1).optional(),
    matches: z.string().min(1).optional(),
    judge: judgeSchema.optional(),
    maxLatencyMs: z.number().int().positive().optional(),
    messageCount: messageCountSchema.optional(),
    /** A jornada chamou a API externa como deveria. */
    apiCall: apiCallAssertionSchema.optional(),
    /** A jornada NÃO chamou este endpoint. */
    noApiCall: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const defined = Object.values(value).filter((entry) => entry !== undefined);
    if (defined.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cada item de expect deve ter exatamente uma asserção (encontrei ${defined.length})`,
      });
    }
  });

export type AssertionSpec = z.infer<typeof assertionSchema>;

export const stepSchema = z
  .strictObject({
    user: z.string().min(1).optional(),
    tapOption: z.string().min(1).optional(),
    note: z.string().optional(),
    expect: z.array(assertionSchema).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.user === undefined && value.tapOption === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'step precisa de `user` (texto) ou `tapOption` (id do botão)',
      });
    }
    if (value.user !== undefined && value.tapOption !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'step aceita `user` ou `tapOption`, não os dois',
      });
    }
  });

export type StepSpec = z.infer<typeof stepSchema>;

export const personaSchema = z
  .strictObject({
    /** Arquétipo do catálogo (`journey-tester personas` lista todos). */
    archetype: z.string().min(1).optional(),
    /** Traços extras, ou a persona inteira quando não há arquétipo. */
    description: z.string().min(1).optional(),
    goal: z.string().min(1),
    /** Opcional: sem isso a própria persona escreve a primeira mensagem. */
    firstMessage: z.string().min(1).optional(),
    maxTurns: z.number().int().positive().max(30).default(8),
    expect: z.array(assertionSchema).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.archetype === undefined && value.description === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `persona precisa de \`archetype\` (${archetypeIds().join(' | ')}) ou \`description\` livre`,
      });
    }
    if (value.archetype !== undefined && !archetypeIds().includes(value.archetype)) {
      ctx.addIssue({
        code: 'custom',
        path: ['archetype'],
        message: `arquétipo desconhecido "${value.archetype}". Disponíveis: ${archetypeIds().join(', ')}`,
      });
    }
  });

export type PersonaSpec = z.infer<typeof personaSchema>;

export const scenarioSchema = z
  .strictObject({
    name: z.string().min(1),
    description: z.string().optional(),
    adapter: z.enum(ADAPTER_NAMES).optional(),
    contact: z
      .strictObject({
        phone: z.string().regex(/^\d{10,15}$/, 'phone deve ser só dígitos, com DDI'),
        name: z.string().min(1).default('Cliente Teste'),
      })
      .default({ phone: '5511999999999', name: 'Cliente Teste' }),
    /** Quanto esperar pela primeira mensagem da IA em cada turno. */
    replyTimeoutMs: z.number().int().positive().default(30_000),
    /** Silêncio que define o fim do turno — a IA costuma mandar 2-3 mensagens seguidas. */
    settleMs: z.number().int().positive().default(2_500),
    /** Briefing da jornada, inline. */
    project: projectSchema.optional(),
    /** Briefing num arquivo à parte, compartilhado entre os cenários da implantação. */
    projectFile: z.string().min(1).optional(),
    /** Intercepta e stuba as APIs externas que a jornada consome. */
    apiSpy: apiSpySchema.optional(),
    steps: z.array(stepSchema).min(1).optional(),
    persona: personaSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.steps && !value.persona) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cenário precisa de `steps` (roteiro fixo) ou `persona` (cliente simulado)',
      });
    }
    if (value.steps && value.persona) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cenário aceita `steps` ou `persona`, não os dois',
      });
    }
    if (value.project && value.projectFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cenário aceita `project` (inline) ou `projectFile`, não os dois',
      });
    }
    if (value.persona && !value.project && !value.projectFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'cenário com `persona` precisa de `project` ou `projectFile` — sem briefing o cliente simulado improvisa',
      });
    }

    const usesApiAssertions = [
      ...(value.steps ?? []).flatMap((step) => step.expect),
      ...(value.persona?.expect ?? []),
    ].some((assertion) => assertion.apiCall !== undefined || assertion.noApiCall !== undefined);

    if (usesApiAssertions && !value.apiSpy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'asserções `apiCall`/`noApiCall` exigem o bloco `apiSpy` — sem ele nada é interceptado',
      });
    }
  });

export type ScenarioSpec = z.infer<typeof scenarioSchema>;
