import { customType, timestamp, uuid, type AnyPgColumn, type UpdateDeleteAction } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export const id = () =>
    uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7());

export const ref = (name: string) => uuid(name);

export const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => instant('created_at').notNull().defaultNow();

export const updatedAt = () =>
    instant('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdateFn(() => new Date());

export const tstzrange = customType<{ data: string; driverData: string }>({
    dataType: () => 'tstzrange'
});

export const daterange = customType<{ data: string; driverData: string }>({
    dataType: () => 'daterange'
});

export const int4range = customType<{ data: string; driverData: string }>({
    dataType: () => 'int4range'
});

export const requiredRef = (name: string, target: () => AnyPgColumn, onDelete: UpdateDeleteAction = 'cascade') =>
    ref(name).notNull().references(target, { onDelete });
