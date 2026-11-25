import { describe, expect, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { resolvePollDate } from '../src/extract/game-date';
import { numberPosts, planChats } from '../src/extract/plan-other-chats';
import { postIdOf, sourceOf } from '../src/extract/post-id';
import { isPublicHoliday } from '../src/extract/public-holiday';
import { parseTelethonExport } from '../src/parse/parse-telethon-export';

import { message, testConfig } from './fixture';

import type { TelegramMessage } from '../src/model/telegram-message.model';
import type { TelegramSnapshot } from '../src/model/telegram-snapshot.model';

const chat = {
    chatId: -1001,
    exportDir: 'second',
    matchPatterns: ['cup', 'friendly'],
    matchDates: ['2025-06-01', '2025-06-03'],
    ownGameDates: ['2025-05-28']
};
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
    const snapshotOf = (isMain: boolean) =>
        Option.fromNullishOr({ users: new Map(), pollIdByMessage: idsOf(isMain), votes: [] } satisfies TelegramSnapshot);
    const { plan, review } = planChats({
        config,
        main: { messages: mainPosts, snapshot: snapshotOf(true) },
        others: [{ messages: otherPosts.map(post => Object.assign(post, { id: postIdOf(1, post.id) })), snapshot: snapshotOf(false) }],
        asOf: '2025-06-30'
    });

    return { ...plan, review };
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
                pollOf(107, '2025-05-20T08:00:00Z', 'Среда, 19.00 Stadium'),
                message(108, '2025-05-18T12:00:00Z', squadText.replace(':', ', North:')),
                pollOf(109, '2025-06-01T08:00:00Z', 'Сегодня, 18.00 North'),
                pollOf(110, '2025-06-03T08:00:00Z', 'Сегодня, 18.00 North'),
                message(111, '2025-06-03T12:00:00Z', squadText)
            ],
            {}
        );

        expect(summaryOf(plan)).toEqual([['2025-05-07', 'played', [101], 0]]);
        expect(plan.review).toEqual([
            { chatId: -1001, messageId: 104, localDate: '2025-05-11' },
            { chatId: -1001, messageId: 105, localDate: '2025-05-29' },
            { chatId: -1001, messageId: 108, localDate: '2025-05-18' }
        ]);
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
        expect(plan.review).toEqual([{ chatId: -1001, messageId: 102, localDate: '2025-05-12' }]);
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
                pollOf(103, '2025-05-12T09:00:00Z', 'Сегодня, 19.00 Park, 18 мест'),
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

    it('keeps a game of the other chat at another time of the same day, also when its squad is posted', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 20.00 North')],
            [pollOf(101, '2025-05-07T08:00:00Z', 'Сегодня, 18.30 North'), message(102, '2025-05-07T12:00:00Z', squadText)],
            {}
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-07', 'played', [1], 0],
            ['2025-05-07', 'played', [101], 2]
        ]);
        expect(plan.sessions.map(({ localTime }) => localTime)).toEqual(['20:00', '18:30']);
    });

    it('joins a separate poll less than 90 minutes away, or without a stated time on one side', () => {
        const plan = planOf(
            [
                pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 20.00 North'),
                pollOf(2, '2025-05-12T08:00:00Z', 'Сегодня, 19.00 North'),
                pollOf(3, '2025-05-13T08:00:00Z', 'Сегодня North')
            ],
            [
                pollOf(101, '2025-05-07T08:00:00Z', 'Сегодня, 18.45 North'),
                pollOf(102, '2025-05-12T08:00:00Z', 'Сегодня North'),
                pollOf(103, '2025-05-13T08:00:00Z', 'Сегодня, 21.00 North')
            ],
            {}
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-07', 'played', [1, 101], 0],
            ['2025-05-12', 'played', [2, 102], 0],
            ['2025-05-13', 'played', [3, 103], 0]
        ]);
    });

    it('compares with every stated time of the main chat, also of its squad', () => {
        const plan = planOf(
            [
                pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 17.00 North'),
                message(2, '2025-05-07T12:00:00Z', 'Составы, North, 20.00:\n🟢Я, Иван\n🔵Олег, Семён')
            ],
            [pollOf(101, '2025-05-07T08:00:00Z', 'Сегодня, 20.30 North')],
            {}
        );

        expect(summaryOf(plan)).toEqual([['2025-05-07', 'played', [1, 101], 2]]);
    });

    it('splits a game of its own from a forward on the same day, and never puts its squad on the forwarded game', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 20.00 North')],
            [
                pollOf(101, '2025-05-07T08:30:00Z', 'Сегодня, 20.00 North'),
                pollOf(102, '2025-05-07T09:00:00Z', 'Сегодня, 17.00 Park'),
                message(103, '2025-05-07T12:00:00Z', 'Составы на сегодня, 17.00 Park:\n🟢Я, Иван\n🔵Олег, Семён')
            ],
            { shared: [1, 101] }
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-07', 'played', [1, 101], 0],
            ['2025-05-07', 'played', [102], 2]
        ]);
    });

    it('keeps the game of the other chat apart on a day the owner named, whatever the times', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-28T08:00:00Z', 'Сегодня, 20.00 North')],
            [pollOf(101, '2025-05-28T08:00:00Z', 'Сегодня, 19.30 North')],
            {}
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-28', 'played', [1], 0],
            ['2025-05-28', 'played', [101], 0]
        ]);
    });

    it('reads league places, words and owner dates in the header of a squad, not in the notes below it', () => {
        const teams = '\n🟢Я, Иван\n🔵Олег, Семён';
        const plan = planOf(
            [],
            [
                message(101, '2025-05-07T12:00:00Z', `Составы на сегодня, Stadium:${teams}`),
                message(102, '2025-05-08T12:00:00Z', `Составы на сегодня, friendly:${teams}`),
                message(103, '2025-06-03T12:00:00Z', `Составы на сегодня, North:${teams}`),
                message(104, '2025-05-13T12:00:00Z', `Составы на сегодня, North:${teams}`),
                message(105, '2025-05-14T12:00:00Z', `Составы на сегодня, North\n\nA friendly follows on Saturday\n${teams}`),
                message(106, '2025-05-15T12:00:00Z', `Составы на сегодня\nfriendly, North${teams}`)
            ],
            {}
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-13', 'played', [], 2],
            ['2025-05-14', 'played', [], 2]
        ]);
    });

    it('keeps a forward in its game when the main chat corrected the time', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North'), pollOf(2, '2025-05-07T09:00:00Z', 'Сегодня, 20.00 North')],
            [pollOf(101, '2025-05-07T08:30:00Z', 'Сегодня, 19.00 North')],
            { shared: [1, 101] }
        );

        expect(summaryOf(plan)).toEqual([['2025-05-07', 'played', [1, 2, 101], 0]]);
        expect(plan.sessions[0]?.localTime).toBe('20:00');
    });

    it('joins a poll about several days only to a game of its own chat', () => {
        const choice = ['Среда 19.00', 'Четверг 19.00', 'Не буду'];
        const plan = planOf(
            [pollOf(1, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North')],
            [
                pollOf(101, '2025-05-07T09:00:00Z', 'Сегодня, 19.00 North'),
                pollOf(102, '2025-05-05T09:00:00Z', 'Среда или четверг, 19.00, выбираем', choice),
                pollOf(103, '2025-05-12T09:00:00Z', 'Выбираем день для игры', choice),
                pollOf(104, '2025-05-13T09:00:00Z', 'Среда, 19.00 North')
            ],
            { shared: [1, 101] }
        );

        expect(summaryOf(plan)).toEqual([
            ['2025-05-07', 'played', [1, 101], 0],
            ['2025-05-14', 'played', [103, 104], 0]
        ]);
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

describe('posts numbered by chat', () => {
    it('are copies, so the same content can be numbered again', () => {
        const messages = [message(5, '2025-05-07T08:00:00Z', 'a', { replyTo: 4 })];
        const content = {
            messages,
            snapshot: Option.some({ users: new Map(), pollIdByMessage: new Map([[5, 'poll']]), votes: [] } satisfies TelegramSnapshot)
        };
        const once = numberPosts(1, content);
        const again = numberPosts(1, content);

        expect(messages[0]).toMatchObject({ id: 5, replyTo: 4 });
        expect(again).toEqual(once);
        expect([...Option.getOrThrow(again.snapshot).pollIdByMessage.keys()]).toEqual([postIdOf(1, 5)]);
    });
});

describe('a poll first posted in the other chat', () => {
    it('keeps the date of its first post when the main chat forwards it later', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-07T07:00:00Z', 'Завтра, 19.00 North')],
            [pollOf(101, '2025-05-06T08:00:00Z', 'Завтра, 19.00 North')],
            { shared: [1, 101] }
        );

        expect(summaryOf(plan)).toEqual([['2025-05-07', 'played', [1, 101], 0]]);
        expect(plan.facts.polls.map(({ postedAt }) => postedAt)).toEqual([new Date('2025-05-07T07:00:00Z')]);
    });

    it('stays a game of its own next to a main game 90 minutes away, with the copy of the main chat', () => {
        const planAt = (time: string) =>
            summaryOf(
                planOf(
                    [
                        pollOf(1, '2025-05-07T07:00:00Z', 'Сегодня, 19.00 North'),
                        pollOf(2, '2025-05-07T09:00:00Z', `Сегодня, ${time} North`)
                    ],
                    [pollOf(101, '2025-05-07T08:00:00Z', `Сегодня, ${time} North`), message(102, '2025-05-07T12:00:00Z', squadText)],
                    { shared: [2, 101] }
                )
            );

        expect(planAt('21.00')).toEqual([
            ['2025-05-07', 'played', [1], 0],
            ['2025-05-07', 'played', [101, 2], 2]
        ]);
        expect(planAt('20.15')).toEqual([['2025-05-07', 'played', [1, 2, 101], 2]]);
    });

    it('keeps the voters of the main chat when it has any', () => {
        const votersOf = (mainVoters: readonly number[]) => {
            const contentOf = (id: number, sentAt: string, voters: readonly number[]) => ({
                messages: [pollOf(id, sentAt, 'Сегодня, 19.00 North')],
                snapshot: Option.fromNullishOr({
                    users: new Map(),
                    pollIdByMessage: new Map([[id, 'shared']]),
                    votes: voters.map(userId => ({ pollId: 'shared', userId, choice: 'yes' as const, votedAt: new Date(0) }))
                } satisfies TelegramSnapshot)
            });
            const { snapshot } = planChats({
                config,
                main: contentOf(1, '2025-05-07T09:00:00Z', mainVoters),
                others: [contentOf(postIdOf(1, 101), '2025-05-07T08:00:00Z', [8, 9])],
                asOf: '2025-06-30'
            });

            return Option.getOrThrow(snapshot).votes.map(({ userId }) => userId);
        };

        expect(votersOf([7])).toEqual([7]);
        expect(votersOf([])).toEqual([8, 9]);
    });

    it('stays a match when the main chat forwards it', () => {
        const plan = planOf(
            [pollOf(1, '2025-05-07T09:00:00Z', 'Сегодня, 19.00 North, friendly')],
            [pollOf(101, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North, friendly')],
            { shared: [1, 101] }
        );

        expect(plan.sessions).toEqual([]);
    });

    it('is a game of its own when the main chat has it outside its game posts', () => {
        const plan = planOf(
            [{ ...pollOf(1, '2025-05-07T09:00:00Z', 'Сегодня, 19.00 North'), kind: 'service' }],
            [pollOf(101, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North')],
            {
                shared: [1, 101]
            }
        );

        expect(summaryOf(plan)).toEqual([['2025-05-07', 'played', [101], 0]]);
    });
});

describe('cancellations of the other chat', () => {
    it('cancel its game, but not with match words or places', () => {
        const textsOf = (...texts: readonly string[]) =>
            planOf(
                [],
                [
                    pollOf(101, '2025-05-07T08:00:00Z', 'Сегодня, 19.00 North'),
                    ...texts.map((text, index) => message(102 + index, '2025-05-07T10:00:00Z', text))
                ],
                {}
            ).sessions.map(({ status }) => status);

        expect(textsOf('Friendly сегодня отменяется', 'Сегодня отмена на Stadium')).toEqual(['played']);
        expect(textsOf('Сегодня отмена, дождь')).toEqual(['cancelled']);
    });
});

describe('dates of polls', () => {
    it('reads a weekday with a Latin letter, and the weekday when the stated date is months away', () => {
        expect(resolvePollDate('Cреда, 19.00 North', '2025-08-12')).toEqual({ date: '2025-08-13', confidence: 0.8 });
        expect(resolvePollDate('Среда, 15 декабря, 19.00 North', '2025-01-14').date).toBe('2025-01-15');
        expect(resolvePollDate('Среда, 12 марта, 19.00 North', '2025-01-14').date).toBe('2025-03-12');
        expect(resolvePollDate('Суббота, 20 декабря', '2025-08-10').date).toBe('2025-12-20');
        expect(resolvePollDate('Среда, 4 ноября', '2026-11-09').date).toBe('2026-11-11');
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
