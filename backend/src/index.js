import { config } from './config.js';
import { createApp } from './app.js';
import { startSweeper } from './jobs/sweeper.js';

const app = createApp();
// Express 5 passes a bind failure (e.g. EADDRINUSE) to this callback instead of throwing.
const server = app.listen(config.PORT, (err) => {
  if (err) {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${config.PORT} is already in use by another program. Set PORT in backend/.env to a free port.`
        : `Could not start the server: ${err.message}`,
    );
    process.exit(1);
  }
  console.log(`NetPositive backend on :${config.PORT} (escrow=${config.ESCROW_MODE}, worldIdMock=${config.WORLD_ID_MOCK})`);
});
const stopSweeper = startSweeper();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopSweeper();
    server.close(() => process.exit(0));
  });
}
