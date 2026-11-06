import { aiConfig } from './config';
import { installOfflineGuard } from './offline-guard';
import { createAiServer } from './http';
import { startQueue, stopQueue } from './queue/job-queue';
import { startLlamaServer, stopLlamaServer } from './llama/server-manager';

installOfflineGuard();
startQueue();

const server = createAiServer();
server.listen(aiConfig.port, aiConfig.host, () => {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      service: aiConfig.serviceName,
      version: aiConfig.serviceVersion,
      host: aiConfig.host,
      port: aiConfig.port,
      offlineAiMode: aiConfig.offlineMode,
      message: 'Tawasul AI listening. Lexicon ready; GGUF starts on demand when enabled.'
    })
  );
  if (aiConfig.enable.textGguf) {
    void startLlamaServer().then((result) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ llamaServer: result }));
    });
  }
});

function shutdown() {
  stopQueue();
  void stopLlamaServer().finally(() => {
    server.close(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
