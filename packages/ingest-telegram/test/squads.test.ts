import { describe, expect, it } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';

import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { extractLineup } from '../src/extract/extract-lineup';
import { extractPoll, makeVenueMatcher } from '../src/extract/extract-poll';
import { extractCancellation } from '../src/extract/extract-signals';
import { answerChoice } from '../src/extract/poll-answers';

import { message, testConfig } from './fixture';

import type { TelegramMessage } from '../src/model/telegram-message.model';

const venueOf = makeVenueMatcher(testConfig);
const squad = (text: string) => extractLineup(message(1, '2025-05-05T15:00:00Z', text), testConfig, venueOf);
const namesOf = (text: string) => squad(text)?.teams.map(team => team.members.map(({ alias }) => alias)) ?? null;
const cancel = (text: string) => extractCancellation(message(1, '2025-05-05T10:00:00Z', text), testConfig, new Set(['Org']));
const pollMessage = (id: number, sentAt: string, question: string, answers: readonly string[] = ['+', '-']) =>
    message(id, sentAt, '', { text: undefined, poll: { question, answers } });
const planOf = (messages: readonly TelegramMessage[], isGamePost?: (messageId: number) => boolean) =>
    assemblePlan(extractAll(messages, testConfig, { isGamePost }), '2025-06-30');
const sessionsOf = (messages: readonly TelegramMessage[]) =>
    planOf(messages).sessions.map(({ localDate, status, reviewReason, lineup }) => [
        localDate,
        status,
        reviewReason ?? null,
        isDefined(lineup)
    ]);

describe('squads by structure', () => {
    it('finds a squad without a keyword and one with a Latin letter in it', () => {
        expect(namesOf('🟢Я, Иван, Пётр, Олег\n\n🔵Семён, Павел, Глеб, Ян\n\nПо 8€ на поле')).toEqual([
            ['Я', 'Иван', 'Пётр', 'Олег'],
            ['Семён', 'Павел', 'Глеб', 'Ян']
        ]);
        expect(namesOf('Cоставы на сегодня\n🟢Я, Иван, Пётр, Олег\n🔵Семён, Павел, Глеб, Ян')).toHaveLength(2);
    });

    it('keeps the keyword rule for short teams', () => {
        expect(namesOf('Составы:\n🟢Я, Иван\n🔵Олег, Семён')).toHaveLength(2);
    });

    it('needs two different team emojis with at least four names each', () => {
        expect(namesOf('🟢Я, Иван, Пётр\n🔵Олег, Семён, Павел')).toBeNull();
        expect(namesOf('🟢Я, Иван, Пётр, Олег\n🟢Семён, Павел, Глеб, Ян')).toBeNull();
        expect(namesOf('✅на поле есть душ, вода, мячи, ворота\n✅ рядом парковка, кафе, метро, магазин')).toBeNull();
        expect(
            namesOf(
                '🟢Для матча на этом поле нужны бутсы, вода, щитки, форма\n🔵Напоминание для всех новых игроков: оплата, карта, ключи, время'
            )
        ).toBeNull();
    });

    it('takes an unknown emoji inside a squad as a team, but not a line of text', () => {
        expect(namesOf('🟢Я, Иван, Пётр, Олег\n🔵Семён, Павел, Глеб, Ян\n💰Марк, Лев, Юрий')).toHaveLength(3);
        expect(namesOf('Составы:\n🟢Я, Иван\n💰Марк, Лев, Юрий')).toHaveLength(2);
        expect(namesOf('Составы:\n🟢Я, Иван\n🔵Олег, Семён\n📌Мячи и манишки лежат в шкафу, за дверью, внизу, справа')).toHaveLength(2);
    });

    it('does not take a captains post, a schedule or a price for a squad', () => {
        expect(namesOf('Кубок, ищем состав\n✔️Понедельник, 19.00, North, поле\n✅Среда, 19.00, Park, зал')).toBeNull();
        expect(namesOf('Составы на сегодня:\n🟢Иван\n🔵Олег\n🔴Семён\nКапитаны набирают')).toBeNull();
        expect(namesOf('Составы:\n🟢Я, Иван\n🔵Олег, Семён\n10🔴 нужны манишки')).toHaveLength(2);
    });

    it('does not take labelled lines for a squad', () => {
        expect(namesOf('🟢Мяч: Иван, Пётр, Олег, Марк\n🔵Семён, Павел, Глеб, Ян')).toBeNull();
        expect(namesOf('Составы:\n🟢Я, Иван\n🔵Олег, Семён\n📌Форма: белая, синяя, чёрная')).toHaveLength(2);
        expect(namesOf('Составы:\n🟢Я, Иван\n🔵Олег, Семён\n📌Примечание: вода, форма, обувь')).toHaveLength(2);
    });

    it('reads teams that are labelled with their colour', () => {
        expect(namesOf('🟢Зелёные: Иван, Пётр, Олег, Марк\n🔵Синие: Семён, Павел, Глеб, Ян')).toEqual([
            ['Иван', 'Пётр', 'Олег', 'Марк'],
            ['Семён', 'Павел', 'Глеб', 'Ян']
        ]);
    });

    it('stops at a second list of the same players', () => {
        expect(
            namesOf('🟢Я, Иван, Пётр, Олег\n🔵Семён, Павел, Глеб, Ян\nДальше:\n🟢Я, Иван, Семён, Павел\n🔵Пётр, Олег, Глеб, Ян')
        ).toHaveLength(2);
        expect(namesOf('Составы:\n🟢Я, Иван\n🔵Олег, Семён\n🔵Марк, Лев')).toHaveLength(3);
    });

    it('keeps two names without a comma whole', () => {
        expect(namesOf('Составы:\n🟢Я, Иван Пётр\n🔵Олег, Семён')?.[0]).toEqual(['Я', 'Иван Пётр']);
    });

    it('ignores posts of other topics', () => {
        const posts = [
            pollMessage(1, '2025-05-04T18:00:00Z', 'Понедельник, 5 мая, 19.00 North'),
            message(2, '2025-05-05T15:00:00Z', 'Составы:\n🟢Я, Иван\n🔵Олег, Семён'),
            pollMessage(3, '2025-05-08T18:00:00Z', 'Пятница, 9 мая, 19.00 North')
        ];

        expect(planOf(posts, id => id === 1).sessions.map(({ localDate, lineup }) => [localDate, isDefined(lineup)])).toEqual([
            ['2025-05-05', false]
        ]);
    });
});

