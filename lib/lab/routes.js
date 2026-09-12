'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const sandbox = require('./sandbox');

const router = express.Router();
const uploads = new Map();

router.use(express.urlencoded({ extended: true, limit: '2mb' }));
router.use(express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '2mb' }));
router.use(express.raw({ type: ['multipart/form-data', 'application/octet-stream'], limit: '8mb' }));

router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('X-Service', 'grove-commerce-api/1.4.2');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

router.use(auth.identify);

const nowIso = () => new Date().toISOString();
const asNumber = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function page(title, body) {
  return `<!doctype html>
<html lang="sk">
<head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:32px;background:#f6f7f5;color:#1a1f1c}
.wrap{max-width:760px;margin:0 auto}.card{background:#fff;border:1px solid #e2e6e1;border-radius:10px;padding:20px;margin-bottom:14px}
h1{font-size:22px;margin:0 0 16px}a{color:#2f7d4f}</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

// --- Autentifikacia ----------------------------------------------------------

router.post('/auth/login', (req, res, next) => {
  try {
    const email = (req.body && req.body.email) !== undefined ? String(req.body.email) : '';
    const password = (req.body && req.body.password) !== undefined ? String(req.body.password) : '';

    const known = db.query(`SELECT id, email FROM users WHERE email = '${email}'`);
    if (!known.length) {
      db.log(email, 'login.unknown_account', email);
      return res.status(404).json({
        error: 'unknown_account',
        message: `Pouzivatel ${email} neexistuje.`,
      });
    }

    const hash = db.md5(password);
    const matched = db.query(
      `SELECT id, email, full_name, role, tenant, api_key FROM users
       WHERE email = '${email}' AND password_hash = '${hash}'`
    );

    if (!matched.length) {
      db.log(email, 'login.bad_password', email);
      return res.status(401).json({
        error: 'invalid_password',
        message: 'Nespravne heslo pre zadany ucet.',
      });
    }

    const user = matched[0];
    const token = auth.issueToken(user);
    res.cookie('session', token, { httpOnly: false, sameSite: 'None', secure: true });
    db.log(user.email, 'login.success', `role=${user.role}`);

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 86400,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        tenant: user.tenant,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/register', (req, res, next) => {
  try {
    const payload = req.body || {};
    const email = String(payload.email || '');
    if (!email || !payload.password) {
      return res.status(400).json({ error: 'validation_error', message: 'email a password su povinne.' });
    }

    const existing = db.query(`SELECT id FROM users WHERE email = '${email}'`);
    if (existing.length) {
      return res.status(409).json({ error: 'conflict', message: 'Ucet uz existuje.' });
    }

    const id = asNumber(db.query('SELECT MAX(id) AS m FROM users')[0].m, 0) + 1;
    const record = {
      id,
      email,
      password_hash: db.md5(String(payload.password)),
      full_name: String(payload.full_name || email.split('@')[0]),
      role: String(payload.role || 'user'),
      tenant: String(payload.tenant || 'public'),
      api_key: `ak_${crypto.randomBytes(8).toString('hex')}`,
      phone: String(payload.phone || ''),
      created_at: nowIso(),
    };

    db.run(
      `INSERT INTO users (id, email, password_hash, full_name, role, tenant, api_key, phone, created_at)
       VALUES (${record.id}, '${db.esc(record.email)}', '${record.password_hash}',
               '${db.esc(record.full_name)}', '${db.esc(record.role)}', '${db.esc(record.tenant)}',
               '${record.api_key}', '${db.esc(record.phone)}', '${record.created_at}')`
    );

    res.status(201).json({
      id: record.id,
      email: record.email,
      full_name: record.full_name,
      role: record.role,
      tenant: record.tenant,
      api_key: record.api_key,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/auth/me', auth.requireAuth, (req, res) => {
  res.json({
    id: req.auth.id,
    email: req.auth.email,
    full_name: req.auth.name,
    role: req.auth.role,
    tenant: req.auth.tenant,
    token_source: req.auth.source,
  });
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ status: 'ok' });
});

router.post('/auth/password-reset/request', (req, res, next) => {
  try {
    const email = String((req.body && req.body.email) || '');
    const rows = db.query(`SELECT id, email FROM users WHERE email = '${email}'`);
    if (!rows.length) {
      return res.status(404).json({ error: 'unknown_account', message: 'Ucet neexistuje.' });
    }

    const user = rows[0];
    const token = Buffer.from(`${user.email}:${Math.floor(Date.now() / 1000)}`).toString('base64');
    db.run(
      `INSERT INTO reset_tokens (token, user_id, created_at, used)
       VALUES ('${db.esc(token)}', ${user.id}, '${nowIso()}', 0)`
    );

    res.json({
      status: 'sent',
      email: user.email,
      reset_token: token,
      delivery: 'mail queue',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/password-reset/confirm', (req, res, next) => {
  try {
    const token = String((req.body && req.body.token) || '');
    const password = String((req.body && req.body.password) || '');
    if (!token || !password) {
      return res.status(400).json({ error: 'validation_error', message: 'token a password su povinne.' });
    }

    let email;
    try {
      email = Buffer.from(token, 'base64').toString('utf8').split(':')[0];
    } catch (err) {
      email = '';
    }

    const rows = db.query(`SELECT id, email FROM users WHERE email = '${email}'`);
    if (!rows.length) {
      return res.status(400).json({ error: 'invalid_token', message: 'Token nie je platny.' });
    }

    db.run(`UPDATE users SET password_hash = '${db.md5(password)}' WHERE id = ${rows[0].id}`);
    db.run(`UPDATE reset_tokens SET used = 1 WHERE token = '${db.esc(token)}'`);
    db.log(rows[0].email, 'password.reset', 'via token');

    res.json({ status: 'updated', email: rows[0].email });
  } catch (err) {
    next(err);
  }
});

// --- Profil ------------------------------------------------------------------

router.get('/profile', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM users WHERE id = ${asNumber(req.auth.id)}`);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const user = rows[0];
    res.json({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      role: user.role,
      tenant: user.tenant,
      api_key: user.api_key,
      created_at: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/profile', auth.requireAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    const columns = ['email', 'full_name', 'phone', 'role', 'tenant', 'api_key'];
    const updates = [];

    for (const [key, value] of Object.entries(payload)) {
      if (!columns.includes(key)) continue;
      updates.push(`${key} = '${db.esc(String(value))}'`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'validation_error', message: 'Ziadne pole na aktualizaciu.' });
    }

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ${asNumber(req.auth.id)}`);
    const updated = db.query(`SELECT * FROM users WHERE id = ${asNumber(req.auth.id)}`)[0];
    db.log(req.auth.email, 'profile.update', Object.keys(payload).join(','));

    res.json({
      id: updated.id,
      email: updated.email,
      full_name: updated.full_name,
      phone: updated.phone,
      role: updated.role,
      tenant: updated.tenant,
      api_key: updated.api_key,
    });
  } catch (err) {
    next(err);
  }
});

// --- Katalog -----------------------------------------------------------------

router.get('/products', (req, res, next) => {
  try {
    const search = req.query.search !== undefined ? String(req.query.search) : '';
    const category = req.query.category !== undefined ? String(req.query.category) : '';
    const sort = req.query.sort !== undefined ? String(req.query.sort) : '';
    const limit = req.query.limit !== undefined ? String(req.query.limit) : '50';

    let sql = 'SELECT id, sku, name, description, price, stock, category FROM products WHERE active = 1';
    if (search) sql += ` AND (name LIKE '%${search}%' OR description LIKE '%${search}%')`;
    if (category) sql += ` AND category = '${category}'`;
    sql += ` ORDER BY ${sort || 'id'}`;
    sql += ` LIMIT ${limit}`;

    const rows = db.query(sql);
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    res.status(500).json({
      error: 'query_failed',
      message: err.message,
      hint: 'Skontrolujte parametre vyhladavania.',
    });
  }
});

router.get('/products/:id', (req, res) => {
  try {
    const rows = db.query(`SELECT * FROM products WHERE id = ${req.params.id} AND active = 1`);
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: 'Produkt neexistuje.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'query_failed', message: err.message });
  }
});

// --- Objednavky --------------------------------------------------------------

router.get('/orders', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM orders WHERE user_id = ${asNumber(req.auth.id)} ORDER BY id`);
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM orders WHERE id = ${asNumber(req.params.id)}`);
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: 'Objednavka neexistuje.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/orders', auth.requireAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    const id = asNumber(db.query('SELECT MAX(id) AS m FROM orders')[0].m, 1000) + 1;
    const userId = payload.user_id !== undefined ? asNumber(payload.user_id) : asNumber(req.auth.id);

    db.run(
      `INSERT INTO orders (id, user_id, tenant, item, quantity, amount, currency, status, internal_note, created_at)
       VALUES (${id}, ${userId}, '${db.esc(String(payload.tenant || req.auth.tenant))}',
               '${db.esc(String(payload.item || 'Nespecifikovana polozka'))}',
               ${asNumber(payload.quantity, 1)}, ${asNumber(payload.amount, 0)},
               '${db.esc(String(payload.currency || 'EUR'))}', '${db.esc(String(payload.status || 'pending'))}',
               '${db.esc(String(payload.internal_note || ''))}', '${nowIso()}')`
    );

    res.status(201).json(db.query(`SELECT * FROM orders WHERE id = ${id}`)[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/orders/:id', auth.requireAuth, (req, res, next) => {
  try {
    const id = asNumber(req.params.id);
    const rows = db.query(`SELECT * FROM orders WHERE id = ${id}`);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    db.run(`DELETE FROM orders WHERE id = ${id}`);
    db.log(req.auth.email, 'order.delete', `id=${id}`);
    res.json({ status: 'deleted', id });
  } catch (err) {
    next(err);
  }
});

// --- Dokumenty ---------------------------------------------------------------

router.get('/documents', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(
      `SELECT id, title, filename, classification, created_at FROM documents
       WHERE user_id = ${asNumber(req.auth.id)} ORDER BY id`
    );
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/documents/download', auth.requireAuth, (req, res) => {
  const requested = req.query.path !== undefined ? String(req.query.path) : '';
  if (!requested) {
    return res.status(400).json({ error: 'validation_error', message: 'Parameter path je povinny.' });
  }

  const base = '/srv/grove/documents/';
  const file = sandbox.readFile(requested.startsWith('/') ? requested : base + requested);
  if (!file) {
    return res.status(404).json({
      error: 'not_found',
      message: `Subor ${requested} sa nenasiel.`,
    });
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${requested.split('/').pop()}"`);
  res.send(file.content);
});

