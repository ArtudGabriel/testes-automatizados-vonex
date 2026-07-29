import { createServer, type Server } from 'node:http';
import axios, { type AxiosInstance } from 'axios';
import type { AppConfig } from '../config/env.config';
import { readBody } from '../capture/graph-sink.server';
import { logger } from '../shared/logger';
import { extractInboundMessages } from '../shared/whatsapp.types';
import type {
  ChannelAdapter,
  ConversationContext,
  TurnReply,
  WaitOptions,
} from './channel.adapter';
import { MessageCollector } from './message-collector';

/**
 * Smoke test no canal real: um segundo número na Cloud API oficial faz o papel
 * do cliente e conversa com o número do bot.
 *
 * Custos e atritos reais (não são bug, são o preço do canal oficial):
 * - cada conversa é cobrada pela Meta;
 * - abrir conversa fora da janela de 24h exige template aprovado
 *   (`CLOUD_API_OPEN_TEMPLATE`);
 * - o webhook de entrada precisa estar publicamente acessível (túnel).
 *
 * Por isso este adapter é para pré-go-live, não para a suíte de CI.
 */
export class CloudApiChannelAdapter implements ChannelAdapter {
  readonly name = 'cloud-api';

  private readonly collector = new MessageCollector();
  private readonly http: AxiosInstance;
  private readonly phoneNumberId: string;
  private readonly botPhone: string;
  private server?: Server;
  private hasOpenWindow = false;

  constructor(private readonly config: AppConfig) {
    const token = config.CLOUD_API_TOKEN;
    const phoneNumberId = config.TESTER_PHONE_NUMBER_ID;
    const botPhone = config.BOT_PHONE_NUMBER;

    if (!token || !phoneNumberId || !botPhone) {
      throw new Error(
        'adapter cloud-api exige CLOUD_API_TOKEN, TESTER_PHONE_NUMBER_ID e BOT_PHONE_NUMBER',
      );
    }

    this.phoneNumberId = phoneNumberId;
    this.botPhone = botPhone;
    this.http = axios.create({
      baseURL: config.CLOUD_API_BASE_URL,
      headers: { authorization: `Bearer ${token}` },
      timeout: 20_000,
      validateStatus: () => true,
    });
  }

  async open(_context: ConversationContext): Promise<void> {
    await this.startWebhookServer();
    this.collector.reset();
  }

  async sendText(text: string): Promise<void> {
    if (!this.hasOpenWindow) {
      logger.warn(
        'primeira mensagem do turno fora da janela de 24h pode ser rejeitada pela Meta — ' +
          'use um template aprovado se receber erro 131047',
      );
    }

    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.botPhone,
      type: 'text',
      text: { preview_url: false, body: text },
    });
    this.hasOpenWindow = true;
  }

  async sendOptionReply(optionId: string, optionTitle?: string): Promise<void> {
    // A Cloud API não permite "clicar" num botão programaticamente; o mais
    // próximo é responder com o texto do botão, que é o que o usuário veria.
    await this.sendText(optionTitle ?? optionId);
  }

  waitForReply(options: WaitOptions): Promise<TurnReply> {
    return this.collector.wait(options);
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    const response = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
    if (response.status >= 400) {
      throw new Error(
        `Cloud API respondeu ${response.status}: ${JSON.stringify(response.data)}`,
      );
    }
  }

  private async startWebhookServer(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        // Handshake de verificação da Meta.
        if (req.method === 'GET') {
          const challenge = url.searchParams.get('hub.challenge');
          const token = url.searchParams.get('hub.verify_token');
          if (challenge && token === this.config.INBOUND_VERIFY_TOKEN) {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end(challenge);
            return;
          }
          res.writeHead(403).end();
          return;
        }

        try {
          const payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
          for (const message of extractInboundMessages(payload, Date.now())) {
            this.collector.push(message);
          }
        } catch (error) {
          logger.warn('webhook de entrada com corpo inválido', {
            error: (error as Error).message,
          });
        }

        res.writeHead(200).end();
      })();
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('servidor de webhook não foi criado'));
        return;
      }
      server.once('error', reject);
      server.listen(this.config.INBOUND_WEBHOOK_PORT, this.config.INBOUND_WEBHOOK_HOST, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    logger.info(
      `webhook de entrada escutando em ${this.config.INBOUND_WEBHOOK_HOST}:${this.config.INBOUND_WEBHOOK_PORT} ` +
        '(precisa estar exposto publicamente e registrado no app da Meta)',
    );
  }
}
