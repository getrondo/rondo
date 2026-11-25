import fs from 'node:fs';
import path from 'node:path';

import * as Schema from 'effect/Schema';
import { defineConfig } from 'vitest/config';

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ name: Schema.String })));

export const createVitestConfig = (root: string, setupFiles: string[] = []) => {
    const { name } = decodeManifest(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    return defineConfig({
        resolve: {
            alias: {
                [name]: path.join(root, 'src')
            }
        },
        test: { name: name.replace('@rondo/', ''), include: ['test/**/*.test.ts'], setupFiles, testTimeout: 60_000 }
    });
};
