'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const screenshot = require('screenshot-desktop');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const ROOT = __dirname;
const MARKED_FILE = path.join(ROOT, 'marked.json');
const ALARM_SCRIPT = path.join(ROOT, 'scripts', 'alarm.ps1');
const VOLUME_SCRIPT = path.join(ROOT, 'scripts', 'max-volume.ps1');

const args = process.argv.slice(2);
const OPT = {
  intervalMs: 60 * 1000,
  rearmAfterMs: 60 * 1000,
  screen: '',
  allScreens: false,
  wav: 'C:\\Windows\\Media\\Alarm01.wav',
  forceVolume: false,
};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--force-volume') OPT.forceVolume = true;
  else if (a === '--no-force-volume') OPT.forceVolume = false;
  else if (a === '--all-screens') OPT.allScreens = true;
  else if (a === '--permanent') OPT.rearmAfterMs = 0;
  else if (a === '--rearm-after') {
    const n = Number(args[i + 1]);
    if (Number.isFinite(n) && n > 0) { OPT.rearmAfterMs = n * 1000; i++; }
    else OPT.rearmAfterMs = 60 * 1000;
  }
  else if (a === '--interval' && args[i + 1]) OPT.intervalMs = Math.max(1, Number(args[++i])) * 1000;
  else if (a === '--screen' && args[i + 1]) OPT.screen = args[++i];
  else if (a === '--wav' && args[i + 1]) OPT.wav = args[++i];
  else if (a === '--list-screens') OPT.listScreens = true;
  else if (a === '--clear-marks') OPT.clearMarks = true;
  else if (a === '--help') OPT.help = true;
}

if (OPT.help) {
  console.log(`Usage: node watcher.js [options]

  --interval <seconds>   Scan interval (default 60)
  --rearm-after <sec>    Re-arm a marked QR after it is off-screen this long (default 60)
  --permanent            Never re-arm; a marked QR is ignored forever
  --screen <id>          Capture one display by id (e.g. \\\\.\\DISPLAY1)
  --all-screens          Scan every display (default: primary only)
  --list-screens         Print display ids and exit
  --clear-marks          Empty marked.json and exit (stop the watcher first)
  --wav <path>           WAV file to loop for the alarm
  --force-volume         Set system volume to 100% and unmute on start
  --no-force-volume      Do not touch system volume (default)
  --help                 Show this help`);
  process.exit(0);
}

if (OPT.clearMarks) {
  const current = loadMarked();
  const count = current.size;
  fs.writeFileSync(MARKED_FILE, JSON.stringify({}, null, 2), 'utf8');
  console.log(count === 0 ? 'marked.json was already empty' : `cleared ${count} marked QR(s)`);
  console.log('(run this while the watcher is stopped; restart it to reload the empty list)');
  process.exit(0);
}