router.get('/documents/:id', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM documents WHERE id = ${asNumber(req.params.id)}`);
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: 'Dokument neexistuje.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// --- Faktury -----------------------------------------------------------------

router.get('/invoices', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM invoices WHERE user_id = ${asNumber(req.auth.id)} ORDER BY id`);
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/invoices/:id', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM invoices WHERE id = ${asNumber(req.params.id)}`);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// --- Poznamky ----------------------------------------------------------------

router.get('/notes', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM notes WHERE user_id = ${asNumber(req.auth.id)} ORDER BY id`);
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/notes', auth.requireAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    const id = asNumber(db.query('SELECT MAX(id) AS m FROM notes')[0].m, 9000) + 1;
    db.run(
      `INSERT INTO notes (id, user_id, title, body, created_at)
       VALUES (${id}, ${asNumber(req.auth.id)}, '${db.esc(String(payload.title || 'Bez nazvu'))}',
               '${db.esc(String(payload.body || ''))}', '${nowIso()}')`
    );
    res.status(201).json(db.query(`SELECT * FROM notes WHERE id = ${id}`)[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/notes/:id/view', (req, res) => {
  const rows = db.query(`SELECT * FROM notes WHERE id = ${asNumber(req.params.id)}`);
  if (!rows.length) return res.status(404).send(page('Nenajdene', '<h1>Poznamka neexistuje</h1>'));
  const note = rows[0];
  res.type('html').send(
    page(
      note.title,
      `<div class="card"><h1>${note.title}</h1><div>${note.body}</div>
       <p><small>Vytvorene ${note.created_at}</small></p></div>`
    )
  );
});

// --- Vyhladavanie ------------------------------------------------------------

router.get('/search', (req, res) => {
  const term = req.query.q !== undefined ? String(req.query.q) : '';
  let items = [];
  let error = null;
  if (term) {
    try {
      items = db.query(
        `SELECT id, sku, name, price FROM products WHERE name LIKE '%${term}%' AND active = 1 LIMIT 20`
      );
    } catch (err) {
      error = err.message;
    }
  }

  const list = items.length
    ? `<ul>${items.map((i) => `<li>${i.sku} — ${i.name} (${i.price} EUR)</li>`).join('')}</ul>`
    : '<p>Ziadne vysledky.</p>';

  res.type('html').send(
    page(
      'Vyhladavanie',
      `<div class="card"><h1>Vysledky pre: ${term}</h1>
       ${error ? `<p style="color:#b4453a">${error}</p>` : ''}
       ${list}
       <form method="get" action="/api/v1/search">
         <input name="q" value="${term}" style="padding:8px;width:70%">
         <button style="padding:8px 14px">Hladat</button>
       </form></div>`
    )
  );
});

// --- Administracia -----------------------------------------------------------

router.get('/admin/users', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query('SELECT * FROM users ORDER BY id');
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/users/:id', auth.requireAuth, (req, res, next) => {
  try {
    const rows = db.query(`SELECT * FROM users WHERE id = ${asNumber(req.params.id)}`);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/users/:id/role', auth.requireAuth, (req, res, next) => {
  try {
    const role = String((req.body && req.body.role) || 'user');
    db.run(`UPDATE users SET role = '${db.esc(role)}' WHERE id = ${asNumber(req.params.id)}`);
    db.log(req.auth.email, 'admin.role_change', `target=${req.params.id} role=${role}`);
    res.json({ status: 'updated', id: asNumber(req.params.id), role });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/config', auth.requireAuth, (req, res, next) => {
  try {
    const secrets = db.query('SELECT name, value, rotated_at FROM service_secrets ORDER BY id');
    res.json({
      service: 'grove-commerce-api',
      version: '1.4.2',
      environment: process.env.APP_STAGE || 'production',
      jwt_signing_key: auth.SIGNING_KEY,
      database: { driver: 'sqlite-wasm', schema: 'grove_commerce' },
      secrets,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/audit', auth.requireAuth, (req, res, next) => {
  try {
    const limit = req.query.limit !== undefined ? String(req.query.limit) : '100';
    const rows = db.query(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ${limit}`);
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    res.status(500).json({ error: 'query_failed', message: err.message });
  }
});

