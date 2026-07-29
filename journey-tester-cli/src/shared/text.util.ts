/**
 * Normaliza texto para comparação: minúsculo, sem acento, espaços colapsados.
 * Cliente escreve "nao" e a IA responde "não" — comparação crua falharia à toa.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function includesNormalized(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

export function truncate(value: string, maxLength = 280): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function indentLines(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
