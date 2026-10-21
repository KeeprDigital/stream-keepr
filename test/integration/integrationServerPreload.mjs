// Preloaded into each integration server and its worker threads (`integrationServerEnv`
// in `./helpers.ts`; worker threads through `./serverConnectionDiagnostics.mjs`).
import { installEarlyAnswerDrain } from './earlyAnswerDrain.mjs';
import { installServerConnectionDiagnostics } from './serverConnectionDiagnostics.mjs';

installServerConnectionDiagnostics({ announce: true });
installEarlyAnswerDrain();
