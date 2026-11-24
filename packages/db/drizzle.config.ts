import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/schema/*.schema.ts',
    out: './drizzle',
    dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://rondo:rondo@localhost:54329/rondo' },
    migrations: { table: 'migrations', schema: 'drizzle' },
    verbose: true
});
