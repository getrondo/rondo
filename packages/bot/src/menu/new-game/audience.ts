import { isDefined, isNotEmptyArray } from '@rnw-community/shared';

import type { Draft, NewGameData } from './draft';
import type { Locale } from '@rondo/core/i18n/locale';

export interface DestinationChoice {
    readonly key: string;
    readonly audience: readonly string[];
}

export const audienceOfDraft = (draft: Draft, data: NewGameData): readonly string[] => {
    if (isNotEmptyArray(draft.audience)) {
        return draft.audience;
    }

    const [first] = data.chats;

    return isDefined(first) ? [first.id] : [data.selfChatId];
};

export const isSelfAudience = (draft: Draft, data: NewGameData): boolean => audienceOfDraft(draft, data)[0] === data.selfChatId;

export const quotedTitles = (titles: readonly string[], locale: Locale): string =>
    titles.map(title => `«${title}»`).join(locale === 'uk' ? ' і ' : ' и ');

export const destinationTitles = (draft: Draft, data: NewGameData): string[] => {
    const audience = audienceOfDraft(draft, data);

    return data.chats.filter(chat => audience.includes(chat.id)).map(chat => chat.title);
};

export const destinationChoices = (data: NewGameData): DestinationChoice[] => [
    { key: 'me', audience: [data.selfChatId] },
    ...data.chats.map(chat => ({ key: chat.id, audience: [chat.id] })),
    ...(data.chats.length > 1 ? [{ key: 'all', audience: data.chats.map(chat => chat.id) }] : [])
];
