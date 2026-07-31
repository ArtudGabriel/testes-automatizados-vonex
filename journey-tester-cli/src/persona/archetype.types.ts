/**
 * Arquétipo de cliente: o "molde" de comportamento que a LLM veste para testar
 * a jornada. Cada um estressa a jornada por um ângulo diferente.
 */
export interface PersonaArchetype {
  /** Valor usado no YAML (`persona.archetype`). */
  id: string;
  /** Rótulo em PT-BR para o relatório. */
  label: string;
  /** Uma linha, para o `journey-tester personas`. */
  summary: string;
  /** Como esse cliente escreve e se comporta. Entra no system prompt. */
  behavior: string;
  /** O que ele faz de propósito para estressar a jornada. */
  tactics: string[];
  /** O que conta como fim bem-sucedido para este arquétipo. */
  successHint: string;
}
