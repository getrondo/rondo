export const fromShortId = (shortId: string): string | null => {
    const hex = Buffer.from(shortId, 'base64url').toString('hex');

    return /^[\da-f]{32}$/u.test(hex) && shortId.length === 22
        ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
        : null;
};
