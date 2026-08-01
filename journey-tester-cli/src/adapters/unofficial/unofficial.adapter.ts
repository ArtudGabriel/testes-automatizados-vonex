import { createServer, type Server } from 'node:http';
import axios, { type AxiosInstance } from 'axios';
import { readBody } from '../../capture/graph-sink.server';
import type { AppConfig } from '../../config/env.config';
import { logger } from '../../shared/logger';
import {
  extractMessageList,
  normalizeProviderMessage,
  providerMessageId,
} from '../../shared/unofficial-message';
import type {
  ChannelAdapter,
  ConversationContext,
  TurnReply,
  WaitOptions,
} from '../channel.adapter';
import { MessageCollector } from '../message-collector';
import { getProviderProfile, type ProviderProfile, type UnofficialProvider } from './provider.profile';

/**
 * Automatiza um número comum (chip de teste) via provedor não-oficial —
 * Z-API, Evolution API ou Uazapi — conversando com o número onde a jornada
 * está publicada.
 *
 * É o caminho quando não dá para reconfigurar a plataforma: a jornada receptiva
 * recebe exatamente o que receberia de um cliente real, sem template e sem
 * janela de 24h, e a plataforma não é tocada.
 *
 * Em troca: API fora dos termos do WhatsApp, com risco de banimento do número
 * conectado, e sessão que cai. Use chip dedicado, nunca o número de trabalho.
 */
export class UnofficialChannelAdapter implements ChannelAdapter {
  readonly name: string;

  private readonly profile: ProviderProfile;
  private readonly collector = new MessageCollector();
  private readonly http: AxiosInstance;
  private readonly botPhone: string;
  private readonly seenMessageIds = new Set<string>();
  private watermark = 0;
  private pollTimer?: NodeJS.Timeout;
  private polling = false;
  private server?: Server;

  constructor(
    provider: UnofficialProvider,
    private readonly config: AppConfig,
  ) {
    this.profile = getProviderProfile(provider);
    this.name = provider;

    if (!config.BOT_PHONE_NUMBER) {
      throw new Error(
        `adapter ${provider} exige BOT_PHONE_NUMBER (número onde a jornada está publicada)`,
      );
    }
    this.botPhone = config.BOT_PHONE_NUMBER;

    this.http = axios.create({
      baseURL: this.profile.baseUrl(config),
      headers: this.profile.authHeaders(config),
      timeout: 20_000,
      validateStatus: () => true,
    });
  }

  async open(_context: ConversationContext): Promise<void> {
    this.collector.reset();
    this.seenMessageIds.clear();

    // Só interessa o que chegar a partir de agora — o chat já tem histórico.
    this.watermark = Date.now();

    if (this.config.WA_PROVIDER_CAPTURE === 'webhook') {
      await this.startWebhookServer();
      return;
    }

    if (!this.profile.fetchMessages) {
      throw new Error(
        `${this.profile.label} não expõe leitura de histórico; use WA_PROVIDER_CAPTURE=webhook`,
      );
    }

    await this.primePollWatermark();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.WA_PROVIDER_POLL_MS);
  }

  async sendText(text: string): Promise<void> {
    const call = this.profile.send(this.config, this.botPhone, text);
    const response = await this.http.request({
      method: call.method,
      url: call.path,
      data: call.body,
      params: call.query,
    });

    if (response.status >= 400) {
      throw new Error(
        `${this.profile.label} respondeu ${response.status} ao enviar: ${JSON.stringify(
          response.data,
        )}`,
      );
    }
    logger.debug('mensagem enviada', { provider: this.name, status: response.status });
  }

  async sendOptionReply(optionId: string, optionTitle?: string): Promise<void> {
    // Clicar num botão via API não-oficial é instável; responder com o texto do
    // botão é o que um cliente real faria e a jornada trata igual.
    await this.sendText(optionTitle ?? optionId);
  }

  waitForReply(options: WaitOptions): Promise<TurnReply> {
    return this.collector.wait(options);
  }

  async close(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** Marca o histórico existente como visto, para não reprocessá-lo. */
  private async primePollWatermark(): Promise<void> {
    const messages = await this.fetchChatMessages();
    for (const raw of messages) {
      const id = providerMessageId(raw);
      if (id) this.seenMessageIds.add(id);
    }
    logger.debug('histórico do chat marcado como visto', { total: messages.length });
  }

  private async poll(): Promise<void> {
    if (this.polling) return; // evita sobreposição em chat grande
    this.polling = true;

    try {
      for (const raw of await this.fetchChatMessages()) {
        const id = providerMessageId(raw);
        if (id && this.seenMessageIds.has(id)) continue;

        const message = normalizeProviderMessage(raw, Date.now());
        if (id) this.seenMessageIds.add(id);
        if (!message) continue;

        // Sem id confiável, o relógio do provedor evita duplicata. Ele não
        // serve para latência (ver OutboundMessage.receivedAt), mas serve aqui.
        const stamp = message.providerTimestamp ?? message.receivedAt;
        if (!id && stamp <= this.watermark) continue;

        this.watermark = Math.max(this.watermark, stamp);
        this.collector.push(message);
      }
    } catch (error) {
      logger.warn('falha ao consultar mensagens', {
        provider: this.name,
        error: (error as Error).message,
      });
    } finally {
      this.polling = false;
    }
  }

  private async fetchChatMessages(): Promise<unknown[]> {
    const fetchMessages = this.profile.fetchMessages;
    if (!fetchMessages) return [];

    const call = fetchMessages(this.config, this.botPhone);
    const response = await this.http.request({
      method: call.method,
      url: call.path,
      data: call.body,
      params: call.query,
    });

    if (response.status >= 400) {
      throw new Error(
        `${this.profile.label} respondeu ${response.status} ao ler o chat: ${JSON.stringify(
          response.data,
        )}`,
      );
    }

    return extractMessageList(response.data);
  }

  private async startWebhookServer(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void (async () => {
        try {
          const payload = JSON.parse(await readBody(req)) as unknown;
          const candidates = extractMessageList(payload);
          for (const raw of candidates.length > 0 ? candidates : [payload]) {
            const message = normalizeProviderMessage(raw, Date.now());
            if (message) this.collector.push(message);
          }
        } catch (error) {
          logger.warn('webhook com corpo inválido', {
            provider: this.name,
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
      `webhook do ${this.profile.label} escutando em ${this.config.INBOUND_WEBHOOK_HOST}:${this.config.INBOUND_WEBHOOK_PORT} ` +
        '(precisa estar exposto publicamente e cadastrado no provedor)',
    );
  }
}
