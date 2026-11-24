import { describe, expect, it } from 'vitest';

import { parseHtmlPage } from '../src/parse/parse-html-export';

const page = `<!DOCTYPE html><html><body><div class="history">
<div class="message service" id="message1"><div class="body details">Someone joined the group</div></div>
<div class="message default clearfix" id="message2"><div class="body">
<div class="pull_right date details" title="1 June 2023, 20:23:12">20:23</div>
<div class="from_name">Org</div>
<div class="text">Не забываем отметиться</div>
</div></div>
<div class="message default clearfix joined" id="message3"><div class="body">
<div class="pull_right date details" title="01.06.2023 20:24:00 UTC+02:00">20:24</div>
<div class="forwarded_from details">Forwarded from Org</div>
<div class="media_wrap clearfix"><div class="media_poll"><div class="question bold">Игра в пятницу</div><div class="details">Poll</div><div class="answer">- +</div><div class="answer">- -</div></div></div>
</div></div>
<div class="message default clearfix" id="message4"><div class="body">
<div class="pull_right date details" title="2 June 2023, 09:00:00">09:00</div>
<div class="from_name">Player</div>
<div class="reply_to details">In reply to <a href="#go_to_message2" onclick="return GoToMessage(2)">this message</a></div>
<a class="media clearfix pull_left block_link media_location" href="https://maps.google.com/?q=48.2,16.3"><div class="body"><div class="title bold">Location</div></div></a>
</div></div>
</div></body></html>`;

describe('Telegram HTML export parsing', () => {
    const { messages, lastAuthor } = parseHtmlPage(page, undefined, 'Europe/Vienna');

    it('parses service and user messages in order', () => {
        expect(messages.map(entry => [entry.id, entry.kind])).toEqual([
            [1, 'service'],
            [2, 'message'],
            [3, 'message'],
            [4, 'message']
        ]);
        expect(lastAuthor).toBe('Player');
    });

    it('interprets named-month timestamps as Vienna local time and keeps explicit offsets', () => {
        expect(messages[1]?.sentAt?.toISOString()).toBe('2023-06-01T18:23:12.000Z');
        expect(messages[2]?.sentAt?.toISOString()).toBe('2023-06-01T18:24:00.000Z');
    });

    it('carries the author over to joined messages and reads polls', () => {
        expect(messages[2]).toMatchObject({
            author: 'Org',
            forwardedFrom: 'Org',
            poll: { question: 'Игра в пятницу', answers: ['+', '-'] }
        });
    });

    it('reads replies and locations', () => {
        expect(messages[3]).toMatchObject({ replyTo: 2, location: { lat: 48.2, lng: 16.3 } });
    });
});
