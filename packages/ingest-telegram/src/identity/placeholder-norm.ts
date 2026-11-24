export const placeholderNorm = (aliasNorm: string, occurrence: number): string =>
    occurrence === 1 ? aliasNorm : `${aliasNorm} #${occurrence}`;
