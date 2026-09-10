'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const MB = 1024 * 1024;

// Stropy, aby sa test nedal zneuzit na zhodenie appky ci zaplnenie disku.
const MAX_ALLOC_MB = 1200;      // nad limitom kontajnera, aby sa dal OOM otestovat
const MAX_WRITE_MB = 8192;
const CHUNK_MB = 8;

// Drzime referencie, inak by GC alokovanu pamat hned uvolnil.
const blocks = [];

const readNumber = (p) => {
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (raw === 'max') return 'max';
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    return null;
  }
};

const cgroupV2 = () => fs.existsSync('/sys/fs/cgroup/cgroup.controllers');

function memorySnapshot() {
  const v2 = cgroupV2();
  const limit = v2
    ? readNumber('/sys/fs/cgroup/memory.max')
    : readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const current = v2
    ? readNumber('/sys/fs/cgroup/memory.current')
    : readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  const peak = v2 ? readNumber('/sys/fs/cgroup/memory.peak') : null;

  // Pocitadla tlaku na pamat - ukazu, ci uz kernel appku dusil este pred OOM.
  let events = null;
  try {
    const raw = fs.readFileSync(v2 ? '/sys/fs/cgroup/memory.events' : '/sys/fs/cgroup/memory/memory.failcnt', 'utf8');
    events = v2
      ? Object.fromEntries(raw.trim().split('\n').map((l) => {
          const [k, v] = l.split(/\s+/);
          return [k, Number(v)];
        }))
      : { failcnt: Number(raw.trim()) };
  } catch (err) {
    events = null;
  }

  const limitBytes = typeof limit === 'number' && limit < Number.MAX_SAFE_INTEGER / 2 ? limit : null;
  const usage = process.memoryUsage();

  return {
    cgroupLimitBytes: limitBytes,
    cgroupUsageBytes: current,
    cgroupPeakBytes: peak,
    cgroupUsagePercent:
      limitBytes && typeof current === 'number'
        ? Number(((current / limitBytes) * 100).toFixed(1))
        : null,
    cgroupEvents: events,
    processRssBytes: usage.rss,
    processHeapUsedBytes: usage.heapUsed,
    processExternalBytes: usage.external,
    processArrayBuffersBytes: usage.arrayBuffers,
    heldBlocks: blocks.length,
    heldBytes: blocks.reduce((sum, b) => sum + b.length, 0),
    v8HeapLimitBytes: require('v8').getHeapStatistics().heap_size_limit,
  };
}

// Alokuje pamat a hlavne sa jej dotkne, inak by stranky neboli rezidentne
// a cgroup by o nich nevedel.
function allocate(mb) {
  const size = Math.min(Math.max(Number(mb) || 0, 1), MAX_ALLOC_MB) * MB;
  const before = memorySnapshot();
  const t0 = process.hrtime.bigint();
  let error = null;
  try {
    const buf = Buffer.allocUnsafe(size);
    buf.fill(0x61);
    blocks.push(buf);
  } catch (err) {
    error = { name: err.name, message: err.message };
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { requestedMb: size / MB, durationMs: Number(ms.toFixed(1)), error, before, after: memorySnapshot() };
}

function release() {
  const before = memorySnapshot();
  blocks.length = 0;
  if (global.gc) global.gc();
  return { released: true, before, after: memorySnapshot() };
}

function diskSnapshot(dir) {
  try {
    const s = fs.statfsSync(dir);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    return {
      path: dir,
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - s.bfree * s.bsize,
      usedPercent: totalBytes ? Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(2)) : null,
      inodesFree: s.ffree,
    };
  } catch (err) {
    return { path: dir, error: err.message };
  }
}

const targetDir = (target) => (target === 'tmp' ? os.tmpdir() : path.join(process.cwd(), 'data'));

