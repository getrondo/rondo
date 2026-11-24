import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../src/prompt/system.prompt';

describe('system prompt', () => {
    const context = {
        communityName: 'Vienna FC',
        timezone: 'Europe/Vienna',
        today: '2026-12-04',
        weekday: 'Friday',
        locale: 'uk',
        adminName: 'Alex',
        adminPersonId: 'person-1'
    } as const;

    it('carries the community, admin and date context', () => {
        const prompt = buildSystemPrompt(context);

        expect(prompt).toContain('"Vienna FC"');
        expect(prompt).toContain('(Alex)');
        expect(prompt).toContain('own player record is person-1');
        expect(prompt).toContain('similar nicknames can be different people');
        expect(prompt).toContain('"at least"');
        expect(prompt).toContain('Friday 2026-12-04 (time zone Europe/Vienna)');
    });

    it('answers in the admin locale', () => {
        expect(buildSystemPrompt(context)).toContain('Always answer in Ukrainian');
        expect(buildSystemPrompt({ ...context, locale: 'ru' })).toContain('Always answer in Russian');
    });
});
