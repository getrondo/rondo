import * as DateTime from 'effect/DateTime';

export const addMillis = (date: Date, millis: number): Date =>
    DateTime.toDate(DateTime.add(DateTime.fromDateUnsafe(date), { milliseconds: millis }));
