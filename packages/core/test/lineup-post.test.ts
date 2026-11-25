import { isDefined } from '@rnw-community/shared';
import { extractLineup } from '@rondo/ingest-telegram/extract/extract-lineup';
import { makeVenueMatcher } from '@rondo/ingest-telegram/extract/extract-poll';
import { describe, expect, it } from 'vitest';

import { lineupDiff, lineupPostHtml } from '../src/teams/lineup-post';
import { seedConfig } from '../src/testing/seed-community';

import type { PostMember, PostTeam } from '../src/teams/interface/lineup-post.interface';

const member = (personId: string, extra: Partial<PostMember> = {}): PostMember => ({
    personId,
    name: personId,
    tgUserId: null,
    username: null,
    isGk: false,
    isGuest: false,
    hostId: null,
    ...extra
});

const teams: PostTeam[] = [
    {
        badge: '🔴',
        members: [
            member('Andriy', { tgUserId: 501n, username: 'andriy_k' }),
            member('Andriy +1', { isGuest: true, hostId: 'Andriy' }),
            member('Andriy +2', { isGuest: true, hostId: 'Andriy' }),
            member('Bohdan', { isGk: true, tgUserId: 502n })
        ]
    },
    {
        badge: '🔵',
        members: [
            member('Vasyl & <Co>', { tgUserId: 503n }),
            member('Hryhoriy'),
            member('Andriy +3', { isGuest: true, hostId: 'Andriy' }),
            member('Dmytro')
        ]
    },
    { badge: '🟢', members: [member('Ivan'), member('Oleh'), member('Petro'), member('Friend Mark', { isGuest: true, hostId: null })] }
];

const entities: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
const unescape = (html: string): string => html.replaceAll(/&(?:amp|lt|gt|quot);/gu, entity => entities[entity] ?? entity);

const forwardOf = (html: string) => {
    const mentions: { offset: number; text: string; userId: number }[] = [];
    const parts = html.split(/(<a href="tg:\/\/user\?id=\d+">[^<]*<\/a>)/u);
    let text = '';

    for (const part of parts) {
        const link = /^<a href="tg:\/\/user\?id=(?<id>\d+)">(?<name>[^<]*)<\/a>$/u.exec(part);
        const name = unescape(link?.groups?.name ?? '');

        if (isDefined(link)) {
            mentions.push({ offset: text.length, text: name, userId: Number(link.groups?.id) });
            text = `${text}${name}`;
        } else {
            text = `${text}${unescape(part.replaceAll(/<[^<>]*>/gu, ''))}`;
        }
    }

    return { text, mentions };
};

describe('the posted line-up', () => {
    const post = { locale: 'uk' as const, title: 'Пт 27.11 19:00 · North Arena', teams, showHandles: false, isUpdate: false };

    it('lists badges, mentions linked players, groups guests with the host and notes the short team', () => {
        expect(lineupPostHtml(post)).toBe(
            [
                '<b>Склади: Пт 27.11 19:00 · North Arena</b>',
                '',
                '🔴 <a href="tg://user?id=501">Andriy</a> +2, <a href="tg://user?id=502">Bohdan</a> 🧤',
                '',
                '🔵 <a href="tg://user?id=503">Vasyl &amp; &lt;Co&gt;</a>, Hryhoriy, друг Andriy, Dmytro',
                '',
                '🟢 Ivan, Oleh, Petro, Friend Mark'
            ].join('\n')
        );
        expect(lineupPostHtml({ ...post, showHandles: true, isUpdate: true, locale: 'ru' })).toContain('Обновлённые составы\n<b>Составы:');
        expect(lineupPostHtml({ ...post, showHandles: true })).toContain('🔴 @andriy_k +2');
        expect(
            lineupPostHtml({
                ...post,
                teams: [teams[0] ?? { badge: '', members: [] }, { badge: '🔵', members: [member('A'), member('B'), member('C')] }]
            })
        ).toContain('🔵 A, B, C (+1 з команди, що програла)');
    });

    it('stays under the Telegram limit by shortening long names', () => {
        const long = [0, 1, 2, 3].map(team => ({
            badge: '🔴',
            members: Array.from({ length: 10 }, (_, index) => member(`${'Very long name '.repeat(8)}${team}-${index}`))
        }));
        const html = lineupPostHtml({ ...post, teams: long });

        expect(html.length).toBeLessThan(4096);
        expect(html).toContain('…');
    });

    it('reads back through our own squad importer as the same teams and guests, forwarded or not', () => {
        const { text, mentions } = forwardOf(lineupPostHtml(post));
        const config = seedConfig('round-trip');
        const fact = extractLineup(
            {
                id: 1,
                kind: 'message',
                sentAt: new Date('2026-11-27T12:00:00Z'),
                authorId: 1,
                text,
                mentions,
                forwardedFrom: 'Rondo',
                media: []
            },
            config,
            makeVenueMatcher(config)
        );

        expect(fact?.localDate).toBe('2026-11-27');
        expect(fact?.teams.map(team => team.emoji)).toEqual(['🔴', '🔵', '🟢']);
        expect(fact?.teams.map(team => team.members.map(entry => entry.alias))).toEqual([
            ['Andriy', 'Bohdan'],
            ['Vasyl & <Co>', 'Hryhoriy', 'друг Andriy', 'Dmytro'],
            ['Ivan', 'Oleh', 'Petro', 'Friend Mark']
        ]);
        expect(fact?.teams[0]?.members.map(entry => [entry.guests, entry.userId, entry.isGk])).toEqual([
            [2, 501, false],
            [0, 502, true]
        ]);
        expect(fact?.teams[1]?.members[2]?.guest).toEqual({ host: 'Andriy', count: 1 });
    });

    it('shows what changed between two line-ups', () => {
        const before = [
            { personId: 'a', name: 'A', badge: '🔴' },
            { personId: 'b', name: 'B', badge: '🔵' },
            { personId: 'c', name: 'C', badge: '🔵' }
        ];
        const after = [
            { personId: 'a', name: 'A', badge: '🔵' },
            { personId: 'b', name: 'B', badge: '🔵' },
            { personId: 'd', name: 'D', badge: '🔴' }
        ];

        expect(lineupDiff(before, after)).toEqual(['A: 🔴 → 🔵', '+ D 🔴', '− C']);
    });
});
