import fs from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

export const createVitestConfig = (root: string, setupFiles: string[] = []) => {
    const { name } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string };

    return defineConfig({
        resolve: {
            alias: {
                [name]: path.join(root, 'src')
            }
        },
        test: { name: name.replace('@rondo/', ''), include: ['test/**/*.test.ts'], setupFiles, testTimeout: 60_000 }
    });
};
