import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://ai-board.31.97.143.166.sslip.io';
const DEFAULT_WIP_BOARD_PATH = '~/ai-shared/AI-Task/WIP-BOARD.md';
const DEFAULT_SECRET_PATH = '~/ai-shared/secrets/ai-human-task-board.md';
const DEFAULT_STATE_PATH = '~/ai-shared/AI-Task/.vidclaw-sync-state.json';

function expandHome(input) {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

function normalizeBaseUrl(input) {
  return (input || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function normalizeText(input) {
  return String(input || '').trim();
}

function extractEnvVar(markdown, key) {
  const blockMatch = markdown.match(/```env([\s\S]*?)```/);
  if (!blockMatch) return '';
  const lines = blockMatch[1].split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*${key}="?(.*?)"?\\s*$`));
    if (match) return match[1];
  }
  return '';
}

async function readVidClawSecrets(secretPath) {
  const raw = await fs.readFile(secretPath, 'utf8');
  const username = extractEnvVar(raw, 'VIDCLAW_AUTH_USER');
  const password = extractEnvVar(raw, 'VIDCLAW_AUTH_PASSWORD');
  if (!username || !password) {
    throw new Error(`Missing VidClaw credentials in ${secretPath}`);
  }
  return { username, password };
}

function getActiveSection(markdown) {
  const activeMatch = markdown.match(/^## Active\s*$/m);
  if (!activeMatch) return '';
  const start = activeMatch.index + activeMatch[0].length;
  const rest = markdown.slice(start);
  const nextSection = rest.search(/^##\s+/m);
  return nextSection >= 0 ? rest.slice(0, nextSection) : rest;
}

function normalizeFieldKey(label) {
  return normalizeText(label).toLowerCase();
}

function parseToolSkills(rawTool) {
  const skills = [];
  for (const match of rawTool.matchAll(/`([^`]+)`/g)) {
    skills.push(match[1]);
  }
  return [...new Set(skills)];
}

function parseWipBoard(markdown) {
  const section = getActiveSection(markdown);
  if (!section) return [];
  const chunks = section.split(/^### /m).slice(1);
  const items = [];

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    const header = normalizeText(lines.shift());
    const headerMatch = header.match(/^(WIP-\d{8}-\d+)\s+[—-]\s+(.+)$/);
    if (!headerMatch) continue;

    const item = {
      id: headerMatch[1],
      title: headerMatch[2].trim(),
      statusRaw: '',
      priorityRaw: '',
      toolRaw: '',
      projectRaw: '',
      goal: [],
      progress: [],
      notes: [],
    };

    let currentSection = '';

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      const fieldMatch = trimmed.match(/^- \*\*(.+?)\*\*:\s*(.*)$/);
      if (fieldMatch) {
        currentSection = normalizeFieldKey(fieldMatch[1]);
        const value = normalizeText(fieldMatch[2]);
        if (currentSection === 'status') item.statusRaw = value;
        else if (currentSection === 'priority') item.priorityRaw = value;
        else if (currentSection === 'tool') item.toolRaw = value;
        else if (currentSection === 'project') item.projectRaw = value;
        else if (['goal', 'progress', 'notes'].includes(currentSection) && value) item[currentSection].push(value);
        continue;
      }

      if (!trimmed.startsWith('- ')) continue;
      const bullet = trimmed.slice(2).trim();
      if (!bullet || !currentSection) continue;
      if (currentSection === 'goal') item.goal.push(bullet);
      else if (currentSection === 'progress') item.progress.push(bullet);
      else if (currentSection === 'notes') item.notes.push(bullet);
    }

    items.push(item);
  }

  return items;
}

function mapPriority(priorityRaw) {
  const normalized = priorityRaw.toUpperCase();
  if (normalized === 'P0' || normalized === 'P1') return 'high';
  if (normalized === 'P3') return 'low';
  return 'medium';
}

function mapStatus(statusRaw) {
  const normalized = statusRaw.toLowerCase();
  if (normalized.includes('abandoned')) return 'archived';
  if (normalized.includes('done')) return 'done';
  if (normalized.includes('verifying') || normalized.includes('executing')) return 'in-progress';
  if (normalized.includes('planned')) return 'todo';
  if (normalized.includes('discussing')) return 'backlog';
  return 'backlog';
}

function buildDescription(item) {
  const blocks = [
    `Source: ${item.id}`,
    item.statusRaw ? `Status: ${item.statusRaw}` : '',
    item.projectRaw ? `Project: ${item.projectRaw}` : '',
    item.toolRaw ? `Tool: ${item.toolRaw}` : '',
  ].filter(Boolean);

  if (item.goal.length) {
    blocks.push(`Goal:\n${item.goal.map((line) => `- ${line}`).join('\n')}`);
  }

  if (item.progress.length) {
    blocks.push(`Progress:\n${item.progress.map((line) => `- ${line}`).join('\n')}`);
  }

  if (item.notes.length) {
    blocks.push(`Notes:\n${item.notes.map((line) => `- ${line}`).join('\n')}`);
  }

  return blocks.join('\n\n');
}

function toManagedTask(item) {
  return {
    title: item.title,
    description: buildDescription(item),
    priority: mapPriority(item.priorityRaw),
    status: mapStatus(item.statusRaw),
    skill: '',
    skills: parseToolSkills(item.toolRaw),
    source: item.id,
    sourceMessageId: null,
  };
}

function comparableTask(task) {
  return {
    title: normalizeText(task.title),
    description: normalizeText(task.description),
    priority: normalizeText(task.priority),
    status: normalizeText(task.status),
    skill: normalizeText(task.skill),
    skills: Array.isArray(task.skills) ? [...task.skills].sort() : [],
    source: normalizeText(task.source),
    sourceMessageId: task.sourceMessageId || null,
  };
}

function isManagedSource(source) {
  return /^WIP-\d{8}-\d+$/.test(String(source || '').trim());
}

async function vidClawRequest(config, requestPath, options = {}) {
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const response = await fetch(`${config.baseUrl}${requestPath}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`VidClaw ${options.method || 'GET'} ${requestPath} failed: ${response.status} ${text}`.trim());
  }

  return response.json();
}

async function loadState(statePath) {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch {
    return { lastSyncAt: null, summary: null };
  }
}

async function saveState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function syncWipBoardToVidClaw(options = {}) {
  const boardPath = expandHome(options.boardPath || process.env.WIP_BOARD_PATH || DEFAULT_WIP_BOARD_PATH);
  const secretPath = expandHome(options.secretPath || process.env.VIDCLAW_SECRET_PATH || DEFAULT_SECRET_PATH);
  const statePath = expandHome(options.statePath || process.env.VIDCLAW_SYNC_STATE_PATH || DEFAULT_STATE_PATH);
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.VIDCLAW_BASE_URL || DEFAULT_BASE_URL);

  const markdown = await fs.readFile(boardPath, 'utf8');
  const parsedItems = parseWipBoard(markdown);
  const desiredTasks = parsedItems.map(toManagedTask);

  const credentials = await readVidClawSecrets(secretPath);
  const config = { ...credentials, baseUrl };
  const remoteTasks = await vidClawRequest(config, '/api/tasks?includeArchived=true');
  const remoteBySource = new Map(
    remoteTasks
      .filter((task) => isManagedSource(task.source))
      .map((task) => [task.source, task]),
  );

  let created = 0;
  let updated = 0;
  let archived = 0;
  let unchanged = 0;
  const activeSources = new Set();

  for (const desiredTask of desiredTasks) {
    activeSources.add(desiredTask.source);
    const existing = remoteBySource.get(desiredTask.source);
    if (!existing) {
      await vidClawRequest(config, '/api/tasks', {
        method: 'POST',
        body: JSON.stringify(desiredTask),
      });
      created += 1;
      continue;
    }

    if (JSON.stringify(comparableTask(existing)) === JSON.stringify(comparableTask(desiredTask))) {
      unchanged += 1;
      continue;
    }

    await vidClawRequest(config, `/api/tasks/${encodeURIComponent(existing.id)}`, {
      method: 'PUT',
      body: JSON.stringify(desiredTask),
    });
    updated += 1;
  }

  for (const [source, task] of remoteBySource.entries()) {
    if (activeSources.has(source)) continue;
    if (task.status === 'archived') continue;
    await vidClawRequest(config, `/api/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'archived' }),
    });
    archived += 1;
  }

  const summary = {
    boardPath,
    baseUrl,
    totalBoardItems: desiredTasks.length,
    created,
    updated,
    archived,
    unchanged,
  };

  const previousState = await loadState(statePath);
  await saveState(statePath, {
    ...previousState,
    lastSyncAt: new Date().toISOString(),
    summary,
  });

  return summary;
}
