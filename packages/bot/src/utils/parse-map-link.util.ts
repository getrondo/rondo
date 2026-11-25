import { isDefined, isEmptyString, isNotEmptyString } from '@rnw-community/shared';

export interface MapLink {
    readonly url: string;
    readonly lat: number | null;
    readonly lng: number | null;
}

const mapsOnlyHosts = new Set(['www.google.com', 'google.com', 'google.at', 'www.google.at', 'goo.gl']);
const anyPathHosts = new Set(['maps.google.com', 'maps.app.goo.gl']);
const coordinates = /(?:@|[?&](?:q|query|ll)=)(-?\d{1,2}\.\d+),\s?(-?\d{1,3}\.\d+)/u;

const isValidEscape = (run: string): boolean => {
    const bytes = run
        .split('%')
        .filter(hex => isNotEmptyString(hex))
        .map(hex => Number.parseInt(hex, 16));

    return !new TextDecoder().decode(new Uint8Array(bytes)).includes('\uFFFD');
};

const urlOf = (text: string): URL | null => (URL.canParse(text) ? new URL(text) : null);

const decoded = (text: string): string =>
    text.replaceAll(/(?:%[\da-f]{2})+/giu, run => (isValidEscape(run) ? decodeURIComponent(run) : run));

const isAllowed = (url: URL): boolean =>
    url.protocol === 'https:' &&
    isEmptyString(url.username) &&
    isEmptyString(url.password) &&
    isEmptyString(url.port) &&
    (anyPathHosts.has(url.hostname) || (mapsOnlyHosts.has(url.hostname) && /^\/maps(?:\/|$)/u.test(url.pathname)));

export const parseMapLink = (text: string): MapLink | null => {
    const url = urlOf(text.trim());

    if (!isDefined(url) || !isAllowed(url)) {
        return null;
    }

    const match = coordinates.exec(decoded(url.href));

    return isDefined(match) ? { url: url.href, lat: Number(match[1]), lng: Number(match[2]) } : { url: url.href, lat: null, lng: null };
};
