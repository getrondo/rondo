import { isDefined } from '@rnw-community/shared';

export type ParsedTime = { readonly _tag: 'time'; readonly value: string } | { readonly _tag: 'bad' } | { readonly _tag: 'other' };

export const parseTime = (text: string): ParsedTime => {
    const match = /^(\d{1,2})(?:[\s.:]?(\d{2}))?$/u.exec(text.trim());

    if (!isDefined(match)) {
        return /^[\d\s.:]+$/u.test(text.trim()) ? { _tag: 'bad' } : { _tag: 'other' };
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2] ?? '0');

    return hours <= 23 && minutes <= 59
        ? { _tag: 'time', value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` }
        : { _tag: 'bad' };
};
