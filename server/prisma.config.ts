import "dotenv/config";
import { defineConfig } from "@prisma/config";

// Force load the env again just to be safe for Windows
const dbUrl = process.env.DATABASE_URL;

export default defineConfig({
    schema: "./prisma/schema.prisma",
    seed: "npx ts-node prisma/seed.ts",
    datasource: {
        // We use a fallback string here to prevent the 'PrismaConfigEnvError' crash.
        // If the URL is missing, Prisma will give a much clearer error later.
        url: dbUrl || "postgres://error:missing_url_in_env@localhost:5432/error",
    },
});