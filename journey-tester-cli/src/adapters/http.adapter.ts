import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance } from 'axios';
import type { AppConfig } from '../config/env.config';
import { GraphSinkServer, type SinkDelivery } from '../capture/graph-sink.server';
import { logger } from '../shared/logger';
import { buildInboundWebhook, type InboundContact } from '../shared/whatsapp.types';
import type {
  ChannelAdapter,
  ConversationContext,
  TurnReply,
  WaitOptions,
} from './channel.adapter';
import { MessageCollector } from './message-collector';

/**
 * Adapter padrão: injeta o payload de webhook do WhatsApp direto na API da
 * plataforma e captura a resposta pelo graph sink.
 *
 * Determinístico, roda em CI, não gasta conversa com a Meta e não precisa de
 * chip. Não cobre o canal em si (entrega, template, mídia) — para isso, o
 * adapter `cloud-api`.
 */
export class HttpChannelAdapter implements ChannelAdapter {
  readonly name = 'http';

  private readonly collector = new MessageCollector();
  private readonly sink: GraphSinkServer;
  private readonly http: AxiosInstance;
  private unsubscribe?: () => void;
  private contact?: InboundContact;

  constructor(private readonly config: AppConfig) {
    if (!config.PLATFORM_WEBHOOK_URL) {
      throw new Error(
        'PLATFORM_WEBHOOK_URL é obrigatória para o adapter http (endpoint de webhook da plataforma)',
      );
    }

    this.sink = new GraphSinkServer({
      host: config.GRAPH_SINK_HOST,
      port: config.GRAPH_SINK_PORT,
    });

    this.http = axios.create({
      timeout: 15_000,
      validateStatus: () => true,
    });
  }

  async open(context: ConversationContext): Promise<void> {
    this.contact = context.contact;
    this.sink.setFaults(context.sinkFaults ?? []);
    await this.sink.start();
    this.unsubscribe = this.sink.onMessage((message) => this.collector.push(message));
    this.collector.reset();
  }

  async sendText(text: string): Promise<void> {
    await this.deliver(buildInboundWebhook({
      contact: this.requireContact(),
      phoneNumberId: this.config.WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: this.config.WHATSAPP_BUSINESS_ACCOUNT_ID,
      displayPhoneNumber: this.config.WHATSAPP_DISPLAY_PHONE_NUMBER,
      text,
    }));
  }

  async sendOptionReply(optionId: string, optionTitle?: string): Promise<void> {
    await this.deliver(buildInboundWebhook({
      contact: this.requireContact(),
      phoneNumberId: this.config.WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: this.config.WHATSAPP_BUSINESS_ACCOUNT_ID,
      displayPhoneNumber: this.config.WHATSAPP_DISPLAY_PHONE_NUMBER,
      optionId,
      ...(optionTitle === undefined ? {} : { optionTitle }),
    }));
  }

  waitForReply(options: WaitOptions): Promise<TurnReply> {
    return this.collector.wait(options);
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.sink.stop();
  }

  deliveryCount(): number {
    return this.sink.deliveryCount;
  }

  deliveriesSince(marker: number): SinkDelivery[] {
    return this.sink.deliveriesSince(marker);
  }

  allDeliveries(): SinkDelivery[] {
    return this.sink.allDeliveries();
  }

  private async deliver(payload: Record<string, unknown>): Promise<void> {
    const url = this.config.PLATFORM_WEBHOOK_URL;
    if (!url) throw new Error('PLATFORM_WEBHOOK_URL não configurada');

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'content-type': 'application/json' };

    // A plataforma normalmente valida a assinatura da Meta; sem isso ela
    // rejeitaria o payload de teste com 401.
    if (this.config.WHATSAPP_APP_SECRET) {
      const signature = createHmac('sha256', this.config.WHATSAPP_APP_SECRET)
        .update(body)
        .digest('hex');
      headers['x-hub-signature-256'] = `sha256=${signature}`;
    }

    const response = await this.http.post(url, body, { headers });
    if (response.status >= 400) {
      throw new Error(
        `webhook da plataforma respondeu ${response.status}: ${JSON.stringify(response.data)}`,
      );
    }
    logger.debug('webhook entregue', { status: response.status });
  }

  private requireContact(): InboundContact {
    if (!this.contact) {
      throw new Error('adapter http usado antes de open()');
    }
    return this.contact;
  }
}