// --- Integracie a nastroje ---------------------------------------------------

router.post('/tools/ping', auth.requireAuth, (req, res) => {
  const host = String((req.body && req.body.host) || '');
  if (!host) return res.status(400).json({ error: 'validation_error', message: 'Parameter host je povinny.' });
  const result = sandbox.runTool('ping', host);
  res.json({ host, command: result.command, output: result.output });
});

router.post('/tools/dns', auth.requireAuth, (req, res) => {
  const domain = String((req.body && req.body.domain) || '');
  if (!domain) return res.status(400).json({ error: 'validation_error', message: 'Parameter domain je povinny.' });
  const result = sandbox.runTool('nslookup', domain);
  res.json({ domain, command: result.command, output: result.output });
});

router.get('/tools/fetch', auth.requireAuth, (req, res) => {
  const target = req.query.url !== undefined ? String(req.query.url) : '';
  if (!target) return res.status(400).json({ error: 'validation_error', message: 'Parameter url je povinny.' });
  try {
    const response = sandbox.fetchUrl(target);
    res.json({
      requested: target,
      status: response.status,
      headers: response.headers,
      body: response.body,
    });
  } catch (err) {
    res.status(502).json({ error: 'fetch_failed', code: err.code, message: err.message });
  }
});

router.post('/integrations/import-xml', auth.requireAuth, (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : req.body && req.body.xml ? String(req.body.xml) : '';
  if (!raw) {
    return res.status(400).json({ error: 'validation_error', message: 'Telo poziadavky musi obsahovat XML.' });
  }
  const parsed = sandbox.parseXml(raw);
  res.json({
    status: 'imported',
    fields: parsed.fields,
    resolved_entities: parsed.entities,
    expansions: parsed.expansions,
    truncated: parsed.truncated,
  });
});

