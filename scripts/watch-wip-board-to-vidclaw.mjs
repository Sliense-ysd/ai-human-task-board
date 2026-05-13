#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncWipBoardToVidClaw } from './wip-vidclaw-sync-lib.mjs';

const boardPath = expandHome(process.env.WIP_BOARD_PATH || '~/ai-shared/AI-Task/WIP-BOARD.md');
const watchDir = path.dirname(boardPath);
const watchName = path.basename(boardPath);

let timer = null;
let running = false;
let rerunRequested = false;

function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

function log(message) {
  console.log(`[vidclaw-watch] ${message}`);
}

async function runSync(reason) {
  if (running) {
    rerunRequested = true;
    return;
  }

  running = true;
  try {
    const summary = await syncWipBoardToVidClaw({ boardPath });
    log(`${reason}: synced ${summary.totalBoardItems} items | created=${summary.created} updated=${summary.updated} archived=${summary.archived} unchanged=${summary.unchanged}`);
  } catch (error) {
    log(`${reason}: ${error.message}`);
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleSync('rerun');
    }
  }
}

function scheduleSync(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runSync(reason);
  }, 1200);
}

if (!fs.existsSync(watchDir)) {
  log(`watch directory missing: ${watchDir}`);
  process.exit(1);
}

scheduleSync('startup');
log(`watching ${boardPath}`);

fs.watch(watchDir, (_eventType, filename) => {
  if (!filename) return;
  if (String(filename) !== watchName) return;
  scheduleSync('file-change');
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
