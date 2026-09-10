'use strict';

const fs = require('fs');
const os = require('os');
const dns = require('dns');
const { execFileSync } = require('child_process');

// --- male pomocniky -------------------------------------------------------

// Citanie suboru, ktory nemusi existovat (v kontajneri casto nie je).
function readFile(p, maxBytes = 64 * 1024) {
  try {
    const data = fs.readFileSync(p, 'utf8');
    return data.length > maxBytes ? data.slice(0, maxBytes) + '\n…(skratene)' : data.trim();
  } catch (err) {
    return null;
  }
}

function readNumber(p) {
  const raw = readFile(p);
  if (raw === null) return null;
  if (raw === 'max') return 'max';
  const n = Number(raw.split(/\s+/)[0]);
  return Number.isFinite(n) ? n : raw;
}

function safe(fn, fallback = null) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

// Parsovanie "kluc: hodnota" alebo "kluc hodnota" suborov z /proc.
function parseKeyValue(raw, separator = ':') {
  if (!raw) return null;
  const out = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(separator);
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return Object.keys(out).length ? out : null;
}

const bytes = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

// Stropy, aby diagnostika nenafukla odpoved na strojoch s mnohymi mountmi/jadrami.
const MAX_MOUNTS = 60;
const MAX_CORES_LISTED = 16;

// --- jednotlive sekcie ----------------------------------------------------

function runtime() {
  return {
    node: process.version,
    versions: process.versions,
    execPath: process.execPath,
    argv: process.argv,
    cwd: safe(() => process.cwd()),
    pid: process.pid,
    ppid: process.ppid,
    execArgv: process.execArgv,
    debugPort: process.debugPort,
    nodeEnv: process.env.NODE_ENV || null,
    tz: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    locale: safe(() => Intl.DateTimeFormat().resolvedOptions().locale),
    resourceUsage: safe(() => process.resourceUsage()),
    memoryUsage: process.memoryUsage(),
  };
}

function system() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    type: os.type(),
    release: os.release(),
    version: safe(() => os.version()),
    uname: safe(() => execFileSync('uname', ['-a'], { encoding: 'utf8', timeout: 2000 }).trim()),
    osRelease: parseKeyValue(readFile('/etc/os-release'), '='),
    machineId: readFile('/etc/machine-id'),
    bootTimeUptimeSeconds: Math.round(os.uptime()),
    loadavg: os.loadavg(),
    endianness: os.endianness(),
    tmpdir: os.tmpdir(),
    homedir: safe(() => os.homedir()),
    user: safe(() => os.userInfo()),
    uid: safe(() => process.getuid()),
    gid: safe(() => process.getgid()),
    groups: safe(() => process.getgroups()),
    kernelCmdline: readFile('/proc/cmdline'),
    limits: readFile('/proc/self/limits'),
    processStatus: parseKeyValue(readFile('/proc/self/status')),
  };
}

// Detekcia, ci a v com bezime (docker / podman / k8s / LXC / holy metal).
function container() {
  const cgroup = readFile('/proc/1/cgroup') || '';
  const mountInfo = readFile('/proc/self/mountinfo') || '';
  const signals = {
    dockerEnvFile: fs.existsSync('/.dockerenv'),
    podmanEnvFile: fs.existsSync('/run/.containerenv'),
    cgroupMentionsDocker: /docker/i.test(cgroup),
    cgroupMentionsKubepods: /kubepods/i.test(cgroup),
    cgroupMentionsLxc: /lxc/i.test(cgroup),
    overlayRootfs: /\soverlay\s/.test(mountInfo),
    containerEnvVar: process.env.container || null,
    kubernetesServiceHost: process.env.KUBERNETES_SERVICE_HOST || null,
    pid1Command: (readFile('/proc/1/comm') || '').trim() || null,
    pid1Cmdline: (readFile('/proc/1/cmdline') || '').replace(/\0/g, ' ').trim() || null,
  };

  let runtimeName = 'neznamy / bare metal';
  if (signals.kubernetesServiceHost || signals.cgroupMentionsKubepods) runtimeName = 'Kubernetes';
  else if (signals.podmanEnvFile) runtimeName = 'Podman';
  else if (signals.dockerEnvFile || signals.cgroupMentionsDocker) runtimeName = 'Docker';
  else if (signals.cgroupMentionsLxc) runtimeName = 'LXC';
  else if (signals.overlayRootfs) runtimeName = 'kontajner (overlayfs)';

  return {
    detected: runtimeName !== 'neznamy / bare metal',
    runtime: runtimeName,
    // Hostname kontajnera byva skrateny ID kontajnera.
    containerIdGuess: /^[0-9a-f]{12}$/.test(os.hostname()) ? os.hostname() : null,
    cgroupVersion: fs.existsSync('/sys/fs/cgroup/cgroup.controllers') ? 'v2' : 'v1',
    signals,
    cgroupRaw: cgroup || null,
  };
}

