import fs from 'fs';
import { exec as execCb } from 'child_process';
import { OPENCLAW_JSON } from '../config.js';
import { logActivity, readSettings, writeSettings } from '../lib/fileStore.js';
import { broadcast } from '../broadcast.js';

export function getSettings(req, res) {
  try {
    const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, 'utf-8'));
    const heartbeatEvery = config?.agents?.defaults?.heartbeat?.every || '30m';
    const settings = readSettings();
    const timezone = settings.timezone || 'UTC';
    const maxConcurrent = settings.maxConcurrent || 1;
    const defaultFilePath = settings.defaultFilePath || 'content';
    res.json({ heartbeatEvery, timezone, maxConcurrent, defaultFilePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function postSettings(req, res) {
  try {
    const { heartbeatEvery, timezone, maxConcurrent, defaultFilePath } = req.body;

    const allowedHeartbeats = ['5m', '10m', '15m', '30m', '1h'];
    if (heartbeatEvery && !allowedHeartbeats.includes(heartbeatEvery)) {
      return res.status(400).json({ error: 'Invalid heartbeat value' });
    }

    if (timezone) {
      const valid = Intl.supportedValuesOf('timeZone');
      if (timezone !== 'UTC' && !valid.includes(timezone)) {
        return res.status(400).json({ error: 'Invalid timezone' });
      }
    }

    if (maxConcurrent !== undefined) {
      const val = parseInt(maxConcurrent, 10);
      if (!Number.isInteger(val) || val < 1 || val > 8) {
        return res.status(400).json({ error: 'maxConcurrent must be an integer between 1 and 8' });
      }
    }

    // Only heartbeat goes into openclaw.json
    let heartbeatChanged = false;
    if (heartbeatEvery) {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, 'utf-8'));
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      heartbeatChanged = heartbeatEvery !== config.agents.defaults.heartbeat?.every;
      if (heartbeatChanged) {
        if (!config.agents.defaults.heartbeat) config.agents.defaults.heartbeat = {};
        config.agents.defaults.heartbeat.every = heartbeatEvery;
        fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2));
      }
    }

    // Validate defaultFilePath (no path traversal)
    if (defaultFilePath !== undefined) {
      if (typeof defaultFilePath !== 'string' || defaultFilePath.includes('..')) {
        return res.status(400).json({ error: 'Invalid defaultFilePath' });
      }
    }

    // timezone, maxConcurrent, defaultFilePath go into VidClaw's own settings file
    const settings = readSettings();
    if (timezone) settings.timezone = timezone;
    if (maxConcurrent !== undefined) settings.maxConcurrent = parseInt(maxConcurrent, 10);
    if (defaultFilePath !== undefined) settings.defaultFilePath = defaultFilePath;
    writeSettings(settings);

    const details = {};
    if (heartbeatEvery) details.heartbeatEvery = heartbeatEvery;
    if (timezone) details.timezone = timezone;
    if (maxConcurrent !== undefined) details.maxConcurrent = parseInt(maxConcurrent, 10);
    if (defaultFilePath !== undefined) details.defaultFilePath = defaultFilePath;
    logActivity('dashboard', 'settings_updated', details);

    broadcast('settings', {
      heartbeatEvery: heartbeatEvery || undefined,
      timezone: settings.timezone || 'UTC',
      maxConcurrent: settings.maxConcurrent || 1,
      defaultFilePath: settings.defaultFilePath || 'content',
    });

    if (heartbeatChanged) {
      execCb('openclaw gateway restart', (err) => {
        if (err) console.error('Failed to restart openclaw:', err.message);
      });
    }

    res.json({ ok: true, restarted: !!heartbeatChanged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
