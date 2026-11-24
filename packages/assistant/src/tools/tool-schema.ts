import * as Schema from 'effect/Schema';

export const toolSchema = <SchemaType extends Schema.Codec<unknown>>(schema: SchemaType) =>
    Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

export const IsoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)).annotate({ description: 'ISO date YYYY-MM-DD' });

export const LocalTime = Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}$/u)).annotate({ description: 'local time HH:MM, 24h' });

export const optionalNullable = <SchemaType extends Schema.Top>(schema: SchemaType) => Schema.optional(Schema.NullOr(schema));