describe('cancellations', () => {
    it.each([
        'Вечерняя игра: отмена!',
        'Сегодня вечером играть мы не будем',
        'Решено: ИГРЫ НЕ БУДЕТ',
        'Поле мокрое.\nПереносим всё на завтра'
    ])('cancels on a plain statement: %s', text => {
        expect(cancel(text)).toMatchObject({ localDate: '2025-05-05', isExplicit: true });
    });

    it.each([
        'Состав полный? Отмена никому не нужна?',
        'Если заболели, отмена до полудня',
        'Приходите вовремя, чтобы игра не отменилась',
        'Подскажите как отменить запись',
        'Кто тут за перенос на субботу!?',
        'Матч не отменяем',
        'Игроки, кто отменяется, пишите мне'
    ])('does not cancel on asking, conditions, negation or how-to: %s', text => {
        expect(cancel(text)).toBeUndefined();
    });

    it.each([
        'Он отменился',
        'Мест больше нет, отмена платная',
        'Ждём ответа зала, возможно игры не будет',
        'Запись закрыта, отмена участия стоит 5 евро',
        'Без вратарей играть мы не будем'
    ])('is unclear: %s', text => {
        expect(cancel(text)).toMatchObject({ isExplicit: false });
    });

    it('takes the day from the sentence that cancels', () => {
        expect(cancel('В среду не будет футбола. Сегодня может тоже')).toMatchObject({ localDate: '2025-05-07' });
    });

    it('lets a squad outrank any cancellation and sends unclear ones with many yes votes to review', () => {
        const poll = (id: number, voters: readonly number[]) =>
            message(id, '2025-05-05T08:00:00Z', '', {
                text: undefined,
                poll: { question: 'Сегодня, 19.00 North', answers: ['+', '-'], voters }
            });
        const unclear = message(2, '2025-05-05T12:00:00Z', 'Он отменился');
        const explicit = message(2, '2025-05-05T12:00:00Z', 'Сегодня отмена, дождь');
        const lineup = message(3, '2025-05-05T11:00:00Z', 'Составы на сегодня:\n🟢Я, Иван\n🔵Олег, Семён');

        expect(sessionsOf([poll(1, [12, 3]), unclear])).toEqual([['2025-05-05', 'cancelled', 'unclear_cancellation', false]]);
        expect(sessionsOf([poll(1, [9, 3]), unclear])).toEqual([['2025-05-05', 'cancelled', null, false]]);
        expect(sessionsOf([poll(1, [12, 3]), explicit])).toEqual([['2025-05-05', 'cancelled', null, false]]);
        expect(sessionsOf([poll(1, [12, 3]), explicit, lineup])).toEqual([['2025-05-05', 'played', null, true]]);
        expect(sessionsOf([lineup, explicit])).toEqual([['2025-05-05', 'played', null, true]]);
    });
});

