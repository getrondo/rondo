import * as NodeServices from '@effect/platform-node/NodeServices';
import { expect, layer } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';

import { readPrivateFile } from '../src/approvals/read-private-file';

layer(NodeServices.layer)('private files', it => {
    it.effect('reads only a file outside the repository that nobody else can read', () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const write = Effect.fn('test.write')(function* (name: string, mode: number) {
                yield* fs.writeFileString(`${directory}/${name}`, 'content');
                yield* fs.chmod(`${directory}/${name}`, mode);

                return `${directory}/${name}`;
            });
            const own = yield* write('own', 0o600);
            const open = yield* write('open', 0o644);
            const inside = yield* Effect.flip(readPrivateFile(import.meta.filename));
            const readable = yield* Effect.flip(readPrivateFile(open));

            expect(yield* readPrivateFile(own)).toBe('content');
            expect(inside).toMatchObject({ _tag: 'PrivateFileError', reason: 'the file must be outside the repository' });
            expect(readable).toMatchObject({ _tag: 'PrivateFileError' });
        })
    );
});
