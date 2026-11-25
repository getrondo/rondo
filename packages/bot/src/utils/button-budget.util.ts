export const buttonBudget = (buttonsInRow: number): number => {
    if (buttonsInRow <= 1) {
        return 34;
    }

    if (buttonsInRow === 2) {
        return 15;
    }

    return buttonsInRow === 3 ? 9 : 6;
};
