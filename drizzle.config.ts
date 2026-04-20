import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.GHCHAT_DATA_DIR
      ? `${process.env.GHCHAT_DATA_DIR}/ghchat.sqlite`
      : "./ghchat.sqlite",
  },
});
