import { evaluateAssertions } from '../assertions/assertion.evaluator';
import { flattenTurn } from '../assertions/deterministic.evaluator';
import type { ChannelAdapter, TurnReply } from '../adapters/channel.adapter';
import { ApiSpyServer, type RecordedApiCall } from '../capture/api-spy.server';
import type { SinkDelivery } from '../capture/graph-sink.server';
import { getConfig } from '../config/env.config';
import {
  describePersona,
  nextPersonaTurn,
  openingPersonaMessage,
} from '../persona/persona.simulator';
import type { ProjectSpec } from '../scenario/project.schema';
import type { LoadedScenario } from '../scenario/scenario.loader';
import type { AssertionSpec, ScenarioSpec, StepSpec } from '../scenario/scenario.schema';
import { logger } from '../shared/logger';
import type { ScenarioResult, TurnResult } from './run-result.types';

export interface RunnerOptions {
  /** Para o cenário no primeiro turno que falhar (default). */
  stopOnFailure: boolean;
  onTurn?: (turn: TurnResult) => void;
}

export class ScenarioRunner {
  private apiSpy?: ApiSpyServer;

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly options: RunnerOptions,
  ) {}

  async run(scenario: LoadedScenario): Promise<ScenarioResult> {
    const { spec, filePath, project } = scenario;
    const startedAt = Date.now();

    const result: ScenarioResult = {
      name: spec.name,
      filePath,
      adapter: this.adapter.name,
      mode: spec.persona ? 'persona' : 'steps',
      passed: false,
      durationMs: 0,
      turns: [],
      finalAssertions: [],
      ...(spec.persona ? { persona: describePersona(spec.persona) } : {}),
      ...(project ? { project: project.name } : {}),
    };

    try {
      await this.startApiSpy(spec);
      this.warnIfFaultsIgnored(spec);
      await this.adapter.open({
        contact: spec.contact,
        scenarioName: spec.name,
        ...(spec.sinkFaults ? { sinkFaults: spec.sinkFaults } : {}),
      });
      if (spec.persona) {
        await this.runPersona(spec, result, project);
      } else {
        await this.runSteps(spec, result, project);
      }
    } catch (error) {
      result.error = (error as Error).message;
      logger.error(`cenário "${spec.name}" abortou`, { error: result.error });
    } finally {
      await this.adapter.close().catch((error: unknown) => {
        logger.warn('falha ao fechar adapter', { error: (error as Error).message });
      });
      await this.apiSpy?.stop().catch((error: unknown) => {
        logger.warn('falha ao parar api spy', { error: (error as Error).message });
      });
      this.apiSpy = undefined;
    }

    warnIfNothingCaptured(result);

    result.durationMs = Date.now() - startedAt;
    result.passed =
      result.error === undefined &&
      result.turns.every((turn) => turn.passed) &&
      result.finalAssertions.every((assertion) => assertion.passed);

    return result;
  }

  /**
   * O cenário pode omitir `adapter` e herdar o default. Se o efetivo não tem
   * sink, as falhas declaradas simplesmente não acontecem — e um cenário que
   * testa retry passaria sem ter testado nada.
   */
  private warnIfFaultsIgnored(spec: ScenarioSpec): void {
    if (!spec.sinkFaults?.length || this.adapter.deliveriesSince) return;

    logger.warn(
      `\`sinkFaults\` ignorado: o adapter ${this.adapter.name} não tem sink. ` +
        'Rode com `--adapter http` para exercitar o retry da plataforma.',
    );
  }

  /** Marcador do início do turno; sem sink, sempre 0. */
  private deliveryMarker(): number {
    return this.adapter.deliveryCount?.() ?? 0;
  }

  private deliveriesSince(marker: number): SinkDelivery[] {
    return this.adapter.deliveriesSince?.(marker) ?? [];
  }

  private async startApiSpy(spec: ScenarioSpec): Promise<void> {
    if (!spec.apiSpy) return;

    const config = getConfig();
    this.apiSpy = new ApiSpyServer({
      host: config.API_SPY_HOST,
      port: spec.apiSpy.port ?? config.API_SPY_PORT,
      stubs: spec.apiSpy.stubs,
    });
    await this.apiSpy.start();
  }

  private async runSteps(
    spec: ScenarioSpec,
    result: ScenarioResult,
    project?: ProjectSpec,
  ): Promise<void> {
    const steps = spec.steps ?? [];

    for (const [index, step] of steps.entries()) {
      const turn = await this.playTurn(spec, result, index, step, project);
      result.turns.push(turn);
      this.options.onTurn?.(turn);

      if (!turn.passed && this.options.stopOnFailure) {
        logger.warn(`parando "${spec.name}" no turno ${index + 1} (falhou)`);
        return;
      }
    }
  }

  private async playTurn(
    spec: ScenarioSpec,
    result: ScenarioResult,
    index: number,
    step: StepSpec,
    project?: ProjectSpec,
  ): Promise<TurnResult> {
    const transcript = buildTranscript(result.turns);
    const userMessage = step.user ?? `[toca em "${step.tapOption}"]`;
    const apiMarker = this.apiSpy?.callCount ?? 0;
    const deliveryMarker = this.deliveryMarker();

    if (step.tapOption !== undefined) {
      const optionTitle = findOptionTitle(result.turns, step.tapOption);
      await this.adapter.sendOptionReply(step.tapOption, optionTitle);
    } else {
      await this.adapter.sendText(step.user ?? '');
    }

    const reply = await this.adapter.waitForReply({
      replyTimeoutMs: spec.replyTimeoutMs,
      settleMs: spec.settleMs,
    });

    return this.buildTurnResult({
      index,
      userMessage,
      isOptionReply: step.tapOption !== undefined,
      reply,
      expectations: step.expect,
      transcript,
      apiCalls: this.apiSpy?.callsSince(apiMarker) ?? [],
      deliveries: this.deliveriesSince(deliveryMarker),
      ...(project === undefined ? {} : { project }),
    });
  }

  private async runPersona(
    spec: ScenarioSpec,
    result: ScenarioResult,
    project?: ProjectSpec,
  ): Promise<void> {
    const persona = spec.persona;
    if (!persona) return;

    if (!project) {
      throw new Error('cenário com persona exige `project` ou `projectFile`');
    }

    // Sem primeira mensagem fixa, a própria persona abre a conversa — é assim
    // que o arquétipo aparece já no primeiro turno.
    let userMessage =
      persona.firstMessage ??
      (await openingPersonaMessage({ persona, project, transcript: '' }));

    for (let index = 0; index < persona.maxTurns; index += 1) {
      const transcript = buildTranscript(result.turns);
      const apiMarker = this.apiSpy?.callCount ?? 0;
      const deliveryMarker = this.deliveryMarker();

      await this.adapter.sendText(userMessage);
      const reply = await this.adapter.waitForReply({
        replyTimeoutMs: spec.replyTimeoutMs,
        settleMs: spec.settleMs,
      });

      const turn = await this.buildTurnResult({
        index,
        userMessage,
        isOptionReply: false,
        reply,
        expectations: [],
        transcript,
        apiCalls: this.apiSpy?.callsSince(apiMarker) ?? [],
        deliveries: this.deliveriesSince(deliveryMarker),
        project,
      });
      result.turns.push(turn);
      this.options.onTurn?.(turn);

      if (reply.timedOut) {
        logger.warn('persona interrompida: a IA não respondeu');
        break;
      }

      const next = await nextPersonaTurn({
        persona,
        project,
        transcript: buildTranscript(result.turns),
      });

      if (next.goalAchieved) {
        result.goalAchieved = true;
        logger.info(`persona atingiu o objetivo: ${next.reason}`);
        break;
      }

      if (!next.message.trim()) {
        logger.warn('persona não produziu próxima mensagem; encerrando');
        break;
      }

      userMessage = next.message;
    }

    result.goalAchieved ??= false;

    // No modo persona as asserções valem sobre a conversa inteira.
    result.finalAssertions = await evaluateAssertions(persona.expect, {
      turn: {
        messages: result.turns.flatMap((turn) => turn.botMessages),
        latencyMs: Math.max(0, ...result.turns.map((turn) => turn.latencyMs)),
      },
      userMessage: `objetivo da persona: ${persona.goal}`,
      transcript: buildTranscript(result.turns),
      apiCalls: this.apiSpy?.allCalls() ?? [],
      deliveries: this.adapter.allDeliveries?.() ?? [],
      project,
    });
  }

  private async buildTurnResult(params: {
    index: number;
    userMessage: string;
    isOptionReply: boolean;
    reply: TurnReply;
    expectations: AssertionSpec[];
    transcript: string;
    apiCalls: RecordedApiCall[];
    deliveries: SinkDelivery[];
    project?: ProjectSpec;
  }): Promise<TurnResult> {
    const assertions = await evaluateAssertions(params.expectations, {
      turn: { messages: params.reply.messages, latencyMs: params.reply.latencyMs },
      userMessage: params.userMessage,
      transcript: params.transcript,
      apiCalls: params.apiCalls,
      deliveries: params.deliveries,
      ...(params.project === undefined ? {} : { project: params.project }),
    });

    return {
      index: params.index,
      userMessage: params.userMessage,
      isOptionReply: params.isOptionReply,
      botMessages: params.reply.messages,
      apiCalls: params.apiCalls,
      deliveries: params.deliveries,
      latencyMs: params.reply.latencyMs,
      timedOut: params.reply.timedOut,
      assertions,
      passed: !params.reply.timedOut && assertions.every((assertion) => assertion.passed),
    };
  }
}