// Zapise subor po blokoch a meria priepustnost aj volne miesto pred/po.
async function writeFile(target, mb, { fsync = true } = {}) {
  const dir = targetDir(target);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `zapis-test-${Date.now()}.bin`);
  const totalMb = Math.min(Math.max(Number(mb) || 1, 1), MAX_WRITE_MB);
  const chunk = Buffer.alloc(CHUNK_MB * MB, 0x62);

  const before = diskSnapshot(dir);
  const t0 = process.hrtime.bigint();
  let written = 0;
  let error = null;
  let handle = null;

  try {
    handle = await fsp.open(file, 'w');
    while (written < totalMb * MB) {
      const remaining = totalMb * MB - written;
      await handle.write(remaining < chunk.length ? chunk.subarray(0, remaining) : chunk);
      written += Math.min(remaining, chunk.length);
    }
    if (fsync) await handle.sync(); // bez fsync by sme merali len rychlost page cache
  } catch (err) {
    error = { code: err.code, message: err.message };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }

  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const after = diskSnapshot(dir);
  let verifiedBytes = null;
  try {
    verifiedBytes = (await fsp.stat(file)).size;
  } catch (err) {
    verifiedBytes = null;
  }

  return {
    file,
    target: dir,
    requestedMb: totalMb,
    writtenBytes: written,
    verifiedBytes,
    fsync,
    seconds: Number(seconds.toFixed(2)),
    throughputMbPerSec: seconds > 0 ? Number((written / MB / seconds).toFixed(1)) : null,
    error,
    diskBefore: before,
    diskAfter: after,
    freeDeltaBytes:
      typeof before.freeBytes === 'number' && typeof after.freeBytes === 'number'
        ? before.freeBytes - after.freeBytes
        : null,
  };
}

async function readBack(file) {
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  let error = null;
  try {
    const stream = fs.createReadStream(file);
    for await (const chunk of stream) bytes += chunk.length;
  } catch (err) {
    error = { code: err.code, message: err.message };
  }
  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  return {
    file,
    bytes,
    seconds: Number(seconds.toFixed(2)),
    throughputMbPerSec: seconds > 0 ? Number((bytes / MB / seconds).toFixed(1)) : null,
    error,
  };
}

async function listTestFiles() {
  const out = {};
  for (const target of ['app', 'tmp']) {
    const dir = targetDir(target);
    out[dir] = await fsp
      .readdir(dir)
      .then((names) =>
        Promise.all(
          names.map(async (n) => {
            const st = await fsp.stat(path.join(dir, n)).catch(() => null);
            return { name: n, bytes: st ? st.size : null, mtime: st ? st.mtime.toISOString() : null };
          })
        )
      )
      .catch((err) => ({ error: err.code }));
  }
  return { files: out, disk: { app: diskSnapshot(targetDir('app')), tmp: diskSnapshot(targetDir('tmp')) } };
}

async function cleanup() {
  const removed = [];
  for (const target of ['app', 'tmp']) {
    const dir = targetDir(target);
    const names = await fsp.readdir(dir).catch(() => []);
    for (const n of names) {
      if (!n.startsWith('zapis-test-')) continue;
      await fsp.unlink(path.join(dir, n)).catch(() => {});
      removed.push(path.join(dir, n));
    }
  }
  return { removed, disk: { app: diskSnapshot(targetDir('app')), tmp: diskSnapshot(targetDir('tmp')) } };
}

// Marker prezije restart len vtedy, ked ma kontajner persistentny disk.
async function marker(action) {
  const out = {};
  for (const target of ['app', 'tmp']) {
    const dir = targetDir(target);
    const file = path.join(dir, 'marker.json');
    if (action === 'write') {
      await fsp.mkdir(dir, { recursive: true });
      const payload = { writtenAt: new Date().toISOString(), pid: process.pid, hostname: os.hostname() };
      await fsp.writeFile(file, JSON.stringify(payload));
      out[file] = payload;
    } else {
      out[file] = await fsp
        .readFile(file, 'utf8')
        .then((raw) => ({ found: true, ...JSON.parse(raw) }))
        .catch((err) => ({ found: false, reason: err.code }));
    }
  }
  return { action, currentPid: process.pid, currentHostname: os.hostname(), markers: out };
}

module.exports = {
  memorySnapshot,
  allocate,
  release,
  diskSnapshot,
  writeFile,
  readBack,
  listTestFiles,
  cleanup,
  marker,
  targetDir,
  MAX_ALLOC_MB,
  MAX_WRITE_MB,
};
