export const toShortId = (uuid: string): string => Buffer.from(uuid.replaceAll('-', ''), 'hex').toString('base64url');
