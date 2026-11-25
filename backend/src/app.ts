import express from "express";
import type { ErrorRequestHandler, Response } from "express";
import type {
  ApiResponse,
  AvailabilityCheckResult,
  FacilityScheduleItem,
  HealthResponse,
  ReservationAction,
  ReservationStatus,
} from "../../shared/types/index.ts";
import type { createRepositories } from "./repositories.ts";
import { createScheduleIndex } from "./schedule-index.ts";
import type { ScheduledRecord } from "./schedule-index.ts";

const VALID_STATUSES = new Set<ReservationStatus>([
  "pending",
  "confirmed",
  "rejected",
  "cancelled",
]);
const VALID_ACTIONS = new Set<ReservationAction>(["approve", "reject", "cancel"]);
const ALLOWED_RESERVATION_FILTERS = new Set(["facilityId", "userId", "status"]);
const ALLOWED_SCHEDULE_WINDOW_PARAMS = new Set(["start", "end"]);
const ALLOWED_AVAILABILITY_PARAMS = new Set(["facilityId", "start", "end"]);

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function positiveIdFromQuery(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

function nonNegativeTimestampFromQuery(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) ? timestamp : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined;
}

function nonNegativeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(response: Response, status: number, code: string, message: string): void {
  const body: ApiResponse<never> = { ok: false, error: { code, message } };
  response.status(status).json(body);
}

function send<T>(response: Response, data: T, status = 200): void {
  const body: ApiResponse<T> = { ok: true, data };
  response.status(status).json(body);
}

