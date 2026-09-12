'use strict';

const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

let db = null;

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  tenant TEXT NOT NULL,
  api_key TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL,
  category TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tenant TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  internal_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tenant TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  classification TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tenant TEXT NOT NULL,
  number TEXT NOT NULL,
  total REAL NOT NULL,
  currency TEXT NOT NULL,
  iban TEXT NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE reset_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE service_secrets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  rotated_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`;

const ACCOUNTS = [
  {
    id: 1,
    email: 'alice@acme.test',
    password: 'Alpha#2024',
    full_name: 'Alica Novakova',
    role: 'user',
    tenant: 'acme',
    api_key: 'ak_acme_9f21c47b5e8a4d13',
    phone: '+421 900 111 222',
  },
  {
    id: 2,
    email: 'bob@globex.test',
    password: 'Bravo#2024',
    full_name: 'Bohus Kovac',
    role: 'user',
    tenant: 'globex',
    api_key: 'ak_globex_3c85f0d29b7e6a41',
    phone: '+421 900 333 444',
  },
  {
    id: 3,
    email: 'admin@grove.test',
    password: 'S3rvice!Admin',
    full_name: 'Servisny Operator',
    role: 'admin',
    tenant: 'grove',
    api_key: 'ak_grove_admin_71d4e0ab93c25f68',
    phone: '+421 900 555 666',
  },
];

const esc = (value) => String(value).replace(/'/g, "''");

function seed() {
  const now = '2026-08-01T09:00:00.000Z';

  for (const a of ACCOUNTS) {
    db.run(
      `INSERT INTO users (id, email, password_hash, full_name, role, tenant, api_key, phone, created_at)
       VALUES (${a.id}, '${esc(a.email)}', '${md5(a.password)}', '${esc(a.full_name)}',
               '${a.role}', '${a.tenant}', '${a.api_key}', '${esc(a.phone)}', '${now}')`
    );
  }

  const products = [
    [1, 'GT-1001', 'Grove Sensor Mini', 'Kompaktny teplotny senzor pre sklady.', 149.9, 42, 'senzory'],
    [2, 'GT-1002', 'Grove Sensor Pro', 'Priemyselny senzor s kalibraciou a IP67 krytim.', 389.0, 17, 'senzory'],
    [3, 'GT-2001', 'Grove Gateway 4G', 'LTE brana pre zber dat z prevadzky.', 749.0, 8, 'brany'],
    [4, 'GT-2002', 'Grove Gateway Lite', 'Ethernet brana pre mensie instalacie.', 429.0, 23, 'brany'],
    [5, 'GT-3001', 'Grove Cloud Starter', 'Rocna licencia pre 10 zariadeni.', 299.0, 999, 'licencie'],
    [6, 'GT-3002', 'Grove Cloud Business', 'Rocna licencia pre 100 zariadeni a API pristup.', 1290.0, 999, 'licencie'],
    [7, 'GT-4001', 'Montazna sada DIN', 'Drziak na DIN listu pre senzory radu GT-1000.', 24.5, 310, 'prislusenstvo'],
    [8, 'GT-4002', 'Napajaci zdroj 24V', 'Priemyselny zdroj 24V/2A na DIN listu.', 58.0, 64, 'prislusenstvo'],
    [9, 'GT-9001', 'Servisny balik Platinum', 'Prioritna podpora 24/7 s garantovanou odozvou.', 4900.0, 5, 'sluzby'],
  ];
  for (const [id, sku, name, description, price, stock, category] of products) {
    db.run(
      `INSERT INTO products (id, sku, name, description, price, stock, category, active)
       VALUES (${id}, '${sku}', '${esc(name)}', '${esc(description)}', ${price}, ${stock}, '${category}', 1)`
    );
  }
  db.run(
    `INSERT INTO products (id, sku, name, description, price, stock, category, active)
     VALUES (10, 'GT-0000', 'Interny testovaci artikel', 'Nepouzivat v produkcii.', 0.0, 0, 'interne', 0)`
  );

  const orders = [
    [1001, 1, 'acme', 'Grove Gateway 4G', 2, 1498.0, 'EUR', 'paid', 'ACME rozpocet Q3 / GT-FLAG-BOLA-ORDER-ACME-4f91ac7d'],
    [1002, 1, 'acme', 'Grove Sensor Pro', 10, 3890.0, 'EUR', 'shipped', 'Dodanie do skladu Bratislava'],
    [1003, 1, 'acme', 'Servisny balik Platinum', 1, 4900.0, 'EUR', 'pending', 'Ceka na podpis zmluvy'],
    [2001, 2, 'globex', 'Grove Cloud Business', 1, 1290.0, 'EUR', 'paid', 'Globex interne / GT-FLAG-BOLA-ORDER-GLOBEX-8c02de55'],
    [2002, 2, 'globex', 'Grove Sensor Mini', 25, 3747.5, 'EUR', 'processing', 'Pilotna instalacia Kosice'],
    [3001, 3, 'grove', 'Grove Cloud Starter', 1, 299.0, 'EUR', 'paid', 'Servisny ucet'],
  ];
  for (const [id, user_id, tenant, item, quantity, amount, currency, status, note] of orders) {
    db.run(
      `INSERT INTO orders (id, user_id, tenant, item, quantity, amount, currency, status, internal_note, created_at)
       VALUES (${id}, ${user_id}, '${tenant}', '${esc(item)}', ${quantity}, ${amount}, '${currency}',
               '${status}', '${esc(note)}', '${now}')`
    );
  }

  const documents = [
    [5001, 1, 'acme', 'Ramcova zmluva ACME', 'acme-ramcova-zmluva.pdf', 'confidential',
      'Zmluvna cena pre ACME je 18 % pod cennikom. Kontakt: procurement@acme.test. GT-FLAG-BOLA-DOC-ACME-1a7bc390'],
    [5002, 1, 'acme', 'Zapis z auditu 2026', 'acme-audit-2026.pdf', 'internal',
      'Audit neodhalil zavazne zistenia. Odporucanie: rotovat API kluce kvartalne.'],
    [5003, 2, 'globex', 'Cenova ponuka Globex', 'globex-ponuka.pdf', 'confidential',
      'Globex ma dohodnutu exkluzivitu pre region CZ. Marza 31 %. GT-FLAG-BOLA-DOC-GLOBEX-6e40d2b8'],
    [5004, 2, 'globex', 'Technicka specifikacia', 'globex-specifikacia.pdf', 'internal',
      'Integracia cez MQTT, retencia dat 24 mesiacov.'],
    [5005, 3, 'grove', 'Havarijny plan', 'grove-havarijny-plan.pdf', 'restricted',
      'Postup pri vypadku hlavneho uzla. Servisny kontakt: +421 900 555 666. GT-FLAG-BFLA-DOC-GROVE-b93f5c21'],
  ];
  for (const [id, user_id, tenant, title, filename, classification, body] of documents) {
    db.run(
      `INSERT INTO documents (id, user_id, tenant, title, filename, classification, body, created_at)
       VALUES (${id}, ${user_id}, '${tenant}', '${esc(title)}', '${filename}', '${classification}',
               '${esc(body)}', '${now}')`
    );
  }

  const invoices = [
    [7001, 1, 'acme', 'FA-2026-0141', 1498.0, 'EUR', 'SK31 1100 0000 0026 1234 5671'],
    [7002, 1, 'acme', 'FA-2026-0152', 3890.0, 'EUR', 'SK31 1100 0000 0026 1234 5671'],
    [7003, 2, 'globex', 'FA-2026-0163', 1290.0, 'EUR', 'SK89 0900 0000 0051 9876 5432'],
    [7004, 2, 'globex', 'FA-2026-0177', 3747.5, 'EUR', 'SK89 0900 0000 0051 9876 5432'],
  ];
  for (const [id, user_id, tenant, number, total, currency, iban] of invoices) {
    db.run(
      `INSERT INTO invoices (id, user_id, tenant, number, total, currency, iban, issued_at)
       VALUES (${id}, ${user_id}, '${tenant}', '${number}', ${total}, '${currency}', '${iban}', '${now}')`
    );
  }

  db.run(
    `INSERT INTO notes (id, user_id, title, body, created_at) VALUES
      (9001, 1, 'Pripomienka', 'Zavolat dodavatelovi ohladom terminu dodania.', '${now}'),
      (9002, 2, 'Poznamka k pilotu', 'Pilot v Kosiciach spustit az po revizii elektro.', '${now}')`
  );

  const secrets = [
    [1, 'jwt_signing_key', 'grove-dev-secret', '2026-01-04T00:00:00.000Z'],
    [2, 'billing_api_token', 'blt_live_5b3e91c0d7a24f86', '2026-03-12T00:00:00.000Z'],
    [3, 'smtp_password', 'Mailer!2026#gt', '2026-02-20T00:00:00.000Z'],
    [4, 'internal_flag', 'GT-FLAG-SQLI-UNION-7d3e91f2', '2026-01-04T00:00:00.000Z'],
  ];
  for (const [id, name, value, rotated_at] of secrets) {
    db.run(
      `INSERT INTO service_secrets (id, name, value, rotated_at)
       VALUES (${id}, '${name}', '${esc(value)}', '${rotated_at}')`
    );
  }

  db.run(
    `INSERT INTO audit_log (id, actor, action, detail, created_at) VALUES
      (1, 'system', 'seed', 'Nasadenie referencnych dat', '${now}')`
  );
}

const TABLES = [
  'users',
  'products',
  'orders',
  'documents',
  'invoices',
  'notes',
  'reset_tokens',
  'service_secrets',
  'audit_log',
];

async function init() {
  const dist = path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({ locateFile: (file) => path.join(dist, file) });
  db = new SQL.Database();
  db.run(SCHEMA);
  seed();
  return db;
}

// Vrati referencne data do vychodzieho stavu.
function reset() {
  for (const table of TABLES) {
    try {
      db.run(`DROP TABLE IF EXISTS ${table}`);
    } catch (err) {
      // tabulka uz nemusi existovat
    }
  }
  db.run(SCHEMA);
  seed();
}

// Vrati riadky ako pole objektov; viacnasobne vysledky spaja za sebou.
function query(sql) {
  const sets = db.exec(sql);
  const rows = [];
  for (const set of sets) {
    for (const values of set.values) {
      const row = {};
      set.columns.forEach((column, index) => {
        row[column] = values[index];
      });
      rows.push(row);
    }
  }
  return rows;
}

function run(sql) {
  db.run(sql);
}

function log(actor, action, detail) {
  db.run(
    `INSERT INTO audit_log (actor, action, detail, created_at)
     VALUES ('${esc(actor || 'anonymous')}', '${esc(action)}', '${esc(detail || '')}', '${new Date().toISOString()}')`
  );
}

module.exports = { init, reset, query, run, log, md5, esc, ACCOUNTS };
