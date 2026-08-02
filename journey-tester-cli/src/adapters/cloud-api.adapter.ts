import { createServer, type Server } from 'node:http';
import axios, { type AxiosInstance } from 'axios';
import type { AppConfig } from '../config/env.config';
import { readBody } from '../capture/graph-sink.server';
import { logger } from '../shared/logger';
import {
  describeMetaError,
  isOutsideWindow,
  readMetaError,
  type MetaError,
} from '../shared/cloud-api.error';
import { extractInboundMessages } from '../shared/whatsapp.types';
import type {
  ChannelAdapter,
  ConversationContext,
  TurnReply,
  WaitOptions,
} from './channel.adapter';
import { MessageCollector } from './message-collector';

/** Erro da Cloud API com o código da Meta preservado, para decidir o retry. */
export class CloudApiRequestError extends Error {
  constructor(
    message: string,
    readonly meta: MetaError,
  ) {
    super(message);
    this.name = 'CloudApiRequestError';
  }
}

/**
 * Smoke test no canal real: um segundo número na Cloud API oficial faz o papel
 * do cliente e conversa com o número do bot.
 *
 * Custos e atritos reais (não são bug, são o preço do canal oficial):
 * - cada conversa é cobrada pela Meta;
 * - abrir conversa fora da janela de 24h exige template aprovado
 *   (`CLOUD_API_OPEN_TEMPLATE`), enviado antes da primeira mensagem;
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
  /** Já gastamos o template nesta conversa — não insistir em loop. */
  private openedWithTemplate = false;

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
    // Cada cenário começa uma conversa nova; a janela precisa ser reavaliada.
    this.hasOpenWindow = false;
  }

  async sendText(text: string): Promise<void> {
    await this.ensureWindow();

    try {
      await this.postText(text);
    } catch (error) {
      // A janela pode ter fechado entre um turno e outro (bot demorou a
      // responder). Reabrir e tentar de novo é melhor do que reprovar por isso.
      // Sem template não há o que reabrir, e reenviar só gastaria outra
      // mensagem para receber o mesmo 131047.
      if (!(error instanceof CloudApiRequestError) || !isOutsideWindow(error.meta)) throw error;
      if (this.openedWithTemplate || !this.config.CLOUD_API_OPEN_TEMPLATE) throw error;

      logger.warn('janela de 24h fechada no meio do cenário; reabrindo com template');
      this.hasOpenWindow = false;
      await this.ensureWindow();
      await this.postText(text);
    }

    this.hasOpenWindow = true;
  }

  /**
   * Como número business, o tester não pode iniciar conversa com texto livre:
   * fora da janela de 24h a Meta recusa com 131047. O template aprovado é o
   * único jeito de abrir — e a janela só abre de fato quando o bot responde,
   * então esperamos essa resposta antes de seguir.
   *
   * A resposta ao template é handshake, não parte do cenário: ela é descartada
   * para não ser cobrada das asserções do primeiro turno.
   */
  private async ensureWindow(): Promise<void> {
    if (this.hasOpenWindow) return;

    const template = this.config.CLOUD_API_OPEN_TEMPLATE;
    if (!template) {
      logger.warn(
        'sem CLOUD_API_OPEN_TEMPLATE: se a janela de 24h estiver fechada, a Meta recusa ' +
          'a primeira mensagem com erro 131047',
      );
      return;
    }

    logger.info(`abrindo a janela de 24h com o template "${template}"`);
    await this.post(this.buildTemplatePayload(template));
    this.openedWithTemplate = true;

    const reply = await this.collector.wait({
      replyTimeoutMs: this.config.CLOUD_API_OPEN_TIMEOUT_MS,
      settleMs: 2_000,
    });

    if (reply.timedOut) {
      logger.warn(
        'o bot não respondeu ao template: a janela pode continuar fechada. ' +
          'Seguindo mesmo assim — o erro 131047 dirá se não abriu.',
      );
      return;
    }

    logger.info(
      `janela aberta — ${reply.messages.length} mensagem(ns) de resposta ao template ` +
        'foram descartadas (handshake, não fazem parte do cenário)',
    );
    this.hasOpenWindow = true;
  }

  private buildTemplatePayload(template: string): Record<string, unknown> {
    const params = (this.config.CLOUD_API_OPEN_TEMPLATE_PARAMS ?? '')
      .split('|')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.botPhone,
      type: 'template',
      template: {
        name: template,
        language: { code: this.config.CLOUD_API_OPEN_TEMPLATE_LANG },
        // `components` só entra quando o template tem variável: template sem
        // variável recusa o array e volta 132000.
        ...(params.length === 0
          ? {}
          : {
              components: [
                {
                  type: 'body',
                  parameters: params.map((text) => ({ type: 'text', text })),
                },
              ],
            }),
      },
    };
  }

  private postText(text: string): Promise<void> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.botPhone,
      type: 'text',
      text: { preview_url: false, body: text },
    });
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
    if (response.status < 400) return;

    const meta = readMetaError(response.data);
    const hint =
      isOutsideWindow(meta) && !this.config.CLOUD_API_OPEN_TEMPLATE
        ? ' — defina CLOUD_API_OPEN_TEMPLATE com um template aprovado para abrir a janela de 24h'
        : '';

    throw new CloudApiRequestError(`${describeMetaError(response.status, meta)}${hint}`, meta);
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