// Limity, ktore kontajneru realne nastavil hosting (cgroup v2 aj v1).
function limits() {
  const v2 = fs.existsSync('/sys/fs/cgroup/cgroup.controllers');
  const cpuMax = v2 ? readFile('/sys/fs/cgroup/cpu.max') : null;

  let cpuQuota = null;
  let cpuPeriod = null;
  if (v2 && cpuMax) {
    const [quota, period] = cpuMax.split(/\s+/);
    cpuQuota = quota === 'max' ? 'max' : Number(quota);
    cpuPeriod = Number(period);
  } else {
    cpuQuota = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');
    cpuPeriod = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_period_us');
    if (cpuQuota === -1) cpuQuota = 'max';
  }

  const cpuLimitCores =
    typeof cpuQuota === 'number' && typeof cpuPeriod === 'number' && cpuPeriod > 0
      ? Number((cpuQuota / cpuPeriod).toFixed(2))
      : null;

  const memoryMax = v2
    ? readNumber('/sys/fs/cgroup/memory.max')
    : readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const memoryCurrent = v2
    ? readNumber('/sys/fs/cgroup/memory.current')
    : readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes');

  // v1 pouziva pri "bez limitu" obrovske cislo, nie retazec.
  const memoryLimitBytes =
    typeof memoryMax === 'number' && memoryMax < Number.MAX_SAFE_INTEGER / 2 ? memoryMax : null;

  return {
    cgroupVersion: v2 ? 'v2' : 'v1',
    cpu: {
      hostCores: os.cpus().length,
      quota: cpuQuota,
      period: cpuPeriod,
      limitCores: cpuLimitCores,
      effectiveParallelism: safe(() => os.availableParallelism()),
      stat: parseKeyValue(
        v2 ? readFile('/sys/fs/cgroup/cpu.stat') : readFile('/sys/fs/cgroup/cpuacct/cpuacct.stat'),
        ' '
      ),
    },
    memory: {
      limitBytes: memoryLimitBytes,
      usageBytes: bytes(memoryCurrent),
      usagePercent:
        memoryLimitBytes && typeof memoryCurrent === 'number'
          ? Number(((memoryCurrent / memoryLimitBytes) * 100).toFixed(1))
          : null,
      hostTotalBytes: os.totalmem(),
      hostFreeBytes: os.freemem(),
      swapMaxBytes: v2 ? readNumber('/sys/fs/cgroup/memory.swap.max') : null,
    },
    pids: {
      max: v2 ? readNumber('/sys/fs/cgroup/pids.max') : readNumber('/sys/fs/cgroup/pids/pids.max'),
      current: v2
        ? readNumber('/sys/fs/cgroup/pids.current')
        : readNumber('/sys/fs/cgroup/pids/pids.current'),
      threadsOfThisProcess: safe(
        () => Number((parseKeyValue(readFile('/proc/self/status')) || {}).Threads) || null
      ),
    },
  };
}

function cpu() {
  const cpus = os.cpus();
  const model = cpus.length ? cpus[0].model : null;
  return {
    model,
    count: cpus.length,
    speedMHz: cpus.length ? cpus[0].speed : null,
    availableParallelism: safe(() => os.availableParallelism()),
    // Cely /proc/cpuinfo je dlhy, staci suhrn prvého jadra.
    flags: safe(() => {
      const info = parseKeyValue(readFile('/proc/cpuinfo'));
      return info && info.flags ? info.flags.split(' ').slice(0, 40).join(' ') + ' …' : null;
    }),
    perCoreTimes: cpus.slice(0, MAX_CORES_LISTED).map((c, i) => ({ core: i, times: c.times })),
    perCoreTimesTruncated: cpus.length > MAX_CORES_LISTED ? cpus.length : false,
  };
}