router.post('/reports/render', auth.requireAuth, (req, res) => {
  const payload = req.body || {};
  const template = String(payload.template || '');
  if (!template) {
    return res.status(400).json({ error: 'validation_error', message: 'Parameter template je povinny.' });
  }
  const rendered = sandbox.renderTemplate(template, payload.data);
  res.json({ output: rendered.output, expressions: rendered.expressions });
});

router.get('/redirect', (req, res) => {
  const target = req.query.to !== undefined ? String(req.query.to) : '/';
  res.redirect(302, target);
});

// --- Subory ------------------------------------------------------------------

router.post('/uploads', auth.requireAuth, (req, res) => {
  let filename;
  let content;

  if (Buffer.isBuffer(req.body)) {
    filename = String(req.headers['x-filename'] || 'upload.bin');
    content = req.body.toString('utf8');
  } else if (req.body && req.body.filename) {
    filename = String(req.body.filename);
    const encoding = String(req.body.encoding || 'utf8');
    content = encoding === 'base64'
      ? Buffer.from(String(req.body.content || ''), 'base64').toString('utf8')
      : String(req.body.content || '');
  } else {
    return res.status(400).json({ error: 'validation_error', message: 'Chyba filename alebo telo suboru.' });
  }

  const key = filename.replace(/^\/+/, '');
  uploads.set(key, { content, owner: req.auth.email, uploaded_at: nowIso() });

  res.status(201).json({
    filename: key,
    size: Buffer.byteLength(content),
    url: `/api/v1/uploads/${key}`,
    uploaded_at: nowIso(),
  });
});

