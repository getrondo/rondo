import { isDefined } from '@rnw-community/shared';

export interface MapLink {
    readonly url: string;
    readonly lat: number | null;
    readonly lng: number | null;
}

const googleHosts = /^(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)(?:[/?]|$)/iu;
const coordinates = /(?:@|[?&](?:q|query|ll)=)(-?\d{1,2}\.\d+),\s?(-?\d{1,3}\.\d+)/u;

export const parseMapLink = (text: string): MapLink | null => {
    const url = text.trim();
    const withoutScheme = url.replace(/^https?:\/\//iu, '');

    if (!/^https?:\/\/\S+$/iu.test(url) || !googleHosts.test(withoutScheme)) {
        return null;
    }

    const match = coordinates.exec(decodeURIComponent(url));

    return isDefined(match) ? { url, lat: Number(match[1]), lng: Number(match[2]) } : { url, lat: null, lng: null };
};
