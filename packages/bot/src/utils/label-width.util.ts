const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const pictograph = /\p{Extended_Pictographic}/u;

export const labelWidth = (text: string): number =>
    [...graphemes.segment(text)].reduce((width, { segment }) => width + (pictograph.test(segment) ? 1.5 : 1), 0);
