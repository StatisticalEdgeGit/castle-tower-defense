// Entry point: `npm start` / `npm run dev` (via tsx). Listens on 0.0.0.0 so LAN devices
// can join, and serves the built client from dist/client when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toString as qrToString } from 'qrcode';
import { lanAddresses, phoneJoinUrl, startServer } from './app';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.PORT) || 4777;
const staticDir = path.join(root, 'dist', 'client');
const hasClient = fs.existsSync(path.join(staticDir, 'index.html'));
const devMode = process.argv.includes('--dev');
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(root, 'data', 'db.json');

async function main() {
  const devTools = process.env.DEV_TOOLS === '1' || process.env.DEV_TOOLS === 'true';
  const srv = await startServer({ port, host: '0.0.0.0', dbPath, staticDir: hasClient ? staticDir : null, progression: { devTools } });
  const lan = lanAddresses();
  const line = '─'.repeat(56);
  console.log(`\n${line}\n  Tower defense server running on port ${srv.port}`);
  if (devMode) {
    console.log('  Dev mode — open the Vite client (hot reload):');
    console.log('  Local:   http://localhost:5180');
    for (const ip of lan) console.log(`  LAN:     http://${ip}:5180`);
    console.log(`  (API/socket server: http://localhost:${srv.port})`);
  } else if (hasClient) {
    console.log(`  Local:   http://localhost:${srv.port}`);
    for (const ip of lan) console.log(`  LAN:     http://${ip}:${srv.port}`);
  } else {
    console.log('  (no client build in dist/client — API/socket only)');
    console.log('  Dev client (Vite): http://localhost:5180');
    for (const ip of lan) console.log(`  LAN dev client:    http://${ip}:5180`);
  }
  console.log(`  Data:    ${path.relative(process.cwd(), dbPath) || dbPath}`);
  console.log(`  Dev tools: ${devTools ? 'ON (press \` in the app)' : 'off (set DEV_TOOLS=1)'}\n${line}`);

  const joinUrl = phoneJoinUrl(lan, srv.port, !devMode && hasClient);
  if (joinUrl) {
    console.log('\n  Scan with a phone on the same Wi-Fi:\n');
    try {
      console.log(await qrToString(joinUrl, { type: 'terminal', small: true, errorCorrectionLevel: 'M', margin: 1 }));
    } catch (err) {
      console.error('  Could not draw a QR code.', err);
    }
    console.log(`  ${joinUrl}\n`);
  } else {
    console.log('\n  No LAN address found, so phones on Wi-Fi cannot join this PC.\n');
  }

  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${sig} received, shutting down...`);
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    try {
      await srv.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGBREAK', () => void stop('SIGBREAK'));
}

main().catch((err) => {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process or set PORT=<port>.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
