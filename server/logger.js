/**
 * Structured logger — writes JSON lines to <workspace>/logs/storyboarder.jsonl
 * and mirrors a human-friendly version to stdout.
 *
 * All backend code should route events through here instead of console.*
 * so we have a single tail-able stream locally and in prod.
 */

import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getWorkspace } from './fs-storage.js';

let logFilePromise = null;

async function ensureLogFile() {
  if (logFilePromise) return logFilePromise;
  logFilePromise = (async () => {
    const dir = join(getWorkspace(), 'logs');
    await mkdir(dir, { recursive: true });
    return join(dir, 'storyboarder.jsonl');
  })();
  return logFilePromise;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    // Handle circular refs / BigInt / Errors
    const seen = new WeakSet();
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  }
}

async function emit(level, event, fields) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = safeStringify(entry) + '\n';

  // Mirror to stdout (compact)
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${level.toUpperCase()}] ${event}`, fields && Object.keys(fields).length ? fields : '');

  try {
    const file = await ensureLogFile();
    await appendFile(file, line, 'utf-8');
  } catch (err) {
    // Never let logging take the process down
    console.error('[logger] failed to write log file:', err?.message || err);
  }
}

export const logger = {
  info: (event, fields = {}) => emit('info', event, fields),
  warn: (event, fields = {}) => emit('warn', event, fields),
  error: (event, fields = {}) => emit('error', event, fields),
};

export async function getLogFilePath() {
  return ensureLogFile();
}
