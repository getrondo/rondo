import { describe, expect, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';

import { extractLineup } from '../src/extract/extract-lineup';
import { makeVenueMatcher } from '../src/extract/extract-poll';
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

    it('reads the playing person from composite names', () => {
        const lineup = extractLineup(
            message(1, '2025-05-05T15:00:00Z', 'Составы:\n🟢Иван без Олега, Пётр +1\n🔵Семён+2, Павел'),
            testConfig,
            makeVenueMatcher(testConfig)
        );

        expect(lineup?.teams.map(team => team.members.map(member => member.aliasNorm))).toEqual([
            ['иван', 'петр'],
            ['семен', 'павел']
        ]);
    });
});
