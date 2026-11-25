import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { escapeHtml } from '@rondo/telegram/format/html';

import type { PlaceBlock, PollGame, PollRoute } from '../interface/poll.interface';

const routeLabel = '🗺 Маршрут';

const mapUrlOf = (game: PollGame): string | null =>
    isDefined(game.venueLat) && isDefined(game.venueLng)
        ? `https://www.google.com/maps/search/?api=1&query=${game.venueLat},${game.venueLng}`
        : (game.venueMapUrl ?? null);

export const placeOf = (game: PollGame): PlaceBlock | null =>
    isNotEmptyString(game.venueName)
        ? { name: game.venueName, address: game.venueAddress ?? null, station: game.venueStation, mapUrl: mapUrlOf(game) }
        : null;

export const routeOf = (place: PlaceBlock | null): PollRoute | null =>
    isNotEmptyString(place?.mapUrl) ? { label: routeLabel, url: place.mapUrl } : null;

const linked = (place: PlaceBlock, text: string): string =>
    isNotEmptyString(place.mapUrl) ? `<a href="${escapeHtml(place.mapUrl)}"><b>${escapeHtml(text)}</b></a>` : `<b>${escapeHtml(text)}</b>`;

export const placeHtml = (place: PlaceBlock | null): string =>
    isDefined(place)
        ? [
              `📍 <b>${escapeHtml(place.name)}</b>`,
              ...(isNotEmptyString(place.address) ? [linked(place, place.address)] : []),
              ...(isNotEmptyString(place.station) ? [`🚇 ${escapeHtml(place.station)}`] : [])
          ].join('\n')
        : '';

const descriptionLines = (place: PlaceBlock | null, question: string, render: (text: string) => string): string[] => {
    if (!isDefined(place) || !isNotEmptyString(place.address)) {
        return [];
    }

    const station = isNotEmptyString(place.station) && !question.includes(place.station) ? [`🚇 ${place.station}`] : [];

    return [`📍 ${render(place.address)}`, ...station];
};

export const descriptionHtml = (place: PlaceBlock | null, question: string): string | null => {
    const lines = descriptionLines(place, question, text => (isDefined(place) ? linked(place, text) : text)).map((line, index) =>
        index === 0 ? line : escapeHtml(line)
    );

    return isNotEmptyArray(lines) ? lines.join('\n') : null;
};

export const descriptionText = (place: PlaceBlock | null, question: string): string | null => {
    const lines = descriptionLines(place, question, text => text);

    return isNotEmptyArray(lines) ? lines.join('\n') : null;
};