export function createApp(
  repositories: ReturnType<typeof createRepositories>,
  scheduleIndex = createScheduleIndex(repositories),
) {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  function hydrateScheduleRecord(record: ScheduledRecord): FacilityScheduleItem | undefined {
    if (record.kind === "academic") {
      const block = repositories.getAcademicBlock(record.recordId);
      if (!block) return undefined;
      return {
        kind: "academic",
        id: block.id,
        facilityId: block.facilityId,
        start: block.start,
        end: block.end,
        title: block.title,
      };
    }

    const reservation = repositories.getReservation(record.recordId);
    if (!reservation) return undefined;
    const requester = repositories.getUser(reservation.userId);
    return {
      kind: "reservation",
      id: reservation.id,
      facilityId: reservation.facilityId,
      start: reservation.start,
      end: reservation.end,
      purpose: reservation.purpose,
      userId: reservation.userId,
      requesterName: requester?.name ?? `User #${reservation.userId}`,
      requesterRole: requester?.role ?? "student",
    };
  }

  app.get("/api/health", (_request, response) => {
    const health: HealthResponse = { status: "ok" };
    response.json(health);
  });

  app.get("/api/users", (request, response) => {
    if (Object.keys(request.query).length > 0) {
      return fail(response, 400, "INVALID_QUERY", "User listings do not accept query parameters.");
    }
    send(response, repositories.listUsers());
  });

  app.get("/api/facilities", (request, response) => {
    if (Object.keys(request.query).length > 0) {
      return fail(response, 400, "INVALID_QUERY", "Facility listings do not accept query parameters.");
    }
    send(response, repositories.listFacilities());
  });

  app.get("/api/facilities/:id", (request, response) => {
    const id = positiveIdFromQuery(request.params.id);
    if (id === undefined) {
      return fail(response, 400, "INVALID_ID", "Facility ID must be a positive safe integer.");
    }
    if (Object.keys(request.query).length > 0) {
      return fail(response, 400, "INVALID_QUERY", "Facility details do not accept query parameters.");
    }
    const facility = repositories.getFacility(id);
    if (!facility) return fail(response, 404, "FACILITY_NOT_FOUND", "Facility not found.");
    send(response, facility);
  });

  app.get("/api/facilities/:id/schedule", (request, response) => {
    const id = positiveIdFromQuery(request.params.id);
    if (id === undefined) {
      return fail(response, 400, "INVALID_ID", "Facility ID must be a positive safe integer.");
    }
    const query = request.query;
    if (Object.keys(query).some(key => !ALLOWED_SCHEDULE_WINDOW_PARAMS.has(key))) {
      return fail(response, 400, "INVALID_QUERY", "Schedule queries accept only start and end timestamps.");
    }
    const start = nonNegativeTimestampFromQuery(query.start);
    const end = nonNegativeTimestampFromQuery(query.end);
    if (start === undefined || end === undefined || end <= start) {
      return fail(
        response,
        400,
        "INVALID_INTERVAL",
        "start and end query parameters must be non-negative UTC millisecond integers with end after start.",
      );
    }
    const facility = repositories.getFacility(id);
    if (!facility) return fail(response, 404, "FACILITY_NOT_FOUND", "Facility not found.");

    const records = scheduleIndex.queryWindow(id, start, end);
    const items = records
      .map(hydrateScheduleRecord)
      .filter((item): item is FacilityScheduleItem => item !== undefined);
    send(response, items);
  });

  app.get("/api/schedule/availability", (request, response) => {
    const query = request.query;
    if (Object.keys(query).some(key => !ALLOWED_AVAILABILITY_PARAMS.has(key))) {
      return fail(
        response,
        400,
        "INVALID_QUERY",
        "Availability checks accept only facilityId, start, and end.",
      );
    }
    const facilityId = positiveIdFromQuery(query.facilityId);
    if (facilityId === undefined) {
      return fail(response, 400, "INVALID_QUERY", "facilityId must be a positive safe integer.");
    }
    const start = nonNegativeTimestampFromQuery(query.start);
    const end = nonNegativeTimestampFromQuery(query.end);
    if (start === undefined || end === undefined || end <= start) {
      return fail(
        response,
        400,
        "INVALID_INTERVAL",
        "start and end must be non-negative UTC millisecond integers with end after start.",
      );
    }

    const facility = repositories.getFacility(facilityId);
    if (!facility) return fail(response, 404, "FACILITY_NOT_FOUND", "Facility not found.");
    if (!facility.active) {
      return fail(response, 409, "FACILITY_INACTIVE", "This facility is currently inactive.");
    }

    const conflictRecord = scheduleIndex.findConflict(facilityId, start, end);
    const result: AvailabilityCheckResult = {
      facilityId,
      start,
      end,
      available: !conflictRecord,
      conflict: conflictRecord ? (hydrateScheduleRecord(conflictRecord) ?? null) : null,
    };
    send(response, result);
  });

  app.get("/api/academic-blocks", (request, response) => {
    const query = request.query;
    const facilityId = query.facilityId === undefined ? undefined : positiveIdFromQuery(query.facilityId);
    if (
      Object.keys(query).some(key => key !== "facilityId") ||
      (query.facilityId !== undefined && facilityId === undefined)
    ) {
      return fail(
        response,
        400,
        "INVALID_QUERY",
        "The optional facilityId must be one positive safe integer.",
      );
    }
    send(response, repositories.listAcademicBlocks(facilityId));
  });

  app.post("/api/academic-blocks", (request, response) => {
    if (!isPlainObject(request.body)) {
      return fail(response, 400, "INVALID_BODY", "Request body must be a JSON object.");
    }
    const actorUserId = positiveInteger(request.body.actorUserId);
    const facilityId = positiveInteger(request.body.facilityId);
    if (actorUserId === undefined || facilityId === undefined) {
      return fail(
        response,
        400,
        "INVALID_BODY",
        "actorUserId and facilityId must be positive safe integers.",
      );
    }

    const start = nonNegativeTimestamp(request.body.start);
    const end = nonNegativeTimestamp(request.body.end);
    if (start === undefined || end === undefined || end <= start) {
      return fail(
        response,
        400,
        "INVALID_INTERVAL",
        "start and end must be non-negative UTC millisecond timestamps with end after start.",
      );
    }

    if (typeof request.body.title !== "string") {
      return fail(response, 400, "INVALID_TITLE", "Academic block title is required.");
    }
    const title = request.body.title.trim();
    if (title.length < 1 || title.length > 120) {
      return fail(response, 400, "INVALID_TITLE", "Academic block title must be 1 to 120 characters.");
    }

    const created = repositories.runInTransaction(() => {
      const actor = repositories.getUser(actorUserId);
      if (!actor) throw new HttpError(404, "USER_NOT_FOUND", "Acting user was not found.");
      if (actor.role !== "personnel") {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Only department personnel can block academic class schedules.",
        );
      }

      const facility = repositories.getFacility(facilityId);
      if (!facility) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found.");
      if (!facility.active) {
        throw new HttpError(
          409,
          "FACILITY_INACTIVE",
          "Academic schedule blocks cannot be added to an inactive facility.",
        );
      }

      const conflict = scheduleIndex.findConflict(facilityId, start, end);
      if (conflict) {
        const reason = conflict.kind === "academic"
          ? "an existing academic schedule block"
          : "an approved reservation";
        throw new HttpError(
          409,
          "SCHEDULE_CONFLICT",
          `Cannot block this slot because it overlaps ${reason}.`,
        );
      }

      const block = repositories.createAcademicBlock({ facilityId, title, start, end });
      scheduleIndex.insertAcademicBlock(block);
      return block;
    });

    send(response, created, 201);
  });

  app.delete("/api/academic-blocks/:id", (request, response) => {
    const id = positiveIdFromQuery(request.params.id);
    if (id === undefined) {
      return fail(response, 400, "INVALID_ID", "Academic block ID must be a positive safe integer.");
    }
    if (Object.keys(request.query).length > 0) {
      return fail(response, 400, "INVALID_QUERY", "Academic block deletion does not accept query parameters.");
    }
    if (!isPlainObject(request.body)) {
      return fail(response, 400, "INVALID_BODY", "Request body must be a JSON object.");
    }
    const actorUserId = positiveInteger(request.body.actorUserId);
    if (actorUserId === undefined) {
      return fail(response, 400, "INVALID_BODY", "actorUserId must be a positive safe integer.");
    }

    const deleted = repositories.runInTransaction(() => {
      const actor = repositories.getUser(actorUserId);
      if (!actor) throw new HttpError(404, "USER_NOT_FOUND", "Acting user was not found.");
      if (actor.role !== "personnel") {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Only department personnel can remove academic schedule blocks.",
        );
      }

      const removed = repositories.deleteAcademicBlock(id);
      if (!removed) {
        throw new HttpError(404, "ACADEMIC_BLOCK_NOT_FOUND", "Academic schedule block not found.");
      }
      scheduleIndex.removeAcademicBlock(removed);
      return removed;
    });

    send(response, deleted);
  });

  app.get("/api/reservations", (request, response) => {
    const query = request.query;
    if (Object.keys(query).some(key => !ALLOWED_RESERVATION_FILTERS.has(key))) {
      return fail(
        response,
        400,
        "INVALID_QUERY",
        "Allowed reservation filters are facilityId, userId, and status.",
      );
    }

    const facilityId = query.facilityId === undefined ? undefined : positiveIdFromQuery(query.facilityId);
    if (query.facilityId !== undefined && facilityId === undefined) {
      return fail(response, 400, "INVALID_QUERY", "The optional facilityId must be one positive safe integer.");
    }

    const userId = query.userId === undefined ? undefined : positiveIdFromQuery(query.userId);
    if (query.userId !== undefined && userId === undefined) {
      return fail(response, 400, "INVALID_QUERY", "The optional userId must be one positive safe integer.");
    }

    const status = query.status;
    if (status !== undefined && (typeof status !== "string" || !VALID_STATUSES.has(status as ReservationStatus))) {
      return fail(
        response,
        400,
        "INVALID_QUERY",
        "The optional status must be pending, confirmed, rejected, or cancelled.",
      );
    }

    send(
      response,
      repositories.listReservations({
        facilityId,
        userId,
        status: status as ReservationStatus | undefined,
      }),
    );
  });

  app.get("/api/reservations/:id", (request, response) => {
    const id = positiveIdFromQuery(request.params.id);
    if (id === undefined) {
      return fail(response, 400, "INVALID_ID", "Reservation ID must be a positive safe integer.");
    }
    if (Object.keys(request.query).length > 0) {
      return fail(response, 400, "INVALID_QUERY", "Reservation details do not accept query parameters.");
    }
    const reservation = repositories.getReservation(id);
    if (!reservation) return fail(response, 404, "RESERVATION_NOT_FOUND", "Reservation not found.");
    send(response, reservation);
  });

  app.post("/api/reservations", (request, response) => {
    if (!isPlainObject(request.body)) {
      return fail(response, 400, "INVALID_BODY", "Request body must be a JSON object.");
    }

    const userId = positiveInteger(request.body.userId);
    const facilityId = positiveInteger(request.body.facilityId);
    if (userId === undefined || facilityId === undefined) {
      return fail(response, 400, "INVALID_BODY", "userId and facilityId must be positive safe integers.");
    }

    const start = nonNegativeTimestamp(request.body.start);
    const end = nonNegativeTimestamp(request.body.end);
    if (start === undefined || end === undefined || end <= start) {
      return fail(
        response,
        400,
        "INVALID_INTERVAL",
        "start and end must be non-negative UTC millisecond timestamps with end after start.",
      );
    }

    if (typeof request.body.purpose !== "string") {
      return fail(response, 400, "INVALID_PURPOSE", "Reservation purpose is required.");
    }
    const purpose = request.body.purpose.trim();
    if (purpose.length < 1 || purpose.length > 250) {
      return fail(response, 400, "INVALID_PURPOSE", "Reservation purpose must be 1 to 250 characters.");
    }

    const created = repositories.runInTransaction(() => {
      const user = repositories.getUser(userId);
      if (!user) throw new HttpError(404, "USER_NOT_FOUND", "Requester user was not found.");

      const facility = repositories.getFacility(facilityId);
      if (!facility) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found.");
      if (!facility.active) {
        throw new HttpError(409, "FACILITY_INACTIVE", "Reservations cannot be requested for an inactive facility.");
      }

      const conflict = scheduleIndex.findConflict(facilityId, start, end);
      if (conflict) {
        const reason = conflict.kind === "academic"
          ? "an academic schedule block"
          : "an approved reservation";
        throw new HttpError(
          409,
          "SCHEDULE_CONFLICT",
          `The requested time overlaps ${reason} for this facility.`,
        );
      }

      return repositories.createReservation({ userId, facilityId, start, end, purpose });
    });

    send(response, created, 201);
  });

  app.patch("/api/reservations/:id/status", (request, response) => {
    const id = positiveIdFromQuery(request.params.id);
    if (id === undefined) {
      return fail(response, 400, "INVALID_ID", "Reservation ID must be a positive safe integer.");
    }
    if (!isPlainObject(request.body)) {
      return fail(response, 400, "INVALID_BODY", "Request body must be a JSON object.");
    }

    const actorUserId = positiveInteger(request.body.actorUserId);
    if (actorUserId === undefined) {
      return fail(response, 400, "INVALID_BODY", "actorUserId must be a positive safe integer.");
    }

    const action = request.body.action;
    if (typeof action !== "string" || !VALID_ACTIONS.has(action as ReservationAction)) {
      return fail(response, 400, "INVALID_ACTION", "action must be approve, reject, or cancel.");
    }

    const updated = repositories.runInTransaction(() => {
      const actor = repositories.getUser(actorUserId);
      if (!actor) throw new HttpError(404, "USER_NOT_FOUND", "Acting user was not found.");

      const existing = repositories.getReservation(id);
      if (!existing) throw new HttpError(404, "RESERVATION_NOT_FOUND", "Reservation not found.");

      if (action === "approve" || action === "reject") {
        if (actor.role !== "personnel") {
          throw new HttpError(
            403,
            "FORBIDDEN",
            "Only department personnel can approve or reject reservation requests.",
          );
        }
        if (existing.status !== "pending") {
          throw new HttpError(
            409,
            "INVALID_STATUS_TRANSITION",
            `Cannot ${action} a reservation whose status is ${existing.status}.`,
          );
        }

        if (action === "approve") {
          const facility = repositories.getFacility(existing.facilityId);
          if (!facility || !facility.active) {
            throw new HttpError(
              409,
              "FACILITY_INACTIVE",
              "Cannot approve a reservation for an inactive facility.",
            );
          }

          const conflict = scheduleIndex.findConflict(existing.facilityId, existing.start, existing.end);
          if (conflict) {
            const reason = conflict.kind === "academic"
              ? "an academic schedule block"
              : "another approved reservation";
            throw new HttpError(
              409,
              "SCHEDULE_CONFLICT",
              `Cannot approve because this time slot overlaps ${reason}.`,
            );
          }

          const confirmed = repositories.updateReservationStatus(id, "confirmed")!;
          scheduleIndex.insertConfirmedReservation(confirmed);
          return confirmed;
        }

        return repositories.updateReservationStatus(id, "rejected")!;
      }

      if (actor.role !== "personnel" && actor.id !== existing.userId) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Requesters may only cancel their own reservations.",
        );
      }
      if (existing.status !== "pending" && existing.status !== "confirmed") {
        throw new HttpError(
          409,
          "INVALID_STATUS_TRANSITION",
          `Cannot cancel a reservation whose status is ${existing.status}.`,
        );
      }

      const cancelled = repositories.updateReservationStatus(id, "cancelled")!;
      if (existing.status === "confirmed") {
        scheduleIndex.removeConfirmedReservation(existing);
      }
      return cancelled;
    });

    send(response, updated);
  });

  app.use((_request, response) => {
    fail(response, 404, "NOT_FOUND", "Endpoint not found.");
  });

  const handleError: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof HttpError) {
      return fail(response, error.status, error.code, error.message);
    }
    if (error instanceof URIError) {
      return fail(response, 400, "INVALID_ID", "The request path is not valid.");
    }
    if (error instanceof SyntaxError && "body" in error) {
      return fail(response, 400, "INVALID_BODY", "Malformed JSON request body.");
    }
    console.error(error);
    fail(response, 500, "INTERNAL_ERROR", "An unexpected server error occurred.");
  };
  app.use(handleError);

  return app;
}
