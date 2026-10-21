import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InitialSetup } from "./InitialSetup";
import type { LoggerUnitInfo, UploadFileResult, UploadOutcome } from "../types/upload";

function emptyFileResult(partial: Partial<UploadFileResult> = {}): UploadFileResult {
  return {
    status: "needs_attention",
    file_index: 0,
    filename: "history.xlsx",
    logger: null,
    fridges: [],
    inserted: 0,
    duplicates: 0,
    conflicts: [],
    fridge_conflicts: [],
    mapping_mismatches: [],
    rejected: [],
    rejected_total: 0,
    invalid_values: 0,
    unit_converted: false,
    loggers_created: 0,
    fridges_created: 0,
    assignments_created: 0,
    message: null,
    logger_column: [],
    suggested_logger_code: null,
    ...partial,
  };
}

function outcome(partial: Partial<UploadOutcome> = {}): UploadOutcome {
  return {
    mode: "historical",
    dry_run: true,
    files: [emptyFileResult()],
    moves_applied: [],
    moves_rejected: [],
    new_loggers_created: [],
    new_loggers_rejected: [],
    new_fridges_created: [],
    new_fridges_rejected: [],
    blocked: false,
    message: null,
    ...partial,
  };
}

const tl0231: LoggerUnitInfo = {
  code: "TL-0231",
  unit: "F",
  source: "known",
  is_new: true,
  branch: "Haifa",
};

const tl0388: LoggerUnitInfo = {
  code: "TL-0388",
  unit: "C",
  source: "default",
  is_new: true,
  branch: "Rishon LeZion",
};

const tl0777: LoggerUnitInfo = {
  code: "TL-0777",
  unit: null,
  source: "unresolved",
  is_new: true,
  branch: "Haifa",
};

function mappingBody(loggers: LoggerUnitInfo[]): UploadOutcome {
  return outcome({
    blocked: true,
    files: [
      emptyFileResult({
        status: "needs_attention",
        message: "source unit required",
      }),
    ],
    logger_units: loggers,
    historical: {
      fridges: [
        { branch: "Haifa", name: "Dairy" },
        { branch: "Rishon LeZion", name: "Cream cakes" },
      ],
      missing_source_units: loggers.map((l) => ({ code: l.code, branch: l.branch })),
      logger_units: loggers,
    },
  });
}

function previewBody(sourceUnits: Record<string, string>): UploadOutcome {
  return outcome({
    blocked: false,
    dry_run: true,
    files: [
      emptyFileResult({
        status: "ready",
        inserted: 12,
        duplicates: 2,
        conflicts: [{ row: 4 }],
        rejected: [{ row_number: 9, reason: "not a time" }],
        rejected_total: 1,
      }),
    ],
    logger_units: [tl0231, tl0388],
    historical: {
      inserted: 12,
      duplicates: 2,
      conflicts: 1,
      fridge_conflicts: 0,
      rejected_total: 1,
      invalid_values: 0,
      fridges: [
        { branch: "Haifa", name: "Dairy" },
        { branch: "Rishon LeZion", name: "Cream cakes" },
      ],
      source_units: sourceUnits,
    },
  });
}

type FetchCall = { url: string; init?: RequestInit };

function parseUnits(form: FormData, field: string): Record<string, string> {
  return JSON.parse(String(form.get(field) || "{}")) as Record<string, string>;
}

function mockHistorical(handlers: {
  review?: UploadOutcome | ((form: FormData) => UploadOutcome);
  import?: UploadOutcome | ((form: FormData) => UploadOutcome);
}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "/api/uploads/review") {
        const form = init?.body as FormData;
        const body =
          typeof handlers.review === "function" ? handlers.review(form) : handlers.review!;
        return { ok: true, json: async () => body } as Response;
      }
      if (url === "/api/uploads/import") {
        const form = init?.body as FormData;
        const body =
          typeof handlers.import === "function" ? handlers.import(form) : handlers.import!;
        return { ok: true, json: async () => body } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }),
  );
  return calls;
}

