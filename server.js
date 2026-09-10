const express = require('express');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STARTED_AT = new Date();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check - platforma si tymto overuje, ze appka zije
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Info o behovom prostredi - ukazuje, co appka realne vidi na hostingu
app.get('/api/info', (req, res) => {
  res.json({
    app: 'grove-tech-test',
    message: process.env.APP_MESSAGE || 'APP_MESSAGE nie je nastavena',
    stage: process.env.APP_STAGE || 'neznamy',
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    hostname: os.hostname(),
    port: PORT,
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
    // Vypisujeme len vlastne APP_* premenne, nie cele prostredie kontajnera
    appEnv: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.startsWith('APP_'))
    ),
    clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    proto: req.headers['x-forwarded-proto'] || req.protocol,
  });
});

// Echo - overenie, ze POST/JSON telo prejde cez proxy hostingu
app.post('/api/echo', (req, res) => {
  res.json({ receivedAt: new Date().toISOString(), body: req.body });
});

app.use((req, res) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`grove-tech-test bezi na porte ${PORT}`);
});
