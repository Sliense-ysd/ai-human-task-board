#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const taskModalFiles = [
  'src/components/Kanban/TaskDialog.tsx',
  'src/components/Kanban/TaskDetailDialog.tsx',
];

const failures = [];

for (const file of taskModalFiles) {
  const absolutePath = resolve(repoRoot, file);
  const source = readFileSync(absolutePath, 'utf8');

  const backdropWithClose = /<div\s+className="fixed inset-0[^"]*"[^>]*onClick=\{onClose\}/s;
  if (backdropWithClose.test(source)) {
    failures.push(`${file}: task modal backdrop must not call onClose`);
  }

  if (!source.includes('<button onClick={onClose}')) {
    failures.push(`${file}: expected at least one explicit close button`);
  }
}

if (failures.length) {
  console.error('Task modal dismissal policy failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Task modal dismissal policy passed for ${taskModalFiles.map(file => relative(repoRoot, resolve(repoRoot, file))).join(', ')}`);
