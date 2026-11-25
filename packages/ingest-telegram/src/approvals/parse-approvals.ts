import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { nicknameOf } from '../extract/extract-lineup';

import type { CommunityConfig } from '../config/community-config';

const RowSchema = Schema.Struct({
    raw: Schema.NonEmptyString,
    tgUserId: Schema.BigIntFromString.check(Schema.isGreaterThanBigInt(0n)),
    messageId: Schema.FiniteFromString,
    date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
    chatId: Schema.optional(Schema.NumberFromString.check(Schema.isInt()))
});

export interface ApprovalRow {
    readonly nickname: string;
    readonly aliasNorm: string;
    readonly tgUserId: bigint;
    readonly messageId: number;
    readonly date: string;
    readonly chatId?: number;
}

const decodeRow = Schema.decodeUnknownEffect(RowSchema);

export const parseApprovals = Effect.fn('Approvals.parseApprovals')(function* (file: string, config: CommunityConfig) {
    const rows = yield* Effect.all(
        file
            .split('\n')
            .filter(line => isNotEmptyString(line.trim()))
            .map(line => {
                const [raw, tgUserId, messageId, date, chatId] = line.split('|').map(part => part.trim());

                return decodeRow({ raw, tgUserId, messageId, date, ...(isDefined(chatId) ? { chatId } : {}) });
            })
    );

    return rows.map(({ raw, ...row }): ApprovalRow => Object.assign(row, nicknameOf(raw, config)));
});
