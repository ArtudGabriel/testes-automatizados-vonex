import { z } from 'zod';

/** `MÉTODO /caminho`, com `*` como curinga. Ex.: `POST /agenda/consultas`. */
const targetSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'alvo não pode ser vazio');

export const apiStubSchema = z.strictObject({
  match: targetSchema,
  respond: z
    .strictObject({
      status: z.number().int().min(100).max(599).default(200),
      body: z.unknown().optional(),
      /** Simula API lenta — útil para testar timeout da jornada. */
      delayMs: z.number().int().nonnegative().optional(),
    })
    .default({ status: 200 }),
});

export type ApiStubSpec = z.infer<typeof apiStubSchema>;

export const apiSpySchema = z.strictObject({
  /** Porta do spy. Sobrescreve API_SPY_PORT para este cenário. */
  port: z.number().int().positive().optional(),
  stubs: z.array(apiStubSchema).default([]),
});

export type ApiSpySpec = z.infer<typeof apiSpySchema>;

/** Asserção sobre uma chamada que a jornada fez (ou não) à API externa. */
export const apiCallAssertionSchema = z.strictObject({
  to: targetSchema,
  /** Número exato, ou faixa. Default: pelo menos uma. */
  times: z
    .union([
      z.number().int().nonnegative(),
      z.strictObject({
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
      }),
    ])
    .optional(),
  /** Subconjunto que precisa estar no corpo enviado. */
  bodyContains: z.unknown().optional(),
  /** Subconjunto que precisa estar na query string. */
  queryContains: z.record(z.string(), z.string()).optional(),
});

export type ApiCallAssertionSpec = z.infer<typeof apiCallAssertionSchema>;
