import { describe, expect, it } from '@effect/vitest';
import { extractLineup } from '@rondo/core/extract/extract-lineup';
import { makeVenueMatcher } from '@rondo/core/extract/extract-poll';
import * as Effect from 'effect/Effect';

import { parseJsonExport } from '../src/parse/parse-json-export';

import { message, testConfig } from './fixture';

const json = JSON.stringify({
    name: 'Test',
    messages: [
        { id: 1, type: 'message', date_unixtime: '1685643792', from: 'Org', from_id: 'user42', text: 'Привет' },
        {
            id: 2,
            type: 'message',
            date_unixtime: '1685643800',
            from: null,
            from_id: 'channel7',
            text: ['Да, ', { type: 'mention_name', text: 'Иван', user_id: 99 }, ' и ', { type: 'mention', text: '@oleg' }]
        },
        {
            id: 3,
            type: 'message',
            date_unixtime: '1685643900',
            from: 'Org',
            from_id: 'user42',
            forwarded_from: 'Org',
            text: '',
            poll: { question: ['Игра ', { type: 'bold', text: 'завтра' }], answers: [{ text: '+', voters: 12, chosen: false }] }
        },
        { id: 4, type: 'service', date_unixtime: '1685644000', actor: 'New', actor_id: 'user5', action: 'join_group_by_link', text: '' },
        { id: 5, type: 'message', date_unixtime: '1685644100', from: 'Org', from_id: 'user42', rich_message: { blocks: [] } }
    ]
});

describe('Telegram JSON export parsing', () => {
    it.effect('keeps author ids, mentions with positions, polls and service messages', () =>
        Effect.gen(function* () {
            const [first, second, poll, service, rich] = yield* parseJsonExport(json);

            expect(first).toMatchObject({ author: 'Org', authorId: 42, text: 'Привет' });
            expect(first?.sentAt?.toISOString()).toBe('2023-06-01T18:23:12.000Z');
            expect(second?.authorId).toBeUndefined();
            expect(second).toMatchObject({
                text: 'Да, Иван и @oleg',
                mentions: [
                    { offset: 4, text: 'Иван', userId: 99 },
                    { offset: 11, text: '@oleg' }
                ]
            });
            expect(poll).toMatchObject({ forwardedFrom: 'Org', poll: { question: 'Игра завтра', answers: ['+'], voters: [12] } });
            expect(rich?.text).toBe('');
            expect(service?.kind).toBe('service');
        })
    );

    it('reads the playing person and their guests from composite names', () => {
        const lineup = extractLineup(
            message(1, '2025-05-05T15:00:00Z', 'Составы:\n🟢Иван без Олега, Пётр +1\n🔵Семён+2, Павел, +3, Олег'),
            testConfig,
            makeVenueMatcher(testConfig)
        );

        expect(lineup?.teams.map(team => team.members.map(member => member.aliasNorm))).toEqual([
            ['иван', 'петр'],
            ['семен', 'павел', 'олег']
        ]);
        expect(lineup?.teams.map(team => team.members.map(member => member.guests))).toEqual([
            [0, 1],
            [2, 3, 0]
        ]);
    });

    it('reads the mentioned user id at its token', () => {
        const text = 'Составы на сегодня:\n🟢Саша, Саша, @striker\n🔵Олег, Семён';
        const second = text.indexOf('Саша', text.indexOf('Саша') + 1);
        const lineup = extractLineup(
            message(1, '2025-05-05T15:00:00Z', text, { mentions: [{ offset: second, text: 'Саша', userId: 42 }] }),
            testConfig,
            makeVenueMatcher(testConfig)
        );

        expect(lineup?.teams[0]?.members.map(({ raw, userId, handle }) => [raw, userId ?? null, handle ?? null])).toEqual([
            ['Саша', null, null],
            ['Саша', 42, null],
            ['@striker', null, 'striker']
        ]);
    });
});
