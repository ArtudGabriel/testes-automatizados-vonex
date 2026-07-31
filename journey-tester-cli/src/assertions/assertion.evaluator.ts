import type { ProjectSpec } from '../scenario/project.schema';
import type { AssertionSpec } from '../scenario/scenario.schema';
import type { AssertionResult } from '../runner/run-result.types';
import {
  evaluateContains,
  evaluateMatches,
  evaluateMaxLatency,
  evaluateMessageCount,
  evaluateNotContains,
  flattenTurn,
  type TurnSnapshot,
} from './deterministic.evaluator';
import { evaluateJudge } from './judge.evaluator';

export interface EvaluationContext {
  turn: TurnSnapshot;
  userMessage: string;
  /** Conversa até o turno anterior, formatada para o judge. */
  transcript: string;
  /** Briefing da jornada, quando o cenário define. */
  project?: ProjectSpec;
}

/**
 * Roteia cada asserção para o avaliador certo. Determinísticas primeiro
 * (grátis e instantâneas); judge só quando o cenário pede semântica.
 */
export async function evaluateAssertions(
  specs: AssertionSpec[],
  context: EvaluationContext,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  for (const spec of specs) {
    results.push(await evaluateOne(spec, context));
  }

  return results;
}

async function evaluateOne(
  spec: AssertionSpec,
  context: EvaluationContext,
): Promise<AssertionResult> {
  if (spec.contains !== undefined) return evaluateContains(spec.contains, context.turn);
  if (spec.notContains !== undefined) return evaluateNotContains(spec.notContains, context.turn);
  if (spec.matches !== undefined) return evaluateMatches(spec.matches, context.turn);
  if (spec.maxLatencyMs !== undefined) return evaluateMaxLatency(spec.maxLatencyMs, context.turn);
  if (spec.messageCount !== undefined) {
    return evaluateMessageCount(spec.messageCount, context.turn);
  }

  if (spec.judge !== undefined) {
    const judge = typeof spec.judge === 'string' ? { criteria: spec.judge } : spec.judge;
    return evaluateJudge({
      criteria: judge.criteria,
      ...(judge.mustNot === undefined ? {} : { mustNot: judge.mustNot }),
      ...(context.project === undefined ? {} : { project: context.project }),
      transcript: context.transcript,
      turnText: flattenTurn(context.turn.messages),
      userMessage: context.userMessage,
    });
  }

  throw new Error(`asserção sem tipo reconhecido: ${JSON.stringify(spec)}`);
}
