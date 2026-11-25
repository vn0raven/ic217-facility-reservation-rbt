export interface HealthResponse {
  status: "ok";
}

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type UserRole = "student" | "faculty" | "visitor" | "personnel";

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  department: string | null;
}

export interface Facility {
  id: number;
  name: string;
  location: string | null;
  capacity: number | null;
  active: boolean;
}

export interface CreateFacilityInput {
  actorUserId: number;
  name: string;
  location: string | null;
  capacity: number | null;
  active?: boolean;
}

export interface UpdateFacilityInput {
  actorUserId: number;
  location?: string | null;
  capacity?: number | null;
  active?: boolean;
}

export interface ScheduleInterval {
  facilityId: number;
  start: number;
  end: number;
}

export type ReservationStatus = "pending" | "confirmed" | "rejected" | "cancelled";

export interface Reservation extends ScheduleInterval {
  id: number;
  userId: number;
  purpose: string;
  status: ReservationStatus;
  createdAt: number;
}

export interface CreateReservationInput {
  userId: number;
  facilityId: number;
  start: number;
  end: number;
  purpose: string;
}

export type ReservationAction = "approve" | "reject" | "cancel";

export interface UpdateReservationStatusInput {
  actorUserId: number;
  action: ReservationAction;
}

export interface AcademicScheduleBlock extends ScheduleInterval {
  id: number;
  title: string;
}

export interface CreateAcademicBlockInput {
  actorUserId: number;
  facilityId: number;
  title: string;
  start: number;
  end: number;
}

export interface DeleteAcademicBlockInput {
  actorUserId: number;
}

export type FacilityScheduleItem =
  | {
      kind: "reservation";
      id: number;
      facilityId: number;
      start: number;
      end: number;
      purpose: string;
      userId: number;
      requesterName: string;
      requesterRole: UserRole;
    }
  | {
      kind: "academic";
      id: number;
      facilityId: number;
      start: number;
      end: number;
      title: string;
    };

export interface AvailabilityCheckResult {
  facilityId: number;
  start: number;
  end: number;
  available: boolean;
  conflict: FacilityScheduleItem | null;
}

export interface FacilityTreeNodeView {
  key: {
    start: number;
    id: string;
  };
  color: "red" | "black";
  parentId: string | null;
  leftId: string | null;
  rightId: string | null;
  depth: number;
  blackDepth: number;
  item: FacilityScheduleItem;
}

export interface FacilityTreeOperationEntry {
  sequence: number;
  timestamp: number;
  operation: "rebuild" | "insert" | "delete";
  keyId: string;
  summary: string;
  steps: string[];
}

export interface FacilityTreeSnapshotView {
  facilityId: number;
  size: number;
  height: number;
  blackHeight: number;
  invariantsValid: boolean;
  rootId: string | null;
  nodes: FacilityTreeNodeView[];
  operations: FacilityTreeOperationEntry[];
}

export interface FacilityTreeLookupView {
  facilityId: number;
  probeStart: number;
  probeEnd: number;
  predecessorId: string | null;
  successorId: string | null;
  lowerBoundId: string | null;
  conflictId: string | null;
  available: boolean;
}
