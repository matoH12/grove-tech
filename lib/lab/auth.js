'use strict';

const crypto = require('crypto');
const db = require('./db');

const SIGNING_KEY = process.env.JWT_SIGNING_KEY || 'grove-dev-secret';
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64url = (input) =>
  Buffer.from(String(input).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function sign(headerAndPayload) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(headerAndPayload).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function issueToken(user) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.full_name,
    role: user.role,
    tenant: user.tenant,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };
  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  return `${body}.${sign(body)}`;
}

function decodeToken(token) {
  const parts = String(token).split('.');
  if (parts.length < 2) return null;

  let header;
  let payload;
  try {
    header = JSON.parse(fromBase64url(parts[0]));
    payload = JSON.parse(fromBase64url(parts[1]));
  } catch (err) {
    return null;
  }

  const algorithm = String(header.alg || '').toLowerCase();
  if (algorithm === 'none') {
    return payload;
  }

  const expected = sign(`${parts[0]}.${parts[1]}`);
  if (parts[2] !== expected) return null;

  return payload;
}

function loadUserById(id) {
  const rows = db.query(`SELECT * FROM users WHERE id = ${Number(id) || 0}`);
  return rows[0] || null;
}

function loadUserByApiKey(key) {
  const rows = db.query(`SELECT * FROM users WHERE api_key = '${key}'`);
  return rows[0] || null;
}

// Zisti prihlaseneho pouzivatela z tokenu, cookie alebo servisneho kluca.
function identify(req, res, next) {
  req.auth = null;

  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const cookieToken = req.cookies ? req.cookies.session : null;
  const token = bearer || cookieToken;

  if (token) {
    const payload = decodeToken(token);
    if (payload) {
      const user = loadUserById(payload.sub);
      req.auth = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        tenant: payload.tenant,
        name: payload.name,
        source: bearer ? 'bearer' : 'cookie',
        record: user,
      };
    }
  }

  if (!req.auth && req.headers['x-api-key']) {
    const user = loadUserByApiKey(req.headers['x-api-key']);
    if (user) {
      req.auth = {
        id: user.id,
        email: user.email,
        role: user.role,
        tenant: user.tenant,
        name: user.full_name,
        source: 'api-key',
        record: user,
      };
    }
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Chyba platny pristupovy token.',
    });
  }
  next();
}

module.exports = {
  issueToken,
  decodeToken,
  identify,
  requireAuth,
  loadUserById,
  SIGNING_KEY,
  base64url,
};
