// Weng and Lin, "A Bayesian Approximation Method for Online Ranking", JMLR 12 (2011), Algorithm 1, Bradley-Terry with full pairing (as in OpenSkill)
import type { Rated } from './interface/rated.interface';

const beta = 25 / 6;
const kappa = 0.0001;

export const unknownRating: Rated = { mu: 25, sigma: 25 / 3 };

export const rateResult = (teams: readonly (readonly Rated[])[], ranks: readonly number[]): Rated[][] => {
    const sums = teams.map(team => ({
        mu: team.reduce((sum, player) => sum + player.mu, 0),
        variance: team.reduce((sum, player) => sum + player.sigma ** 2, 0)
    }));

    return teams.map((team, index) => {
        const own = sums[index] ?? { mu: 0, variance: 1 };
        let omega = 0;
        let delta = 0;

        for (const [other, rival] of sums.entries()) {
            if (other !== index) {
                const spread = Math.sqrt(own.variance + rival.variance + 2 * beta ** 2);
                const expected = 1 / (1 + Math.exp((rival.mu - own.mu) / spread));
                const rank = ranks[index] ?? 0;
                const rivalRank = ranks[other] ?? 0;
                let score = 0.5;

                if (rank !== rivalRank) {
                    score = rank < rivalRank ? 1 : 0;
                }

                omega += (own.variance / spread) * (score - expected);
                delta += ((Math.sqrt(own.variance) / spread) * own.variance * expected * (1 - expected)) / spread ** 2;
            }
        }

        return team.map(player => ({
            mu: player.mu + (player.sigma ** 2 / own.variance) * omega,
            sigma: player.sigma * Math.sqrt(Math.max(1 - (player.sigma ** 2 / own.variance) * delta, kappa))
        }));
    });
};
