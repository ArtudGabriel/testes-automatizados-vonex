import type { TurnReply, WaitOptions } from './channel.adapter';
import type { OutboundMessage } from '../shared/whatsapp.types';

/**
 * Junta as mensagens de um turno. A IA quase sempre manda 2-3 mensagens
 * seguidas, então o turno só fecha depois de `settleMs` de silêncio — não com
 * um delay fixo, que seria flaky.
 */
export class MessageCollector {
  private buffer: OutboundMessage[] = [];
  private waiter?: {
    resolve: (reply: TurnReply) => void;
    options: WaitOptions;
    startedAt: number;
    replyTimeout: NodeJS.Timeout;
    settleTimeout?: NodeJS.Timeout;
  };

  push(message: OutboundMessage): void {
    this.buffer.push(message);

    const waiter = this.waiter;
    if (!waiter) return;

    clearTimeout(waiter.replyTimeout);
    if (waiter.settleTimeout) clearTimeout(waiter.settleTimeout);

    waiter.settleTimeout = setTimeout(() => this.settle(false), waiter.options.settleMs);
  }

  /** Descarta o que sobrou de turnos anteriores. */
  reset(): void {
    this.buffer = [];
  }

  async wait(options: WaitOptions): Promise<TurnReply> {
    if (this.waiter) {
      throw new Error('já existe uma espera em andamento neste coletor');
    }

    const startedAt = Date.now();

    return new Promise<TurnReply>((resolve) => {
      const replyTimeout = setTimeout(() => this.settle(true), options.replyTimeoutMs);
      this.waiter = { resolve, options, startedAt, replyTimeout };

      // Mensagem pode ter chegado antes da espera começar (resposta rápida).
      if (this.buffer.length > 0) {
        const waiter = this.waiter;
        clearTimeout(waiter.replyTimeout);
        waiter.settleTimeout = setTimeout(() => this.settle(false), options.settleMs);
      }
    });
  }

  private settle(timedOut: boolean): void {
    const waiter = this.waiter;
    if (!waiter) return;

    clearTimeout(waiter.replyTimeout);
    if (waiter.settleTimeout) clearTimeout(waiter.settleTimeout);
    this.waiter = undefined;

    const messages = this.buffer;
    this.buffer = [];

    const first = messages[0];
    waiter.resolve({
      messages,
      latencyMs: first ? first.receivedAt - waiter.startedAt : Date.now() - waiter.startedAt,
      timedOut: timedOut && messages.length === 0,
    });
  }
}
