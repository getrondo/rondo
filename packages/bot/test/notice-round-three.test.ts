import { expect, layer } from '@effect/vitest';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, deliver, lastPollId } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const groupPosts = (chatId: number) => recorder.calls.filter(call => call.method === 'sendMessage' && call.payload.chat_id === chatId);
const quoted = (text: string) => /<blockquote>([\s\S]*)<\/blockquote>/u.exec(text)?.[1] ?? '';

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('card notices after the council', it => {
    it.effect('sends exactly the previewed notice and shows a fresh preview when it changed before ✅', () =>
        Effect.gen(function* () {
            yield* seedSeason('r3-notice', { groupChatId: -25_001, adminId: 2501 });
            const admin = conversation(recorder, adminNumbered(2501));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* admin.tap('🕖 Час');
            yield* admin.type('20:15');
            const first = admin.screen();
            yield* deliver({
                poll_answer: {
                    poll_id: lastPollId(recorder, -25_001),
                    user: { id: 9_250_001, is_bot: false, first_name: 'Late Voter' },
                    option_ids: [0],
                    option_persistent_ids: []
                }
            });
            const before = groupPosts(-25_001).length;
            yield* admin.tapOn(first, '✅ Змінити й написати в «Games»');
            const fresh = admin.screen();
            const afterStale = groupPosts(-25_001).length;
            yield* admin.tap('✅ Змінити й написати в «Games»');
            const sent = groupPosts(-25_001).slice(before);

            expect(afterStale).toBe(before);
            expect(fresh.text.split('\n')[0]).toBe('⚠️ Дані змінилися, нічого не надіслано. Переглянь ще раз і натисни ✅.');
            expect(quoted(fresh.text)).toContain('Late Voter');
            expect(quoted(first.text)).not.toContain('Late Voter');
            expect(sent).toHaveLength(1);
            expect(String(sent[0]?.payload.text)).toBe(quoted(fresh.text));
        })
    );
});