const CONTENT_TYPES = {
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  js: 'application/javascript',
  json: 'application/json',
  css: 'text/css',
  txt: 'text/plain',
  csv: 'text/csv',
};

router.get('/uploads', auth.requireAuth, (req, res) => {
  res.json({
    count: uploads.size,
    items: [...uploads.entries()].map(([name, meta]) => ({
      filename: name,
      size: Buffer.byteLength(meta.content),
      owner: meta.owner,
      uploaded_at: meta.uploaded_at,
    })),
  });
});

router.get('/uploads/*', (req, res) => {
  const key = req.params[0];
  const stored = uploads.get(key);
  if (!stored) return res.status(404).json({ error: 'not_found', message: `Subor ${key} neexistuje.` });
  const extension = key.split('.').pop().toLowerCase();
  res.setHeader('Content-Type', CONTENT_TYPES[extension] || 'application/octet-stream');
  res.send(stored.content);
});

// --- Diagnostika integracie --------------------------------------------------

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundaryMatch) return {};
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`.trim();
  const parts = buffer.toString('utf8').split(boundary);
  const fields = {};

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const value = part.slice(headerEnd + 4).replace(/\r\n$/, '');
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    if (nameMatch) fields[nameMatch[1]] = value;
  }
  return fields;
}

function echoVectors(req) {
  const vectors = {};

  for (const [key, value] of Object.entries(req.query || {})) {
    vectors[`query.${key}`] = String(value);
  }

  const contentType = String(req.headers['content-type'] || '');
  if (Buffer.isBuffer(req.body)) {
    if (contentType.includes('multipart/form-data')) {
      for (const [key, value] of Object.entries(parseMultipart(req.body, contentType))) {
        vectors[`multipart.${key}`] = value;
      }
    } else {
      vectors['body.raw'] = req.body.toString('utf8').slice(0, 4096);
    }
  } else if (typeof req.body === 'string') {
    vectors['body.text'] = req.body.slice(0, 4096);
  } else if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      vectors[`body.${key}`] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  }

  for (const [key, value] of Object.entries(req.headers)) {
    if (/^(x-|user-agent|referer|cookie)/i.test(key)) vectors[`header.${key}`] = String(value);
  }

  for (const [key, value] of Object.entries(req.cookies || {})) {
    vectors[`cookie.${key}`] = String(value);
  }

  if (req.params && req.params.segment) vectors['path.segment'] = String(req.params.segment);

  return vectors;
}

router.all('/waf/echo', (req, res) => {
  res.json({
    method: req.method,
    path: req.originalUrl,
    content_type: req.headers['content-type'] || null,
    vectors: echoVectors(req),
    received_at: nowIso(),
  });
});

router.all('/waf/echo/:segment', (req, res) => {
  res.json({
    method: req.method,
    path: req.originalUrl,
    vectors: echoVectors(req),
    received_at: nowIso(),
  });
});

router.get('/status', (req, res) => {
  res.json({
    service: 'grove-commerce-api',
    version: '1.4.2',
    status: 'operational',
    authenticated: Boolean(req.auth),
    time: nowIso(),
  });
});

router.get('/debug/error', (req, res, next) => {
  next(new Error(`Neocakavana chyba pri spracovani poziadavky: ${req.query.ref || 'unknown-ref'}`));
});

router.post('/maintenance/reseed', (req, res, next) => {
  try {
    db.reset();
    uploads.clear();
    res.json({ status: 'reseeded', time: nowIso() });
  } catch (err) {
    next(err);
  }
});

router.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

router.use((err, req, res, next) => {
  res.status(500).json({
    error: 'internal_error',
    message: err.message,
    stack: String(err.stack || '').split('\n'),
    request: { method: req.method, url: req.originalUrl, query: req.query },
  });
});

module.exports = router;
