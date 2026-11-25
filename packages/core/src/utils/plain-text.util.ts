const entities: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

export const plainText = (html: string): string =>
    html
        .replaceAll(/<[^<>]*>/gu, '')
        .replaceAll(/&(?:amp|lt|gt|quot);/gu, entity => entities[entity] ?? entity)
        .trim();
