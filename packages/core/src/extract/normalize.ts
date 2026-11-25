export const normalizeAlias = (value: string): string =>
    value
        .toLowerCase()
        .replaceAll('ё', 'е')
        .replaceAll('й', 'и')
        .replaceAll(/[^\p{L}\p{N}+ ]/gu, ' ')
        .replaceAll(/\s+/gu, ' ')
        .trim();

export const compile = (patterns: readonly string[]): RegExp[] => patterns.map(pattern => new RegExp(pattern, 'iu'));

export const matchesAny = (text: string, regexes: readonly RegExp[]): boolean => regexes.some(regex => regex.test(text));
