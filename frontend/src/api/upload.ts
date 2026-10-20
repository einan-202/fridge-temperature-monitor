import type {
  StagedMove,
  StagedNewFridge,
  StagedNewLogger,
  UploadOutcome,
  UploadSelections,
} from "../types/upload";

export interface WeeklyUploadRequest {
  files: File[];
  selections?: UploadSelections;
  newLoggers?: StagedNewLogger[];
  newFridges?: StagedNewFridge[];
  moves?: StagedMove[];
}

function buildWeeklyFormData(req: WeeklyUploadRequest): FormData {
  const form = new FormData();
  form.append("mode", "weekly");
  for (const file of req.files) {
    form.append("files", file, file.name);
  }
  form.append("selections", JSON.stringify(req.selections ?? {}));
  form.append("new_loggers", JSON.stringify(req.newLoggers ?? []));
  form.append("new_fridges", JSON.stringify(req.newFridges ?? []));
  form.append("moves", JSON.stringify(req.moves ?? []));
  return form;
}

async function postUpload(
  path: string,
  req: WeeklyUploadRequest,
): Promise<UploadOutcome> {
  const response = await fetch(path, {
    method: "POST",
    body: buildWeeklyFormData(req),
  });
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<UploadOutcome>;
}

export function reviewWeeklyUpload(req: WeeklyUploadRequest): Promise<UploadOutcome> {
  return postUpload("/api/uploads/review", req);
}

export function importWeeklyUpload(req: WeeklyUploadRequest): Promise<UploadOutcome> {
  return postUpload("/api/uploads/import", req);
}
