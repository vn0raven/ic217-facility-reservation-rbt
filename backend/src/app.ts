import express from "express";
import type { HealthResponse } from "../../shared/types/index.ts";

export function createApp() {
  const app = express();

  app.get("/api/health", (_request, response) => {
    const health: HealthResponse = { status: "ok" };
    response.json(health);
  });

  return app;
}
