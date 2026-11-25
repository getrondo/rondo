import { describe, expect, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';

import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { extractOtherChat, mainPollsOf } from '../src/extract/extract-other-chat';
import { resolvePollDate } from '../src/extract/game-date';
import { mergePlans } from '../src/extract/merge-plans';
import { postIdOf, sourceOf } from '../src/extract/post-id';
import { isPublicHoliday } from '../src/extract/public-holiday';
import { parseTelethonExport } from '../src/parse/parse-telethon-export';

import { message, testConfig } from './fixture';

import type { TelegramMessage } from '../src/model/telegram-message.model';

const chat = { chatId: -1001, exportDir: 'second', matchPatterns: ['cup', 'friendly'] };
const config = {
    ...testConfig,
    otherChats: [chat],
    venues: [...testConfig.venues, { key: 'stadium', name: 'Stadium', kind: 'league' as const, patterns: ['stadium'] }]
};
const pollOf = (id: number, sentAt: string, question: string, answers: readonly string[] = ['+', '-']) =>
    message(id, sentAt, '', { text: undefined, poll: { question, answers } });
const squadText = 'Составы на сегодня:\n🟢Я, Иван\n🔵Олег, Семён';

const planOf = (
    mainPosts: readonly TelegramMessage[],
    otherPosts: readonly TelegramMessage[],
    pollIds: Record<string, readonly number[]>
) => {
    const idsOf = (isMain: boolean) =>
        new Map(
            Object.entries(pollIds).flatMap(([pollId, posts]) =>
                posts.filter(post => post < 100 === isMain).map(post => [isMain ? post : postIdOf(1, post), pollId] as const)
            )
        );
    const main = assemblePlan(extractAll(mainPosts, config, { pollIdByMessage: idsOf(true) }), '2025-06-30');
    const other = extractOtherChat(
        otherPosts.map(post => Object.assign(post, { id: postIdOf(1, post.id) })),
        config,
        { chat, pollIdByMessage: idsOf(false), mainPolls: mainPollsOf(idsOf(true), main) }
    );

    return Object.assign(mergePlans(main, assemblePlan(other.facts, '2025-06-30')), { review: other.review });
};

const summaryOf = (plan: ReturnType<typeof planOf>) =>
    plan.sessions.map(({ localDate, status, pollMessageIds, lineup }) => [
        localDate,
        status,
        pollMessageIds.map(id => sourceOf(config.otherChats, id).messageId),
        lineup?.teams.length ?? 0
    ]);

describe('posts of several chats', () => {
    it('keeps equal message ids of different chats apart', () => {
        expect(postIdOf(0, 12)).toBe(12);
        expect(postIdOf(1, 12)).not.toBe(12);
        expect(sourceOf(config.otherChats, postIdOf(1, 12))).toEqual({ chatId: -1001, messageId: 12 });
        expect(sourceOf(config.otherChats, 12)).toEqual({ chatId: null, messageId: 12 });
    });

    it('knows the public holidays of Austria, also the moving ones', () => {
        expect(
            ['2025-05-01', '2025-05-29', '2025-04-21', '2025-06-09', '2025-06-19', '2026-01-06'].every(date => isPublicHoliday(date))
        ).toBe(true);
        expect(['2025-05-28', '2025-04-18', '2025-06-12'].some(date => isPublicHoliday(date))).toBe(false);
    });

    it('takes weekday games of a chat with matches and leaves out matches, friendlies and unclear polls', () => {
        const plan = planOf(
            [],
            [
                pollOf(101, '2025-05-06T08:00:00Z', 'Среда, 19.00 North'),
                pollOf(102, '2025-05-10T08:00:00Z', 'Воскресенье, 12.00 Stadium'),
                pollOf(103, '2025-05-10T09:00:00Z', 'Воскресенье, 15.00 игра без поля'),
                pollOf(104, '2025-05-10T10:00:00Z', 'Воскресенье, 18.00 North'),
                pollOf(105, '2025-05-28T08:00:00Z', 'Четверг, 29 мая, 19.00 North'),
                pollOf(106, '2025-05-13T08:00:00Z', 'Среда, 19.00 North, friendly'),
                pollOf(107, '2025-05-20T08:00:00Z', 'Среда, 19.00 Stadium')
            ],
            {}
        );

        expect(summaryOf(plan)).toEqual([['2025-05-07', 'played', [101], 0]]);
        expect(plan.review.map(({ localDate }) => localDate)).toEqual(['2025-05-11', '2025-05-29']);
        expect(plan.facts.pollPosts.map(({ messageId }) => sourceOf(config.otherChats, messageId).messageId)).toEqual([101]);
    });

    it('never lets a post of one chat change a game of the other', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North'), pollOf(2, '2025-05-12T08:00:00Z', 'Сегодня, 19.00 North')],
            [
                message(101, '2025-05-07T12:00:00Z', 'Отмена футбола сегодня'),
                message(102, '2025-05-12T12:00:00Z', squadText),
                message(103, '2025-05-13T12:00:00Z', squadText),
                pollOf(104, '2025-05-14T08:00:00Z', 'Сегодня, 19.00 North'),
                message(105, '2025-05-14T12:00:00Z', 'Отмена футбола сегодня')
            ],
            {}
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-07', 'played', [1], 0],
            ['2025-05-12', 'played', [2], 0],
            ['2025-05-13', 'played', [], 2],
            ['2025-05-14', 'cancelled', [104], 0]
        ]);
        expect(plan.unattached.map(({ localDate }) => localDate)).toEqual(['2025-05-12']);
    });

    it('makes one game of a forwarded poll and of two polls for one day, and reads the squad of either chat', () => {
        const plan = planOf(
            [
                pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North'),
                pollOf(2, '2025-05-12T08:00:00Z', 'Сегодня, 19.00 North'),
                message(3, '2025-05-12T12:00:00Z', 'Составы на сегодня:\n🟢Я, Марк\n🔵Лев, Юрий\n🔴Глеб, Ян')
            ],
            [
                pollOf(101, '2025-05-08T08:00:00Z', 'Сегодня, 19.00 North'),
                message(102, '2025-05-07T12:00:00Z', squadText),
                pollOf(103, '2025-05-12T09:00:00Z', 'Сегодня, 20.00 Park, 18 мест'),
                message(104, '2025-05-12T13:00:00Z', squadText)
            ],
            { shared: [1, 101] }
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-07', 'played', [1, 101], 2],
            ['2025-05-12', 'played', [2, 103], 3]
        ]);
        expect(plan.sessions[1]).toMatchObject({ localTime: '19:00', venueKey: 'north' });
        expect(plan.facts.pollPosts.map(({ messageId }) => sourceOf(config.otherChats, messageId).messageId)).toEqual([1, 2, 101, 103]);
    });

    it('does not revive a game that the main chat cancelled', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North'), message(2, '2025-05-07T10:00:00Z', 'Отмена футбола сегодня')],
            [pollOf(101, '2025-05-07T09:00:00Z', 'Сегодня, 19.00 North'), message(102, '2025-05-07T12:00:00Z', squadText)],
            {}
        );

        expect(summaryOf(plan)).toEqual([['2025-05-07', 'cancelled', [1, 101], 0]]);
    });

    it('ignores a forward of a poll that the main chat does not take for a game', () => {
        const plan = planOf([pollOf(1, '2025-05-07T08:00:00Z', 'Кто за?')], [pollOf(101, '2025-05-07T09:00:00Z', 'Сегодня, 19.00 North')], {
            shared: [1, 101]
        });

        expect(plan.sessions).toEqual([]);
    });
});