function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadMarked() {
  try {
    const raw = fs.readFileSync(MARKED_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return new Map(Object.entries(parsed));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn: could not read marked.json:', err.message);
    return new Map();
  }
}

let marked = loadMarked();

const lastSeen = new Map();
const now0 = Date.now();
if (OPT.rearmAfterMs > 0) {
  for (const hash of marked.keys()) lastSeen.set(hash, now0);
}

function saveMarked() {
  const obj = Object.fromEntries(marked);
  fs.writeFileSync(MARKED_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function reapMarks(now) {
  if (OPT.rearmAfterMs <= 0) return;
  let changed = false;
  for (const hash of [...marked.keys()]) {
    const seen = lastSeen.get(hash);
    if (seen === undefined || now - seen > OPT.rearmAfterMs) {
      marked.delete(hash);
      lastSeen.delete(hash);
      log('re-armed (off-screen >', OPT.rearmAfterMs / 1000, 's):', hash.slice(0, 12));
      changed = true;
    }
  }
  if (changed) saveMarked();
}

let alarmProc = null;
let detecting = new Set();

function startAlarm() {
  if (alarmProc) return;
  log('ALARM: starting loud sound loop');
  const proc = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ALARM_SCRIPT, OPT.wav],
    { stdio: 'ignore', windowsHide: true }
  );
  alarmProc = proc;
  proc.on('exit', () => {
    if (alarmProc === proc) alarmProc = null;
  });
  proc.on('error', (err) => {
    log('error: failed to start alarm:', err.message);
    if (alarmProc === proc) alarmProc = null;
  });
}

function stopAlarm() {
  if (!alarmProc) return;
  const proc = alarmProc;
  alarmProc = null;
  log('ALARM: stopping');
  try {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (_) {
    try { proc.kill('SIGKILL'); } catch (_) {}
  }
}

function markDetected() {
  if (detecting.size === 0) {
    log('nothing to mark');
    return;
  }
  const now = new Date().toISOString();
  for (const { hash, data } of detecting) {
    lastSeen.set(hash, Date.now());
    if (marked.has(hash)) continue;
    marked.set(hash, { data: data.slice(0, 200), markedAt: now });
    log(OPT.rearmAfterMs > 0 ? 'MARKED (temporary):' : 'MARKED (permanent):', hash.slice(0, 12), JSON.stringify(data.slice(0, 80)));
  }
  saveMarked();
  stopAlarm();
}

const FULL_FRAME_STRATEGIES = [
  { name: 'raw', scale: 1, transform: (img) => img },
  { name: 'gray', scale: 1, transform: (img) => img.greyscale().normalize() },
  { name: 'gray2x', scale: 2, transform: (img) => img.greyscale().normalize().scale(2) },
  { name: 'contrast2x', scale: 2, transform: (img) => img.greyscale().contrast(0.35).normalize().scale(2) },
];

const MAX_QR_PER_FRAME = 10;

function runJsQR(img) {
  const { data, width, height } = img.bitmap;
  try {
    return jsQR(new Uint8ClampedArray(data), width, height, {
      inversionAttempts: 'attemptBoth',
    });
  } catch (err) {
    log('warn: jsQR failed:', err.message);
    return null;
  }
}

function maskRegion(img, result, scale) {
  const loc = result.location;
  if (!loc) return false;
  const inv = 1 / scale;
  const corners = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
  const xs = corners.map((c) => c.x * inv);
  const ys = corners.map((c) => c.y * inv);
  const pad = 0.08;
  const minX = Math.max(0, Math.floor(Math.min(...xs) - (Math.max(...xs) - Math.min(...xs)) * pad));
  const minY = Math.max(0, Math.floor(Math.min(...ys) - (Math.max(...ys) - Math.min(...ys)) * pad));
  const maxX = Math.min(img.bitmap.width, Math.ceil(Math.max(...xs) + (Math.max(...xs) - Math.min(...xs)) * pad));
  const maxY = Math.min(img.bitmap.height, Math.ceil(Math.max(...ys) + (Math.max(...ys) - Math.min(...ys)) * pad));
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return false;
  img.scan(minX, minY, w, h, function (px, py, idx) {
    this.bitmap.data[idx] = 255;
    this.bitmap.data[idx + 1] = 255;
    this.bitmap.data[idx + 2] = 255;
    this.bitmap.data[idx + 3] = 255;
  });
  return true;
}

async function decodeQRs(png) {
  let base;
  try {
    base = await Jimp.read(png);
  } catch (err) {
    log('warn: image decode failed:', err.message);
    return [];
  }

  const payloads = new Set();

  for (let i = 0; i < MAX_QR_PER_FRAME; i++) {
    let hit = null;
    for (const strategy of FULL_FRAME_STRATEGIES) {
      const result = runJsQR(strategy.transform(base.clone()));
      if (result && result.data) {
        hit = { result, strategy };
        break;
      }
    }
    if (!hit) break;

    const { result, strategy } = hit;
    if (!payloads.has(result.data)) {
      log(`  found via ${strategy.name}: ${JSON.stringify(result.data.slice(0, 80))}`);
      payloads.add(result.data);
    }
    if (!maskRegion(base, result, strategy.scale)) break;
  }

  return [...payloads];
}

async function captureTargets() {
  if (OPT.screen) return [OPT.screen];
  if (!OPT.allScreens) return [undefined];
  try {
    const list = await screenshot.listDisplays();
    return list.map((d) => d.id);
  } catch (err) {
    log('warn: could not list displays, falling back to primary:', err.message);
    return [undefined];
  }
}

async function scanOnce() {
  const targets = await captureTargets();
  const found = new Map();
  let captured = 0;

  for (const target of targets) {
    let png;
    try {
      png = await screenshot({ format: 'png', screen: target });
    } catch (err) {
      log('warn: screenshot failed for', target || 'primary', '-', err.message);
      continue;
    }
    captured++;
    const payloads = await decodeQRs(png);
    for (const data of payloads) {
      const hash = sha256(data);
      if (found.has(hash)) continue;
      found.set(hash, { hash, data });
      log('scan: QR on', target || 'primary', '->', hash.slice(0, 12), JSON.stringify(data.slice(0, 80)));
    }
  }

  if (captured === 0) {
    log('scan: capture failed, keeping current state');
    return;
  }

  const nowMs = Date.now();
  for (const hash of found.keys()) lastSeen.set(hash, nowMs);
  reapMarks(nowMs);

  if (found.size === 0) {
    detecting = new Set();
    if (alarmProc) stopAlarm();
    log('scan: no QR');
    return;
  }

  const unmarked = [...found.values()].filter((q) => !marked.has(q.hash));
  detecting = new Set(unmarked);

  if (unmarked.length === 0) {
    const rearm = OPT.rearmAfterMs > 0 ? ` (re-arms ${OPT.rearmAfterMs / 1000}s after it leaves screen)` : '';
    log(`scan: ${found.size} QR found, all MARKED, ignoring${rearm}`);
    stopAlarm();
    return;
  }

  log(`scan: ${unmarked.length} UNMARKED QR -> alarm`);
  startAlarm();
}

async function loop() {
  await scanOnce();
  setTimeout(loop, OPT.intervalMs);
}

function setupKeypress() {
  if (!process.stdin.isTTY) {
    log('warn: stdin is not a TTY; press-key acknowledge disabled. Run in a real console window.');
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (chunk) => {
    const s = chunk.toString('utf8');
    if (s === '\u0003') {
      log('Ctrl+C received, exiting');
      shutdown();
      return;
    }
    markDetected();
  });
}

function shutdown() {
  stopAlarm();
  try { saveMarked(); } catch (_) {}
  try { process.stdin.setRawMode(false); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', stopAlarm);

function main() {
  if (OPT.listScreens) {
    screenshot
      .listDisplays()
      .then((list) => {
        for (const d of list) console.log(`${d.id}  ${d.width}x${d.height}`);
      })
      .catch((err) => {
        console.error('failed to list displays:', err.message);
        process.exit(1);
      });
    return;
  }

  log('QR watcher starting');
  const scope = OPT.allScreens ? 'all-screens' : OPT.screen || 'primary';
  const rearm = OPT.rearmAfterMs > 0 ? `${OPT.rearmAfterMs / 1000}s` : 'permanent';
  log(`interval=${OPT.intervalMs / 1000}s scope=${scope} marked=${marked.size} rearm=${rearm} wav=${OPT.wav}`);

  if (OPT.forceVolume) {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VOLUME_SCRIPT],
      { encoding: 'utf8' }
    );
    if (r.status === 0) log('system volume forced to 100%');
    else log('warn: could not force volume:', (r.stderr || '').trim());
  }

  log('Press ANY KEY to acknowledge the current QR (stop alarm + ignore it forever). Ctrl+C to quit.');
  setupKeypress();
  loop();
}

if (require.main === module) {
  main();
}

module.exports = { decodeQRs, scanOnce, main };
