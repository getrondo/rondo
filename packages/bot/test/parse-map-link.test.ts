import { describe, expect, it } from '@effect/vitest';

import { parseMapLink } from '../src/utils/parse-map-link.util';

describe('map links', () => {
    it('reads coordinates from Google Maps links on the allowed hosts only', () => {
        expect(parseMapLink('https://www.google.com/maps/place/Lake/@48.21,16.37,17z')).toEqual({
            url: 'https://www.google.com/maps/place/Lake/@48.21,16.37,17z',
            lat: 48.21,
            lng: 16.37
        });
        expect(parseMapLink('https://maps.app.goo.gl/AbCdEf')).toEqual({ url: 'https://maps.app.goo.gl/AbCdEf', lat: null, lng: null });
        expect(parseMapLink('https://google.at/maps?q=48.2,16.4')?.lat).toBe(48.2);
        expect(parseMapLink('https://maps.google.com/?q=48.2,16.4')?.lng).toBe(16.4);
    });

    it('refuses other schemes, look-alike hosts, paths outside /maps and broken escapes without throwing', () => {
        expect(parseMapLink('http://www.google.com/maps/@48.2,16.4,17z')).toBeNull();
        expect(parseMapLink('https://google.com.evil.example/maps/@48.2,16.4')).toBeNull();
        expect(parseMapLink('https://www.google.co.uk/maps/@48.2,16.4')).toBeNull();
        expect(parseMapLink('https://evil.example/?u=https://www.google.com/maps')).toBeNull();
        expect(parseMapLink('https://www.google.com/search?q=48.2,16.4')).toBeNull();
        expect(parseMapLink('https://goo.gl/AbCdEf')).toBeNull();
        expect(parseMapLink('https://user@www.google.com/maps/@48.2,16.4')).toBeNull();
        expect(() => parseMapLink('https://www.google.com/maps/place/%E0%A4%A')).not.toThrow();
        expect(parseMapLink('https://www.google.com/maps/place/%E0%A4%A/@48.2,16.4,17z')?.lat).toBe(48.2);
    });
});
