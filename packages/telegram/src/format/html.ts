const entities: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export const escapeHtml = (value: string): string => value.replaceAll(/[&<>"]/gu, character => entities[character] ?? character);

export const mentionHtml = (tgUserId: bigint, name: string): string => `<a href="tg://user?id=${tgUserId}">${escapeHtml(name)}</a>`;
