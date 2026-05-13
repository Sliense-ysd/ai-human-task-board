#!/usr/bin/env node

import { syncWipBoardToVidClaw } from './wip-vidclaw-sync-lib.mjs';

try {
  const summary = await syncWipBoardToVidClaw();
  console.log(`[vidclaw-sync] synced ${summary.totalBoardItems} WIP items | created=${summary.created} updated=${summary.updated} archived=${summary.archived} unchanged=${summary.unchanged}`);
} catch (error) {
  console.error(`[vidclaw-sync] ${error.message}`);
  process.exitCode = 1;
}
