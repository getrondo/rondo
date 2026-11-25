import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@effect/vitest';

const root = path.join(import.meta.dirname, '../../..');
const matrix = readFileSync(path.join(root, 'docs/testing/bot-flows.md'), 'utf8');
const sources = ['packages', 'apps']
    .flatMap(folder =>
        readdirSync(path.join(root, folder), { recursive: true, encoding: 'utf8' }).map(file => path.join(root, folder, file))
    )
    .filter(file => file.endsWith('.test.ts') && !file.includes('node_modules'))
    .map(file => readFileSync(file, 'utf8'))
    .join('\n');
const testNames = new Set([...sources.matchAll(/\bit(?:\.effect)?(?:\.skipIf\([^)]*\))?\(\s*'([^']+)'/gu)].map(match => match[1]));
const rows = matrix
    .split('\n')
    .filter(line => /^\|\s*\d+\s*\|/u.test(line))
    .map(line => line.split('|').map(cell => cell.trim()));

describe('the flow matrix', () => {
    it('names an existing test for every flow that is not planned', () => {
        const named = rows.map(cells => ({ flow: cells[3] ?? '', test: (cells[9] ?? '').replaceAll('`', '') }));
        const missing = named.filter(row => !row.test.startsWith('planned') && !testNames.has(row.test));

        expect(rows.length).toBeGreaterThan(80);
        expect(missing).toEqual([]);
    });
});
