export interface BalancePlayer {
    readonly personId: string;
    readonly displayName: string;
    readonly strength: number;
    readonly isGk: boolean;
}

export interface BalancedTeam {
    readonly ordinal: number;
    readonly players: readonly BalancePlayer[];
    readonly strength: number;
}

const totalOf = (players: readonly BalancePlayer[]): number => players.reduce((sum, player) => sum + player.strength, 0);

const spread = (teams: readonly BalancePlayer[][]): number => {
    const totals = teams.map(team => totalOf(team));

    return Math.max(...totals) - Math.min(...totals);
};

const byStrength = (left: BalancePlayer, right: BalancePlayer): number =>
    right.strength - left.strength || left.displayName.localeCompare(right.displayName);

const snakeDraft = (players: readonly BalancePlayer[], teams: BalancePlayer[][]): void => {
    for (const [index, player] of players.entries()) {
        const round = Math.floor(index / teams.length);
        const slot = index % teams.length;
        teams[round % 2 === 0 ? slot : teams.length - 1 - slot]?.push(player);
    }
};

const trySwap = (teams: BalancePlayer[][], first: number, second: number): boolean => {
    const left = teams[first] ?? [];
    const right = teams[second] ?? [];
    const before = spread(teams);

    for (const [leftIndex, leftPlayer] of left.entries()) {
        for (const [rightIndex, rightPlayer] of right.entries()) {
            if (leftPlayer.isGk !== rightPlayer.isGk) {
                continue;
            }

            left[leftIndex] = rightPlayer;
            right[rightIndex] = leftPlayer;

            if (spread(teams) < before) {
                return true;
            }

            left[leftIndex] = leftPlayer;
            right[rightIndex] = rightPlayer;
        }
    }

    return false;
};

const improve = (teams: BalancePlayer[][]): void => {
    for (let pass = 0; pass < 50; pass += 1) {
        let changed = false;

        for (let first = 0; first < teams.length; first += 1) {
            for (let second = first + 1; second < teams.length; second += 1) {
                changed = trySwap(teams, first, second) || changed;
            }
        }

        if (!changed) {
            return;
        }
    }
};

export const balanceTeams = (players: readonly BalancePlayer[], teamCount: number): BalancedTeam[] => {
    const count = Math.max(2, Math.min(teamCount, Math.max(2, players.length)));
    const teams: BalancePlayer[][] = Array.from({ length: count }, () => []);
    const keepers = players.filter(player => player.isGk).toSorted(byStrength);
    const outfield = players.filter(player => !player.isGk).toSorted(byStrength);

    snakeDraft(keepers, teams);
    const offset = keepers.length % count;
    const rotated = [...teams.slice(offset), ...teams.slice(0, offset)];
    snakeDraft(outfield, rotated);
    improve(teams);

    return teams.map((members, index) => ({ ordinal: index + 1, players: members, strength: totalOf(members) }));
};