describe('polls', () => {
    it('uses the explicit date, and the weekday when that date has passed', () => {
        const dateOf = (question: string, sentAt: string) => extractPoll(pollMessage(1, sentAt, question), testConfig, venueOf)?.localDate;

        expect(dateOf('Понедельник, 12 мая, 19.00 North', '2025-05-05T10:00:00Z')).toBe('2025-05-12');
        expect(dateOf('понедельник, 9 Января, 19.00 North', '2026-02-08T10:00:00Z')).toBe('2026-02-09');
    });

    it('reads polls with three and more answers', () => {
        const read = (answers: readonly string[]) => answers.map((_, index) => answerChoice(answers, index));

        expect(read(['17.30-19.00', '19.30-21 00', 'Без разницы когда', 'Не смогу прийти'])).toEqual(['yes', 'yes', 'yes', 'no']);
        expect(read(['Формат 5х5', 'Формат 7х7', 'Не играю'])).toEqual(['yes', 'yes', 'no']);
        expect(read(['+18:00 North', '+ где угодно', '- пропускаю'])).toEqual(['yes', 'yes', 'no']);
        expect(
            read(['Приду и на матч, и на ужин', 'Приду только на игру в 12.00', 'Приду только на ужин в 14.00', 'Играть не хочу'])
        ).toEqual(['yes', 'yes', 'other', 'no']);
        expect(read(['Красные', 'Синие', 'Жёлтые'])).toEqual(['other', 'other', 'other']);
        expect(read(['+', '-'])).toEqual(['yes', 'no']);
        expect(read(['Да, отбой', 'Нужен матч'])).toEqual(['other', 'other']);
        expect(read(['Синяя форма', 'Белая форма'])).toEqual(['other', 'other']);
    });

    it('gives a poll that offers several days to the day that was played, not to the day of its deadline', () => {
        const choice = pollMessage(1, '2025-05-04T10:00:00Z', 'Выбираем день, North. Ответы сегодня до 20.00', [
            '05.05, понедельник 18.45',
            '06.05 вторник 19.00',
            'Не буду'
        ]);
        const squadPost = message(2, '2025-05-06T15:00:00Z', 'Составы на сегодня:\n🟢Я, Иван\n🔵Олег, Семён');

        expect(planOf([choice, squadPost]).sessions.map(({ localDate, pollMessageIds }) => [localDate, pollMessageIds])).toEqual([
            ['2025-05-06', [1]]
        ]);
        expect(planOf([choice]).sessions).toEqual([]);
    });

    it('does not join a preference poll to a game', () => {
        const game = pollMessage(1, '2025-05-05T08:00:00Z', 'Сегодня, 19.00 North');
        const preference = pollMessage(2, '2025-05-05T09:00:00Z', 'Четвёртая команда сегодня?', ['Да', 'Нет']);

        expect(planOf([game, preference]).sessions.map(({ pollMessageIds }) => pollMessageIds)).toEqual([[1]]);
    });

    it('joins a poll whose days are only in its answers to an existing game', () => {
        const days = pollMessage(1, '2025-05-04T10:00:00Z', 'Выбираем день для игры', ['Понедельник 18.45', 'Вторник 19.00', 'Не приду']);
        const game = pollMessage(2, '2025-05-05T10:00:00Z', 'Вторник, 6 мая, 19.00 North');

        expect(planOf([days]).sessions).toEqual([]);
        expect(planOf([days, game]).sessions.map(({ localDate, pollMessageIds }) => [localDate, pollMessageIds])).toEqual([
            ['2025-05-06', [1, 2]]
        ]);
    });

    it('gives forwards of one poll the game of the first post', () => {
        const first = pollMessage(1, '2025-05-04T10:00:00Z', 'Завтра, 19.00 North');
        const forward = pollMessage(2, '2025-05-05T10:00:00Z', 'Завтра, 19.00 North');
        const plan = assemblePlan(
            extractAll([first, forward], testConfig, {
                pollIdByMessage: new Map([
                    [1, 'p'],
                    [2, 'p']
                ])
            }),
            '2025-06-30'
        );

        expect(plan.sessions.map(({ localDate, pollMessageIds }) => [localDate, pollMessageIds])).toEqual([['2025-05-05', [1, 2]]]);
    });
});
