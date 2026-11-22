import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createApp } from "./app.ts";
import { initializeDatabase } from "./db.ts";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 through 65535");
}

initializeDatabase();
createApp().listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
