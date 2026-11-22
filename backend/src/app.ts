import express from "express";
import type { ErrorRequestHandler, Response } from "express";
import type { ApiResponse, HealthResponse } from "../../shared/types/index.ts";
import type { createRepositories } from "./repositories.ts";

function positiveId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

function fail(response: Response, status: number, code: string, message: string): void {
  const body: ApiResponse<never> = { ok: false, error: { code, message } };
  response.status(status).json(body);
}

function send<T>(response: Response, data: T): void {
  const body: ApiResponse<T> = { ok: true, data };
  response.json(body);
}

export function createApp(repositories: ReturnType<typeof createRepositories>) {
  const app = express();

  app.get("/api/health", (_request, response) => {
    const health: HealthResponse = { status: "ok" };
    response.json(health);
  });

  app.get("/api/facilities", (request, response) => {
    if (Object.keys(request.query).length) {
      return fail(response, 400, "INVALID_QUERY", "Facility listings do not accept query parameters.");
    }
    send(response, repositories.listFacilities());
  });

  app.get("/api/facilities/:id", (request, response) => {
    const id = positiveId(request.params.id);
    if (id === undefined) {
      return fail(response, 400, "INVALID_ID", "Facility ID must be a positive safe integer.");
    }
    if (Object.keys(request.query).length) {
      return fail(response, 400, "INVALID_QUERY", "Facility details do not accept query parameters.");
    }
    const facility = repositories.getFacility(id);
    if (!facility) return fail(response, 404, "FACILITY_NOT_FOUND", "Facility not found.");
    send(response, facility);
  });

  app.get("/api/reservations", (request, response) => {
    const query = request.query;
    const facilityId = positiveId(query.facilityId);
    if (Object.keys(query).some(key => key !== "facilityId") ||
        (query.facilityId !== undefined && facilityId === undefined)) {
      return fail(response, 400, "INVALID_QUERY", "The optional facilityId must be one positive safe integer.");
    }
    send(response, repositories.listReservations(facilityId));
  });

  app.use((_request, response) => {
    fail(response, 404, "NOT_FOUND", "Endpoint not found.");
  });

  const handleError: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof URIError) {
      return fail(response, 400, "INVALID_ID", "The request path is not valid.");
    }
    console.error(error);
    fail(response, 500, "INTERNAL_ERROR", "An unexpected server error occurred.");
  };
  app.use(handleError);

  return app;
}
