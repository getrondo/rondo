export type BadgeColour = 'red' | 'blue' | 'green' | 'yellow' | 'white' | 'orange';

export interface Badge {
    readonly colour: BadgeColour;
    readonly badge: string;
    readonly aliases: readonly string[];
}
