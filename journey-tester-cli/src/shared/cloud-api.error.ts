/** Fora da janela de 24h: a Meta exige template aprovado para reabrir. */
export const OUTSIDE_WINDOW_CODE = 131047;

export interface MetaError {
  code?: number;
  message: string;
  details?: string;
}

/**
 * A Cloud API põe o motivo real em `error.error_data.details`; `error.message`
 * costuma ser genérico. Sem ler os dois, o erro que chega no relatório não diz
 * o que fazer.
 */
export function readMetaError(data: unknown): MetaError {
  if (typeof data !== 'object' || data === null) {
    return { message: String(data ?? 'sem corpo') };
  }

  const error = (data as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return { message: JSON.stringify(data) };
  }

  const record = error as Record<string, unknown>;
  const errorData = (record.error_data ?? {}) as Record<string, unknown>;
  const details = typeof errorData.details === 'string' ? errorData.details : undefined;

  return {
    ...(typeof record.code === 'number' ? { code: record.code } : {}),
    message: typeof record.message === 'string' ? record.message : JSON.stringify(record),
    ...(details === undefined ? {} : { details }),
  };
}

export function isOutsideWindow(error: MetaError): boolean {
  return error.code === OUTSIDE_WINDOW_CODE;
}

export function describeMetaError(status: number, error: MetaError): string {
  const code = error.code === undefined ? '' : ` (código ${error.code})`;
  const details = error.details ? ` — ${error.details}` : '';
  return `Cloud API respondeu ${status}${code}: ${error.message}${details}`;
}
