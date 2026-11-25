import 'server-only';
import { timingSafeEqual } from 'node:crypto';

import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import * as Option from 'effect/Option';
import * as Redacted from 'effect/Redacted';

export const hasBearerSecret = (header: string | null, secret: Option.Option<Redacted.Redacted>): boolean => {
    if (!isDefined(header) || Option.isNone(secret) || !isNotEmptyString(Redacted.value(secret.value))) {
        return false;
    }

    const received = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${Redacted.value(secret.value)}`);

    return received.length === expected.length && timingSafeEqual(received, expected);
};
