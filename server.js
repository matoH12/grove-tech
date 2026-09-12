const express = require('express');
const os = require('os');
const path = require('path');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const diag = require('./lib/diag');
const limitsTest = require('./lib/limits-test');
const labDb = require('./lib/lab/db');
const labRoutes = require('./lib/lab/routes');
const openapi = require('./lib/lab/openapi');

const app = express();
const PORT = process.env.PORT || 3000;
const STARTED_AT = new Date();
// Pozor: zapina vypis vsetkych env premennych vratane tajnych na verejnej URL.
const SHOW_ALL_ENV = /^(1|true|yes)$/i.test(process.env.DIAG_SHOW_ALL_ENV || '');
// Ak je nastaveny, destruktivne testy (pamat, zapis, restart) vyzaduju ?token=
const DIAG_TOKEN = process.env.DIAG_TOKEN || null;

app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const diagOptions = () => ({ startedAt: STARTED_AT, port: PORT, showAllEnv: SHOW_ALL_ENV });

// --- Commerce API a jeho dokumentacia ---------------------------------------

let labReady = false;
let labError = null;

app.get('/openapi.json', (req, res) => res.json(openapi));

app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapi, {
    customSiteTitle: 'Grove Tech Commerce API',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, tryItOutEnabled: true },
  })
);

app.use(
  '/api/v1',
  (req, res, next) => {
    if (labReady) return next();
    res.status(503).json({
      error: 'service_starting',
      message: labError ? `Databaza sa nepodarila inicializovat: ${labError}` : 'Sluzba sa spusta, skuste o chvilu.',
    });
  },
  labRoutes
);

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

// --- Testy limitov kontajnera ---------------------------------------------
// Su oddelene, lebo vedia appku zhodit alebo zaplnit disk.

function guard(req, res, next) {
  if (!DIAG_TOKEN) return next();
  const token = req.query.token || req.headers['x-diag-token'];
  if (token === DIAG_TOKEN) return next();
  res.status(403).json({ error: 'chyba alebo nesedi token', hint: 'pridaj ?token=… alebo hlavicku X-Diag-Token' });
}

const testRouter = express.Router();
testRouter.use(guard);

testRouter.get('/memory', (req, res) => {
  res.json(limitsTest.memorySnapshot());
});

// Alokuje a dotkne sa pamate; opakovanim sa da dojst az k OOM killu.
testRouter.get('/memory/alloc', (req, res) => {
  res.json(limitsTest.allocate(req.query.mb || 64));
});

testRouter.get('/memory/release', (req, res) => {
  res.json(limitsTest.release());
});

testRouter.get('/disk', (req, res) => {
  limitsTest.listTestFiles().then((data) => res.json(data), (err) => res.status(500).json({ error: err.message }));
});

// ?mb=100&target=app|tmp&fsync=0
testRouter.get('/disk/write', (req, res) => {
  const fsync = !/^(0|false|no)$/i.test(req.query.fsync || '');
  limitsTest
    .writeFile(req.query.target === 'tmp' ? 'tmp' : 'app', req.query.mb || 64, { fsync })
    .then((data) => res.json(data), (err) => res.status(500).json({ error: err.message }));
});

testRouter.get('/disk/read', (req, res) => {
  if (!req.query.file) return res.status(400).json({ error: 'chyba parameter file' });
  limitsTest.readBack(req.query.file).then((data) => res.json(data), (err) => res.status(500).json({ error: err.message }));
});

testRouter.get('/disk/cleanup', (req, res) => {
  limitsTest.cleanup().then((data) => res.json(data), (err) => res.status(500).json({ error: err.message }));
});

// Overenie, ci disk prezije restart kontajnera
testRouter.get('/marker/:action(write|read)', (req, res) => {
  limitsTest.marker(req.params.action).then((data) => res.json(data), (err) => res.status(500).json({ error: err.message }));
});

// Cisty pad procesu - ukaze, ci platforma appku sama nahodi spat
testRouter.get('/crash', (req, res) => {
  const code = Number(req.query.code) || 1;
  res.json({ crashing: true, exitCode: code, pid: process.pid, at: new Date().toISOString() });
  setTimeout(() => process.exit(code), 100);
});

app.use('/api/test', testRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

labDb
  .init()
  .then(() => {
    labReady = true;
    console.log('Commerce API pripravene, dokumentacia na /docs');
  })
  .catch((err) => {
    labError = err.message;
    console.error('Inicializacia databazy zlyhala:', err.message);
  });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`grove-tech-test bezi na porte ${PORT}`);
  console.log(DIAG_TOKEN ? 'Testy limitov su chranene tokenom.' : 'Testy limitov su OTVORENE (nastav DIAG_TOKEN).');
  if (SHOW_ALL_ENV) {
    console.warn('POZOR: DIAG_SHOW_ALL_ENV je zapnute, /api/info vypise vsetky premenne prostredia.');
  }
});
