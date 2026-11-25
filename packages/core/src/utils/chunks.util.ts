const chunkSize = 500;

export const chunks = <Item>(items: readonly Item[]): Item[][] =>
    Array.from({ length: Math.ceil(items.length / chunkSize) }, (_, index) => items.slice(index * chunkSize, (index + 1) * chunkSize));
