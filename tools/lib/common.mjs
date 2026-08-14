import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const ARTIFACTS = path.join(ROOT, 'artifacts');

export const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  url: process.env.COD_URL || 'http://127.0.0.1:5173',
  width: envNumber('COD_WIDTH', 1280),
  height: envNumber('COD_HEIGHT', 720),
  dpr: envNumber('COD_DPR', 1),
  seed: envNumber('COD_SEED', 1337),
  settleFrames: envNumber('COD_SETTLE_FRAMES', 90),
  timeoutMs: envNumber('COD_TIMEOUT_MS', 30000),
};

export const canonicalShots = [
  'overview',
  'street',
  'interior',
  'weapon_hip',
  'weapon_ads',
  'combat',
  'enemy',
  'material_close',
  'lighting',
  'fx',
  'hud',
];

export function sourceIdentity() {
  const files = [];
  const collect = (target) => {
    const absolute = path.join(ROOT, target);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) collect(path.join(target, entry));
    } else {
      files.push(target);
    }
  };
  for (const target of ['src', 'tools', 'scripts', 'index.html', 'package.json', 'package-lock.json', 'vite.config.js']) collect(target);
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(ROOT, file)));
    hash.update('\0');
  }
  return { algorithm: 'sha256', digest: hash.digest('hex'), files: files.length };
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) {
    return { count: 0, p50: null, p95: null, p99: null, worst: null };
  }
  return {
    count: clean.length,
    p50: percentile(clean, 0.50),
    p95: percentile(clean, 0.95),
    p99: percentile(clean, 0.99),
    worst: clean[clean.length - 1],
  };
}

export async function waitForUrl(url, timeoutMs = config.timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function withDevServer(fn) {
  let child = null;
  let ownServer = false;

  try {
    try {
      await waitForUrl(config.url, 600);
    } catch {
      ownServer = true;
      child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      child.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
      child.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
      await waitForUrl(config.url, config.timeoutMs);
    }
    return await fn();
  } finally {
    if (ownServer && child && !child.killed) {
      child.kill('SIGTERM');
    }
  }
}

export async function launchBrowser({ headless = true } = {}) {
  return chromium.launch({
    headless,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=metal',
    ],
  });
}

export async function newHarnessPage(browser, {
  shot = 'overview',
  scenario = 'default',
  seed = config.seed,
} = {}) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.dpr,
  });

  const page = await context.newPage();
  const errors = [];

  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  const url = new URL(config.url);
  url.searchParams.set('harness', '1');
  url.searchParams.set('seed', String(seed));
  url.searchParams.set('scenario', scenario);
  url.searchParams.set('shot', shot);

  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });

  await page.waitForFunction(
    () => window.__COD_HARNESS__?.version === 2 && window.__COD_HARNESS__?.ready === true,
    null,
    { timeout: config.timeoutMs },
  );

  return { page, context, errors };
}

export async function settle(page, frames = config.settleFrames) {
  await page.evaluate(async (count) => {
    await window.__COD_HARNESS__.stepFrames(count);
  }, frames);
}

export function assertNoBrowserErrors(errors) {
  if (errors.length) {
    throw new Error(`Browser errors:\n${errors.map((x) => `- ${x}`).join('\n')}`);
  }
}
