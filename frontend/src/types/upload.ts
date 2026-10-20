/** Types for POST /api/uploads/review and /import (weekly mode). */

export type FileUploadStatus =
  | "ready"
  | "imported"
  | "needs_attention"
  | "invalid"
  | "failed";

export interface UploadLoggerRef {
  id: number | null;
  code: string;
  source: string | null;
}

export interface UploadFridgeRef {
  id: number;
  branch: string;
  name: string;
}

export interface UploadFileResult {
  status: FileUploadStatus;
  file_index: number;
  filename: string;
  logger: UploadLoggerRef | null;
  fridges: UploadFridgeRef[];
  inserted: number;
  duplicates: number;
  conflicts: unknown[];
  fridge_conflicts: unknown[];
  mapping_mismatches: Array<{
    row_number: number;
    field: string;
    found: string;
    expected: string;
    message: string;
  }>;
  rejected: Array<{ row_number: number; reason: string }>;
  rejected_total: number;
  invalid_values: number;
  unit_converted: boolean;
  loggers_created: number;
  fridges_created: number;
  assignments_created: number;
  message: string | null;
  logger_column: Array<{ code: string; count: number }>;
  suggested_logger_code: string | null;
}

export interface StagedNewFridge {
  branch: string;
  name: string;
}

/** Existing fridge id, or `new:<index>` into staged new_fridges. */
export type FridgeRef = number | string;

export interface StagedNewLogger {
  code: string;
  unit: "C" | "F";
  fridge_id: FridgeRef;
}

export interface StagedMove {
  logger_id: number;
  fridge_id: FridgeRef;
  effective_at: string;
}

export interface UploadOutcome {
  mode: string;
  dry_run: boolean;
  files: UploadFileResult[];
  moves_applied: Array<Record<string, unknown>>;
  moves_rejected: Array<Record<string, unknown>>;
  new_loggers_created: Array<Record<string, unknown>>;
  new_loggers_rejected: Array<Record<string, unknown>>;
  new_fridges_created: Array<Record<string, unknown>>;
  new_fridges_rejected: Array<Record<string, unknown>>;
  blocked: boolean;
  message: string | null;
}

export interface LookupsResponse {
  loggers: Array<{ id: number; code: string; unit: string }>;
  fridges: Array<{ id: number; branch: string; name: string }>;
}

/** selections: file_index -> logger_id or "new:<CODE>" */
export type UploadSelections = Record<string, number | string>;
