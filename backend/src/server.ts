import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { createRepositories } from "./repositories.ts";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 through 65535");
}

const db = openDatabase(process.env.SQLITE_PATH);
const server = createApp(createRepositories(db)).listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
server.once("close", () => db.close());
