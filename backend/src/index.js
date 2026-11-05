import { config } from './config.js';
import { createApp } from './app.js';
import { startSweeper } from './jobs/sweeper.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`NetPositive backend on :${config.PORT} (escrow=${config.ESCROW_MODE}, worldIdMock=${config.WORLD_ID_MOCK})`);
});
const stopSweeper = startSweeper();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopSweeper();
    server.close(() => process.exit(0));
  });
}
