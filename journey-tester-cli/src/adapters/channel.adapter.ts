import type { SinkDelivery } from '../capture/graph-sink.server';
import type { SinkFaultSpec } from '../scenario/sink-fault.schema';
import type { InboundContact, OutboundMessage } from '../shared/whatsapp.types';

export interface ConversationContext {
  contact: InboundContact;
  scenarioName: string;
  /** Só o adapter `http` aplica: falhas a injetar nas respostas da Cloud API. */
  sinkFaults?: SinkFaultSpec[];
}

export interface WaitOptions {
  /** Quanto esperar pela primeira mensagem do turno. */
  replyTimeoutMs: number;
  /** Silêncio depois da última mensagem que fecha o turno. */
  settleMs: number;
}

export interface TurnReply {
  messages: OutboundMessage[];
  /** Tempo entre o envio do cliente e a primeira mensagem da IA. */
  latencyMs: number;
  timedOut: boolean;
}

/**
 * Contrato de transporte. Trocar de canal (webhook local ↔ Cloud API real)
 * não muda o cenário nem o runner.
 */
export interface ChannelAdapter {
  readonly name: string;
  open(context: ConversationContext): Promise<void>;
  sendText(text: string): Promise<void>;
  sendOptionReply(optionId: string, optionTitle?: string): Promise<void>;
  waitForReply(options: WaitOptions): Promise<TurnReply>;
  close(): Promise<void>;

  /**
   * Tentativas de entrega observadas. Só o adapter `http` tem sink; nos
   * demais a entrega acontece fora do nosso alcance.
   */
  deliveryCount?(): number;
  deliveriesSince?(marker: number): SinkDelivery[];
  allDeliveries?(): SinkDelivery[];
}
