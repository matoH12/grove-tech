const express = require('express');
const os = require('os');
const path = require('path');
const diag = require('./lib/diag');

const app = express();
const PORT = process.env.PORT || 3000;
const STARTED_AT = new Date();
// Pozor: zapina vypis vsetkych env premennych vratane tajnych na verejnej URL.
const SHOW_ALL_ENV = /^(1|true|yes)$/i.test(process.env.DIAG_SHOW_ALL_ENV || '');

app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const diagOptions = () => ({ startedAt: STARTED_AT, port: PORT, showAllEnv: SHOW_ALL_ENV });

// Health check - platforma si tymto overuje, ze appka zije
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Kompletna diagnostika kontajnera a behoveho prostredia
app.get('/api/info', (req, res) => {
  res.json(diag.collect(req, diagOptions()));
});

// Jednotliva sekcia, napr. /api/info/limits alebo /api/info/network
app.get('/api/info/:section', (req, res) => {
  const data = diag.collect(req, diagOptions());
  const section = req.params.section;
  if (!(section in data)) {
    return res.status(404).json({ error: 'neznama sekcia', available: Object.keys(data) });
  }
  res.json({ [section]: data[section] });
});

// Vsetko, co appka vidi o prichadzajucej poziadavke (hlavicky od proxy hostingu)
app.get('/api/request', (req, res) => {
  res.json(diag.collect(req, diagOptions()).request);
});

// Echo - overenie, ze POST/JSON telo prejde cez proxy hostingu
app.post('/api/echo', (req, res) => {
  res.json({ receivedAt: new Date().toISOString(), body: req.body });
});

// Zataz na CPU/pamat - ukaze, ci cgroup limity realne platia
app.get('/api/stress', (req, res) => {
  const ms = Math.min(Number(req.query.ms) || 200, 3000);
  const before = process.memoryUsage().heapUsed;
  const deadline = Date.now() + ms;
  let iterations = 0;
  while (Date.now() < deadline) {
    Math.sqrt(iterations++);
  }
  res.json({
    requestedMs: ms,
    iterations,
    heapBeforeBytes: before,
    heapAfterBytes: process.memoryUsage().heapUsed,
    loadavgAfter: os.loadavg(),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`grove-tech-test bezi na porte ${PORT}`);
  if (SHOW_ALL_ENV) {
    console.warn('POZOR: DIAG_SHOW_ALL_ENV je zapnute, /api/info vypise vsetky premenne prostredia.');
  }
});