/**
 * "A IA não respondeu" tem duas causas muito diferentes: a jornada travou, ou
 * o sink nunca foi ligado. Sem esta dica, a primeira rodada real vira caça ao
 * fantasma.
 */
function warnIfNothingCaptured(result: ScenarioResult): void {
  if (result.error !== undefined || result.turns.length === 0) return;

  const capturedNothing = result.turns.every((turn) => turn.botMessages.length === 0);
  if (!capturedNothing) return;

  // Com falha injetada a causa é conhecida: o sink recusou tudo e a plataforma
  // não reenviou. Não é o mesmo problema de "nada chegou".
  const refused = result.turns.flatMap((turn) =>
    turn.deliveries.filter((delivery) => delivery.faultInjected !== undefined),
  );
  if (refused.length > 0) {
    logger.warn(
      `nenhuma resposta chegou ao cliente: o sink recusou ${refused.length} entrega(s) ` +
        'e a plataforma não reenviou nenhuma',
    );
    return;
  }

  const cause =
    result.adapter === 'http'
      ? 'a base URL da Cloud API no ambiente de teste da vonex.ai está apontada para o sink?'
      : 'o número do bot está certo e o chip de teste continua conectado?';

  logger.warn(
    `nenhuma resposta foi capturada em todo o cenário — ${cause} ` +
      '(rode `journey-tester doctor`)',
  );
}

export function buildTranscript(turns: TurnResult[]): string {
  return turns
    .map((turn) => {
      const bot = flattenTurn(turn.botMessages) || '(sem resposta)';
      return `Cliente: ${turn.userMessage}\nIA: ${bot}`;
    })
    .join('\n\n');
}

function findOptionTitle(turns: TurnResult[], optionId: string): string | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) continue;
    for (const message of turn.botMessages) {
      const option = message.options.find((entry) => entry.id === optionId);
      if (option) return option.title;
    }
  }
  return undefined;
}
