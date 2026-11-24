// eslint-disable-next-line import/no-unassigned-import -- server-only sentinel
import 'server-only';
import { timingSafeEqual } from 'node:crypto';

import { isDefined, isNotEmptyString } from '@rnw-community/shared';

export const hasBearerSecret = (header: string | null, secret: string | undefined): boolean => {
    if (!isDefined(header) || !isNotEmptyString(secret)) {
        return false;
    }

    const received = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${secret}`);

    return received.length === expected.length && timingSafeEqual(received, expected);
};
