import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';

import { PrivateFileError } from '../error/private-file.error';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const othersModes = 0o100;

export const readPrivateFile = Effect.fn('Approvals.readPrivateFile')(function* (path: string) {
    const fs = yield* FileSystem.FileSystem;
    const realPath = yield* fs.realPath(path);
    const { mode } = yield* fs.stat(realPath);

    if (`${realPath}${sep}`.startsWith(repositoryRoot)) {
        return yield* PrivateFileError.make({ reason: 'the file must be outside the repository' });
    }

    if (mode % othersModes !== 0) {
        return yield* PrivateFileError.make({ reason: 'the file must be readable by its owner only' });
    }

    return yield* fs.readFileString(realPath);
});
