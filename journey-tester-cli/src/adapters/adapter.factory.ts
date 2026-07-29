import type { AppConfig } from '../config/env.config';
import type { AdapterName } from '../scenario/scenario.schema';
import type { ChannelAdapter } from './channel.adapter';
import { CloudApiChannelAdapter } from './cloud-api.adapter';
import { HttpChannelAdapter } from './http.adapter';

export function createAdapter(name: AdapterName, config: AppConfig): ChannelAdapter {
  switch (name) {
    case 'http':
      return new HttpChannelAdapter(config);
    case 'cloud-api':
      return new CloudApiChannelAdapter(config);
    default: {
      const exhaustive: never = name;
      throw new Error(`adapter desconhecido: ${String(exhaustive)}`);
    }
  }
}