describe('dates of polls', () => {
    it('reads a weekday with a Latin letter, and the weekday when the stated date is months away', () => {
        expect(resolvePollDate('Cреда, 19.00 North', '2025-08-12')).toEqual({ date: '2025-08-13', confidence: 0.8 });
        expect(resolvePollDate('Среда, 15 декабря, 19.00 North', '2025-01-14').date).toBe('2025-01-15');
        expect(resolvePollDate('Среда, 12 марта, 19.00 North', '2025-01-14').date).toBe('2025-03-12');
    });
});

describe('a Telethon export', () => {
    const line = (value: object) => JSON.stringify(value);
    const users = [line([{ id: 7, first: 'Org', last: null, username: 'org', bot: false, deleted: false, member: true }])];

    it('becomes messages, polls and votes', () =>
        Effect.runPromise(
            parseTelethonExport({
                users,
                messages: [
                    line({
                        _: 'Message',
                        id: 5,
                        date: '2025-05-06T08:00:00+00:00',
                        message: '🟢 Ivan hello @seven',
                        from_id: { _: 'PeerUser', user_id: 7 },
                        fwd_from: { _: 'MessageFwdHeader' },
                        reply_to: { reply_to_msg_id: 4 },
                        entities: [
                            { _: 'MessageEntityMentionName', offset: 3, length: 4, user_id: 8 },
                            { _: 'MessageEntityMention', offset: 14, length: 6 },
                            { _: 'MessageEntityBold', offset: 0, length: 2 }
                        ]
                    }),
                    line({ _: 'MessageService', id: 6, date: '2025-05-06T08:30:00+00:00', from_id: { _: 'PeerUser', user_id: 9 } }),
                    '{"_":"Message","id":7,"date":"2025-05-06T09:00:00+00:00","message":"","from_id":{"_":"PeerUser","user_id":7},"fwd_from":null,"reply_to":null,"entities":null,"media":{"_":"MessageMediaPoll","poll":{"_":"Poll","id":5300000000000000123,"question":{"_":"TextWithEntities","text":"Game?"},"answers":[{"text":{"text":"+"},"option":"MA=="},{"text":{"text":"-"},"option":"MQ=="}]}}}'
                ].join('\n'),
                votes: [
                    line({
                        msg: 7,
                        poll: '5300000000000000123',
                        votes: [
                            { peer: 7, options: ['30'], date: '2025-05-06T10:00:00+00:00' },
                            { peer: 8, options: ['31'], date: '2025-05-06T10:00:00+00:00' }
                        ]
                    })
                ]
            }).pipe(
                Effect.tap(({ messages, snapshot }) =>
                    Effect.sync(() => {
                        expect(messages.map(({ id, kind }) => [id, kind])).toEqual([
                            [5, 'message'],
                            [6, 'service'],
                            [7, 'message']
                        ]);
                        expect(messages[0]).toMatchObject({
                            author: 'Org',
                            authorId: 7,
                            replyTo: 4,
                            text: '🟢 Ivan hello @seven',
                            mentions: [
                                { offset: 3, text: 'Ivan', userId: 8 },
                                { offset: 14, text: '@seven' }
                            ]
                        });
                        expect(messages[0]?.forwardedFrom).toBeDefined();
                        expect(messages[2]?.poll).toEqual({ question: 'Game?', answers: ['+', '-'], voters: [1, 1] });
                        expect(snapshot.pollIdByMessage.get(7)).toBe('5300000000000000123');
                        expect(snapshot.votes.map(({ userId, choice }) => [userId, choice])).toEqual([
                            [7, 'yes'],
                            [8, 'no']
                        ]);
                    })
                )
            )
        ));
});