function disk() {
  const paths = ['/', process.cwd(), os.tmpdir()];
  const out = {};
  for (const p of paths) {
    out[p] = safe(() => {
      const s = fs.statfsSync(p);
      const totalBytes = s.blocks * s.bsize;
      const freeBytes = s.bavail * s.bsize;
      return {
        totalBytes,
        freeBytes,
        usedBytes: totalBytes - s.bfree * s.bsize,
        usedPercent: totalBytes
          ? Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1))
          : null,
        inodesTotal: s.files,
        inodesFree: s.ffree,
      };
    });
  }
  return {
    filesystems: out,
    // Zoznam pripojenych zvazkov ukaze, ci mame persistentny disk.
    // Na strojoch s desiatkami mountov by cely vypis odpoved zbytocne nafukol.
    mounts: safe(() => {
      const raw = readFile('/proc/mounts');
      if (!raw) return null;
      const all = raw
        .split('\n')
        .map((line) => {
          const [device, mountPoint, type, options] = line.split(/\s+/);
          return { device, mountPoint, type, options };
        })
        .filter((m) => m.mountPoint && !/^\/(proc|sys)\//.test(m.mountPoint));
      return all.length > MAX_MOUNTS
        ? { total: all.length, shown: MAX_MOUNTS, list: all.slice(0, MAX_MOUNTS) }
        : all;
    }),
    rootListing: safe(() => fs.readdirSync('/')),
    appDirListing: safe(() => fs.readdirSync(process.cwd())),
    appDirWritable: safe(() => {
      fs.accessSync(process.cwd(), fs.constants.W_OK);
      return true;
    }, false),
    tmpWritable: safe(() => {
      fs.accessSync(os.tmpdir(), fs.constants.W_OK);
      return true;
    }, false),
  };
}

function network() {
  const interfaces = os.networkInterfaces();
  return {
    interfaces,
    addresses: Object.entries(interfaces).flatMap(([name, addrs]) =>
      (addrs || []).map((a) => ({ interface: name, family: a.family, address: a.address, internal: a.internal }))
    ),
    dnsServers: safe(() => dns.getServers()),
    resolvConf: readFile('/etc/resolv.conf'),
    hostsFile: readFile('/etc/hosts'),
    fqdn: safe(() => execFileSync('hostname', ['-f'], { encoding: 'utf8', timeout: 2000 }).trim()),
  };
}

// Premenne prostredia: kluce vidno vzdy, hodnoty len pre bezpecne premenne.
// Cela appka bezi na verejnej URL, takze tokeny by sme inak vystavili svetu.
const SECRET_PATTERN = /(secret|token|key|password|passwd|pwd|credential|auth|private|salt|signature|session|cookie|dsn|conn|database_url|dburl)/i;
const SAFE_PREFIXES = ['APP_', 'NODE_', 'npm_config_', 'PORT', 'HOSTNAME', 'HOME', 'PATH', 'PWD', 'LANG', 'TZ', 'USER', 'SHELL', 'TERM'];

function env(showAll) {
  const all = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b));
  const values = {};
  for (const [key, value] of all) {
    const isSecret = SECRET_PATTERN.test(key);
    const isSafe = SAFE_PREFIXES.some((p) => key.startsWith(p));
    if (isSecret && !showAll) {
      values[key] = `«skryte, ${String(value).length} znakov»`;
    } else if (isSafe || showAll) {
      values[key] = value;
    } else {
      values[key] = `«hodnota skryta, ${String(value).length} znakov»`;
    }
  }
  return {
    count: all.length,
    keys: all.map(([k]) => k),
    values,
    appVariables: Object.fromEntries(all.filter(([k]) => k.startsWith('APP_'))),
    revealAllEnabled: showAll,
    hint: showAll
      ? 'DIAG_SHOW_ALL_ENV je zapnute — vsetky hodnoty vratane tajnych su verejne viditelne.'
      : 'Hodnoty su maskovane. Pre plny vypis nastav DIAG_SHOW_ALL_ENV=1 (len docasne, URL je verejna).',
  };
}

// Co o poziadavke vie appka za reverznou proxy hostingu.
function request(req) {
  return {
    method: req.method,
    path: req.originalUrl || req.url,
    httpVersion: req.httpVersion,
    protocolSeenByApp: req.protocol,
    protocolFromProxy: req.headers['x-forwarded-proto'] || null,
    hostHeader: req.headers.host || null,
    forwardedFor: req.headers['x-forwarded-for'] || null,
    remoteAddress: req.socket.remoteAddress,
    remotePort: req.socket.remotePort,
    localAddress: req.socket.localAddress,
    localPort: req.socket.localPort,
    tlsTerminatedByProxy: (req.headers['x-forwarded-proto'] || null) === 'https' && req.protocol === 'http',
    headers: req.headers,
  };
}

function collect(req, options = {}) {
  const showAll = options.showAllEnv === true;
  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: 'grove-tech-test',
      startedAt: options.startedAt ? options.startedAt.toISOString() : null,
      uptimeSeconds: Math.round(process.uptime()),
      listenPort: options.port ?? null,
      message: process.env.APP_MESSAGE || 'APP_MESSAGE nie je nastavena',
      stage: process.env.APP_STAGE || 'neznamy',
    },
    container: container(),
    limits: limits(),
    runtime: runtime(),
    system: system(),
    cpu: cpu(),
    disk: disk(),
    network: network(),
    env: env(showAll),
    request: request(req),
  };
}

module.exports = { collect, readFile };
