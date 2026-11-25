import { isNotEmptyArray } from '@rnw-community/shared';

import { labelWidth } from './label-width.util';

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

export const fitLabel = (text: string, budget: number): string => {
    if (labelWidth(text) <= budget) {
        return text;
    }

    const kept = [...graphemes.segment(text)].map(({ segment }) => segment);

    while (isNotEmptyArray(kept) && labelWidth(`${kept.join('')}…`) > budget) {
        kept.pop();
    }

    return `${kept.join('').trimEnd()}…`;
};
