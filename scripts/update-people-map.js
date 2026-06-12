#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(ROOT, 'data', 'people_teams.json');
const targetPath = join(ROOT, 'cloudflare', 'lib', 'people-map.js');

const mapping = JSON.parse(await readFile(sourcePath, 'utf8'));
const output = `const PEOPLE_MAP = ${JSON.stringify(mapping, null, 2)};\n\nexport { PEOPLE_MAP };\n`;

await writeFile(targetPath, output, 'utf8');
console.log('Updated cloudflare/lib/people-map.js from data/people_teams.json.');
