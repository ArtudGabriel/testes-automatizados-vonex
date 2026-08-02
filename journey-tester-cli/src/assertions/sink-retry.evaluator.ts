import type { SinkDelivery } from '../capture/graph-sink.server';
import type { AssertionResult } from '../runner/run-result.types';
import type { SinkRetriesSpec } from '../scenario/sink-fault.schema';

/**
 * Conta os reenvios que a plataforma fez depois de o sink recusar a entrega.
 *
 * `min` prova que ela insiste (não engoliu a falha em silêncio); `max` prova
 * que não insiste demais — retry sem teto vira mensagem duplicada no WhatsApp
 * do cliente assim que a Meta voltar.
 */
export function evaluateSinkRetries(
  spec: SinkRetriesSpec,
  deliveries: SinkDelivery[],
): AssertionResult {
  const retries = deliveries.filter((delivery) => delivery.isRetry).length;
  const faults = deliveries.filter((delivery) => delivery.faultInjected !== undefined).length;

  const withinMin = spec.min === undefined || retries >= spec.min;
  const withinMax = spec.max === undefined || retries <= spec.max;

  const bounds = [
    spec.min === undefined ? undefined : `min ${spec.min}`,
    spec.max === undefined ? undefined : `max ${spec.max}`,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    kind: 'sinkRetries',
    passed: withinMin && withinMax,
    expected: `reenvios da plataforma (${bounds})`,
    actual: `${retries} reenvio(s) em ${deliveries.length} tentativa(s), ${faults} falha(s) injetada(s)`,
  };
}
