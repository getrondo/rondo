const pageSize = 5;

export interface VenuePage<T> {
    readonly shown: readonly T[];
    readonly pages: readonly { readonly page: number; readonly label: string }[];
}

export const venuePage = <T extends { readonly name: string }>(venues: readonly T[], page: number): VenuePage<T> => {
    const all = venues.toSorted((left, right) => left.name.localeCompare(right.name));

    return {
        shown: all.slice(page * pageSize, page * pageSize + pageSize),
        pages: [
            ...(page > 0 ? [{ page: page - 1, label: '◀️' }] : []),
            ...((page + 1) * pageSize < all.length ? [{ page: page + 1, label: '▶️' }] : [])
        ]
    };
};
