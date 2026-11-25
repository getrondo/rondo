import { isDefined } from '@rnw-community/shared';

export type ParsedDate =
    | { readonly _tag: 'date'; readonly value: string }
    | { readonly _tag: 'past' }
    | { readonly _tag: 'bad' }
    | { readonly _tag: 'other' };

const pad = (value: number): string => String(value).padStart(2, '0');

export const parseDate = (text: string, today: string): ParsedDate => {
    const match = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?$/u.exec(text.trim());

    if (!isDefined(match)) {
        return /^[\d\s./-]+$/u.test(text.trim()) ? { _tag: 'bad' } : { _tag: 'other' };
    }

    const [, day = '', month = '', year] = match;
    const thisYear = Number(today.slice(0, 4));
    const explicitYear = isDefined(year) ? Number(year.length === 2 ? `20${year}` : year) : null;
    const candidate = (value: number) => `${value}-${pad(Number(month))}-${pad(Number(day))}`;
    const parsed = new Date(`${candidate(explicitYear ?? thisYear)}T12:00:00Z`);

    if (Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== Number(day)) {
        return { _tag: 'bad' };
    }

    const value = !isDefined(explicitYear) && candidate(thisYear) < today ? candidate(thisYear + 1) : candidate(explicitYear ?? thisYear);

    return value < today ? { _tag: 'past' } : { _tag: 'date', value };
};