function xlsx(name = "history.xlsx"): File {
  return new File(["fake"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function selectFile(file: File) {
  const input = screen.getByLabelText("Select historical Excel file");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  fireEvent.change(input);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InitialSetup", () => {
  it("rejects non-xlsx files", async () => {
    mockHistorical({});
    render(<InitialSetup />);
    expect(screen.getByRole("button", { name: "Select Excel file" })).toBeEnabled();
    expect(screen.getByText("No file selected yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Select historical Excel file")).toHaveAttribute(
      "accept",
      ".xlsx",
    );
    await selectFile(
      new File(["nope"], "notes.csv", { type: "text/csv" }),
    );
    expect(screen.getByText(/Only \.xlsx Excel files are supported/)).toBeInTheDocument();
    expect(screen.getByText("No file selected yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review file" })).toBeDisabled();
  });

  it("reviews mappings without writing and shows distinct fridge names", async () => {
    const calls = mockHistorical({
      review: mappingBody([tl0231, tl0388]),
    });
    render(<InitialSetup />);
    await selectFile(xlsx());
    expect(screen.getByText("history.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("No file selected yet.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review file" }));

    expect(await screen.findByRole("heading", { name: "2. Check fridges and temperature units" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Temperature units" })).toBeInTheDocument();
    expect(await screen.findByText("Haifa — Dairy")).toBeInTheDocument();
    expect(screen.getByText("Rishon LeZion — Cream cakes")).toBeInTheDocument();
    expect(screen.getByText("TL-0231")).toBeInTheDocument();
    expect(screen.getByText("TL-0388")).toBeInTheDocument();

    const reviewCall = calls.find((c) => c.url === "/api/uploads/review")!;
    const form = reviewCall.init!.body as FormData;
    expect(form.get("mode")).toBe("historical");
    expect((form.get("file") as File).name).toBe("history.xlsx");
    expect(parseUnits(form, "source_units")).toEqual({});
    expect(calls.some((c) => c.url === "/api/uploads/import")).toBe(false);
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });

  it("preselects suggested units and allows overriding TL-0231 to Celsius", async () => {
    const calls = mockHistorical({
      review: (form) => {
        const source = parseUnits(form, "source_units");
        if (Object.keys(source).length === 0) {
          return mappingBody([tl0231, tl0388]);
        }
        return previewBody(source);
      },
      import: outcome({
        dry_run: false,
        blocked: false,
        files: [emptyFileResult({ status: "imported", inserted: 12, duplicates: 2 })],
        historical: { inserted: 12, duplicates: 2, conflicts: 1, rejected_total: 1 },
        logger_units: [tl0231, tl0388],
      }),
    });
    const onDashboard = vi.fn();
    render(<InitialSetup onOpenDashboard={onDashboard} onOpenWeeklyUpload={vi.fn()} />);
    await selectFile(xlsx());
    await userEvent.click(screen.getByRole("button", { name: "Review file" }));
    expect(await screen.findByText("Usual device unit: Fahrenheit (kept as-is)")).toBeInTheDocument();

    const logger231 = screen.getByText("TL-0231").closest(".weekly-logger") as HTMLElement;
    const fahrenheit = within(logger231).getByRole("radio", { name: "Fahrenheit" });
    const celsius = within(logger231).getByRole("radio", { name: "Celsius" });
    expect(fahrenheit).toBeChecked();
    await userEvent.click(celsius);
    expect(celsius).toBeChecked();

    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByRole("button", { name: "Import" })).toBeEnabled();
    expect(screen.getByText(/New readings: 12/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate readings: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Conflicting readings: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Rows that could not be read: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Row 9: not a time/)).toBeInTheDocument();
    expect(screen.getByText(/1 conflict/)).toBeInTheDocument();

    const reviewCalls = calls.filter((c) => c.url === "/api/uploads/review");
    const previewCall = reviewCalls[reviewCalls.length - 1];
    const previewForm = previewCall.init!.body as FormData;
    expect(parseUnits(previewForm, "source_units")).toEqual({
      "TL-0231": "C",
      "TL-0388": "C",
    });
    expect(parseUnits(previewForm, "logger_units")).toEqual({});

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("heading", { name: "Import complete" });

    const importCall = calls.find((c) => c.url === "/api/uploads/import")!;
    const importForm = importCall.init!.body as FormData;
    expect(parseUnits(importForm, "source_units")).toEqual({
      "TL-0231": "C",
      "TL-0388": "C",
    });
    expect(parseUnits(importForm, "logger_units")).toEqual({});
    expect(importForm.get("mode")).toBe("historical");

    await userEvent.click(screen.getByRole("button", { name: "View dashboard" }));
    expect(onDashboard).toHaveBeenCalled();
  });

  it("requires an explicit unit for an unknown Haifa logger", async () => {
    mockHistorical({
      review: (form) => {
        const source = parseUnits(form, "source_units");
        if (Object.keys(source).length === 0) return mappingBody([tl0777]);
        return previewBody(source);
      },
    });
    render(<InitialSetup />);
    await selectFile(xlsx());
    await userEvent.click(screen.getByRole("button", { name: "Review file" }));
    expect(await screen.findByText("Usual device unit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();

    const row = screen.getByText("TL-0777").closest(".weekly-logger") as HTMLElement;
    const nativeF = within(row).getAllByRole("radio", { name: "Fahrenheit" })[0];
    await userEvent.click(nativeF);
    expect(screen.getByRole("button", { name: "Preview import" })).toBeEnabled();
  });

  it("keeps import disabled until a matching preview", async () => {
    mockHistorical({
      review: mappingBody([tl0231]),
    });
    render(<InitialSetup />);
    await selectFile(xlsx());
    await userEvent.click(screen.getByRole("button", { name: "Review file" }));
    await screen.findByText("TL-0231");
    expect(screen.getByText(/Import stays off until you preview/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });

  it("shows import errors from the API", async () => {
    mockHistorical({
      review: (form) => {
        const source = parseUnits(form, "source_units");
        if (Object.keys(source).length === 0) return mappingBody([tl0231]);
        return previewBody(source);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const form = init?.body as FormData;
        if (url === "/api/uploads/review") {
          const source = parseUnits(form, "source_units");
          const body =
            Object.keys(source).length === 0 ? mappingBody([tl0231]) : previewBody(source);
          return { ok: true, json: async () => body } as Response;
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: "server exploded" }),
        } as Response;
      }),
    );
    render(<InitialSetup />);
    await selectFile(xlsx());
    await userEvent.click(screen.getByRole("button", { name: "Review file" }));
    await userEvent.click(await screen.findByRole("button", { name: "Preview import" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("server exploded");
  });

  it("does not call import when only reviewing", async () => {
    const calls = mockHistorical({
      review: mappingBody([tl0231]),
    });
    render(<InitialSetup />);
    await selectFile(xlsx());
    await userEvent.click(screen.getByRole("button", { name: "Review file" }));
    await screen.findByText("TL-0231");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/uploads/review")).toBe(true));
    expect(calls.some((c) => c.url === "/api/uploads/import")).toBe(false);
  });
});
