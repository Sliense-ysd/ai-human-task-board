import { exec as execCb } from 'child_process';
import { logActivity } from '../lib/fileStore.js';
import { exec, compareSemver } from '../lib/exec.js';

export async function getOpenclawVersion(req, res) {
  const result = {};
  try {
    result.current = await exec('openclaw --version');
  } catch (e) {
    result.current = null;
    result.currentError = e.message;
  }
  try {
    result.latest = await exec('npm view openclaw version');
  } catch (e) {
    result.latest = null;
    result.latestError = e.message;
  }
  if (result.current && result.latest) {
    result.outdated = compareSemver(result.current, result.latest) < 0;
  } else {
    result.outdated = null;
  }
  res.json(result);
}

export async function updateOpenclaw(req, res) {
  try {
    await exec('npm install -g openclaw@latest');
    const version = await exec('openclaw --version');
    execCb('openclaw gateway restart', (err) => {
      if (err) console.error('Failed to restart openclaw after update:', err.message);
    });
    logActivity('dashboard', 'openclaw_updated', { version });
    res.json({ success: true, version });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
