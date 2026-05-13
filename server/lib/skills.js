import fs from 'fs';
import path from 'path';
import { SKILL_SCAN_DIRS } from '../config.js';
import { readOpenclawJson } from './fileStore.js';

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w\s]*?):\s*(.+)$/);
    if (m) fm[m[1].trim().toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

export function scanSkills() {
  const config = readOpenclawJson();
  const entries = config.skills?.entries || {};
  const skills = [];
  const seenPaths = new Set();

  for (const [source, roots] of Object.entries(SKILL_SCAN_DIRS)) {
    const rootList = Array.isArray(roots) ? roots : [roots];
    for (const rootDir of rootList) {
      try {
        const dirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const d of dirs) {
          const skillPath = path.join(rootDir, d.name);
          if (seenPaths.has(skillPath)) continue;
          seenPaths.add(skillPath);

          const mdPath = path.join(skillPath, 'SKILL.md');
          let fm = {}, hasMetadata = false;
          try {
            const content = fs.readFileSync(mdPath, 'utf-8');
            fm = parseFrontmatter(content);
            hasMetadata = Object.keys(fm).length > 0;
          } catch {}
          const id = d.name;
          const entry = entries[id];
          skills.push({
            id,
            name: fm.name || d.name,
            description: fm.description || '',
            source,
            enabled: entry?.enabled !== undefined ? entry.enabled : true,
            path: skillPath,
            hasMetadata,
          });
        }
      } catch {}
    }
  }
  return skills;
}
