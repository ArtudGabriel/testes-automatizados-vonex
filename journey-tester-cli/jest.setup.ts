import { setLogLevel } from './src/shared/logger';

// O runner loga em stderr por design; no teste isso só polui a saída.
setLogLevel('silent');
