import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeeklyUpload } from "./WeeklyUpload";
import type { LookupsResponse, UploadOutcome } from "../types/upload";

const lookups: LookupsResponse = {
  loggers: [
    { id: 1, code: "TL-0417", unit: "C" },
    { id: 2, code: "TL-0231", unit: "F" },
  ],
  fridges: [
    { id: 10, branch: "Tel Aviv", name: "Walk-in" },
    { id: 11, branch: "Haifa", name: "Display" },
  ],
};

function emptyOutcome(partial: Partial<UploadOutcome> & { files: UploadOutcome["files"] }): UploadOutcome {
  return {
    mode: "weekly",
    dry_run: true,
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

function readyFile(index: number, filename: string, inserted = 12): UploadOutcome["files"][0] {
  return {
    status: "ready",
    file_index: index,
    filename,
    logger: { id: 1, code: "TL-0417", source: "filename" },
    fridges: [{ id: 10, branch: "Tel Aviv", name: "Walk-in" }],
    inserted,
    duplicates: 2,
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
  };
}

function needsLoggerFile(index: number, filename: string): UploadOutcome["files"][0] {
  return {
    status: "needs_attention",
    file_index: index,
    filename,
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
    message: "logger not identified; select a logger or register a new one",
    logger_column: [],
    suggested_logger_code: null,
  };
}

type FetchCall = { url: string; init?: RequestInit };

function mockApi(handlers: {
  lookups?: LookupsResponse | (() => LookupsResponse);
  review?: UploadOutcome | ((form: FormData) => UploadOutcome);
  import?: UploadOutcome | ((form: FormData) => UploadOutcome);
}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "/api/lookups") {
        const body =
          typeof handlers.lookups === "function"
            ? handlers.lookups()
            : (handlers.lookups ?? lookups);
        return { ok: true, json: async () => body } as Response;
      }
      if (url === "/api/uploads/review") {
        const form = init?.body as FormData;
        const body =
          typeof handlers.review === "function"
            ? handlers.review(form)
            : handlers.review!;
        return { ok: true, json: async () => body } as Response;
      }
      if (url === "/api/uploads/import") {
        const form = init?.body as FormData;
        const body =
          typeof handlers.import === "function"
            ? handlers.import(form)
            : handlers.import!;
        return { ok: true, json: async () => body } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }),
  );
  return calls;
}

function xlsx(name: string): File {
  return new File(["fake"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function filesFromForm(form: FormData): File[] {
  return form.getAll("files") as File[];
}

function reviewFilesByName(
  uploaded: File[],
  readyNames: Record<string, number> = {},
): UploadOutcome["files"] {
  return uploaded.map((file, index) =>
    Object.prototype.hasOwnProperty.call(readyNames, file.name)
      ? readyFile(index, file.name, readyNames[file.name])
      : needsLoggerFile(index, file.name),
  );
}

async function selectFiles(files: File[]) {
  const input = screen.getByLabelText("Select Excel logger files");
  // fireEvent keeps non-.xlsx files (userEvent.upload respects accept= and drops them)
  Object.defineProperty(input, "files", { configurable: true, value: files });
  fireEvent.change(input);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WeeklyUpload", () => {
  it("shows selected filenames and count, then reviews via API", async () => {
    const reviewBody = emptyOutcome({
      files: [
        readyFile(0, "TL-0417_week.xlsx"),
        needsLoggerFile(1, "mystery.xlsx"),
      ],
    });
    const calls = mockApi({ review: reviewBody });

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");

    await selectFiles([xlsx("TL-0417_week.xlsx"), xlsx("mystery.xlsx")]);

    expect(screen.getByText("2 files selected")).toBeInTheDocument();
    expect(screen.getByText("TL-0417_week.xlsx")).toBeInTheDocument();
    expect(screen.getByText("mystery.xlsx")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review 2 files" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/uploads/review")).toBe(true);
    });

    const reviewCall = calls.find((c) => c.url === "/api/uploads/review")!;
    const form = reviewCall.init!.body as FormData;
    expect(form.get("mode")).toBe("weekly");
    expect(form.getAll("files")).toHaveLength(2);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText(/1 ready to import/)).toBeInTheDocument();
    expect(screen.getByText(/1 needs attention/)).toBeInTheDocument();

    // Ready section collapsed by default — counts hidden until expanded
    expect(screen.queryByText(/Would insert 12 readings/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Ready to import \(1\)/ }));
    expect(screen.getByText(/Would insert 12 readings/)).toBeInTheDocument();
    expect(screen.getByText(/2 duplicates skipped/)).toBeInTheDocument();

    // Needs attention shown with plain issue
    expect(
      screen.getByText(/logger not identified; select a logger or register a new one/),
    ).toBeInTheDocument();
  });

  it("skips unsupported non-xlsx files", async () => {
    mockApi({});
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");

    await selectFiles([
      xlsx("good.xlsx"),
      new File(["x"], "notes.csv", { type: "text/csv" }),
    ]);

    expect(screen.getByText("1 file selected")).toBeInTheDocument();
    expect(screen.getByText(/skipped — only .xlsx/)).toBeInTheDocument();
  });

  it("re-reviews after selecting an existing logger", async () => {
    let reviewCount = 0;
    const calls = mockApi({
      review: (form) => {
        reviewCount += 1;
        const selections = JSON.parse(String(form.get("selections") || "{}")) as Record<
          string,
          unknown
        >;
        if (reviewCount === 1) {
          return emptyOutcome({ files: [needsLoggerFile(0, "unknown.xlsx")] });
        }
        expect(selections["0"]).toBe(1);
        return emptyOutcome({
          files: [
            {
              ...readyFile(0, "unknown.xlsx", 5),
              logger: { id: 1, code: "TL-0417", source: "selection" },
            },
          ],
        });
      },
    });

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("unknown.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    const select = screen.getByLabelText("Select logger");
    await userEvent.selectOptions(select, "1");

    await waitFor(() => expect(reviewCount).toBe(2));
    expect(calls.filter((c) => c.url === "/api/uploads/review")).toHaveLength(2);
    expect(await screen.findByRole("button", { name: /Import 1 ready file/ })).toBeEnabled();
  });

  it("stages a new logger with unit and fridge, then re-reviews", async () => {
    let reviewCount = 0;
    mockApi({
      review: (form) => {
        reviewCount += 1;
        if (reviewCount === 1) {
          return emptyOutcome({ files: [needsLoggerFile(0, "brand_new.xlsx")] });
        }
        const selections = JSON.parse(String(form.get("selections") || "{}"));
        const newLoggers = JSON.parse(String(form.get("new_loggers") || "[]"));
        expect(selections["0"]).toBe("new:TL-9001");
        expect(newLoggers).toEqual([
          { code: "TL-9001", unit: "F", fridge_id: 11 },
        ]);
        return emptyOutcome({
          files: [
            {
              ...readyFile(0, "brand_new.xlsx", 3),
              logger: { id: null, code: "TL-9001", source: "new" },
            },
          ],
        });
      },
    });

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("brand_new.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));

    await userEvent.click(await screen.findByLabelText("Add new logger"));

    const codeInput = screen.getByLabelText("Editable logger code");
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, "TL-9001");
    await userEvent.click(screen.getByLabelText("Fahrenheit (F)"));
    await userEvent.selectOptions(screen.getByLabelText("Fridge"), "11");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm logger and review again" }),
    );

    await waitFor(() => expect(reviewCount).toBe(2));
    expect(await screen.findByText(/Staged new loggers/)).toBeInTheDocument();
    expect(screen.getByText(/TL-9001 · F · Haifa — Display/)).toBeInTheDocument();
  });

  it("imports ready files and keeps unresolved files available", async () => {
    mockApi({
      review: (form) =>
        emptyOutcome({
          files: filesFromForm(form).map((file, index) =>
            file.name === "good.xlsx"
              ? {
                  ...readyFile(index, "good.xlsx", 10),
                  duplicates: 1,
                  conflicts: [{ row_number: 3 }],
                }
              : needsLoggerFile(index, file.name),
          ),
        }),
      import: (form) =>
        emptyOutcome({
          dry_run: false,
          files: filesFromForm(form).map((file, index) =>
            file.name === "good.xlsx"
              ? {
                  ...readyFile(index, "good.xlsx", 10),
                  status: "imported",
                  duplicates: 1,
                  conflicts: [{ row_number: 3 }],
                }
              : needsLoggerFile(index, file.name),
          ),
        }),
    });

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("good.xlsx"), xlsx("bad.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));

    const importBtn = await screen.findByRole("button", {
      name: /Import 1 ready file/,
    });
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);

    expect(await screen.findByText("Import results")).toBeInTheDocument();
    expect(screen.getByText(/10 readings saved/)).toBeInTheDocument();
    expect(screen.getByText(/1 duplicate skipped/)).toBeInTheDocument();
    expect(screen.getByText(/1 conflict/)).toBeInTheDocument();

    // Unresolved file preserved for further correction
    expect(screen.getAllByText(/still needs? attention/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("bad.xlsx").length).toBeGreaterThan(0);
    expect(screen.getByText(/remain(?:s)? in the batch below/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Needs attention" }),
    ).toBeInTheDocument();
  });

  it("shows network failure from review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/lookups") {
          return { ok: true, json: async () => lookups } as Response;
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: "server exploded" }),
        } as Response;
      }),
    );

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("a.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("server exploded");
  });

  it("prompts for Initial Setup when no loggers exist", async () => {
    mockApi({ lookups: { loggers: [], fridges: [] } });
    render(<WeeklyUpload />);
    expect(
      await screen.findByText(/No loggers are registered yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review files" })).toBeDisabled();
  });

  it("prevents double import clicks", async () => {
    let importStarted = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/lookups") {
          return { ok: true, json: async () => lookups } as Response;
        }
        if (url === "/api/uploads/review") {
          return {
            ok: true,
            json: async () => emptyOutcome({ files: [readyFile(0, "one.xlsx")] }),
          } as Response;
        }
        if (url === "/api/uploads/import") {
          importStarted += 1;
          await new Promise((r) => setTimeout(r, 80));
          return {
            ok: true,
            json: async () =>
              emptyOutcome({
                dry_run: false,
                files: [{ ...readyFile(0, "one.xlsx"), status: "imported" }],
              }),
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }),
    );

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("one.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    const btn = await screen.findByRole("button", { name: /Import 1 ready file/ });
    await userEvent.click(btn);
    await userEvent.click(btn);
    await waitFor(() => expect(importStarted).toBe(1));
    expect(await screen.findByText("Import finished")).toBeInTheDocument();
  });

  it("renders Needs attention before Ready section", async () => {
    mockApi({
      review: emptyOutcome({
        files: [readyFile(0, "ready.xlsx"), needsLoggerFile(1, "fix.xlsx")],
      }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("ready.xlsx"), xlsx("fix.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));

    const needs = await screen.findByText("Needs attention");
    const ready = screen.getByRole("button", { name: /Ready to import/ });
    expect(
      needs.compareDocumentPosition(ready) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const attentionCard = screen
      .getAllByText("fix.xlsx")
      .map((el) => el.closest("article"))
      .find((el) => el?.classList.contains("weekly-file--attention"));
    expect(attentionCard).toBeTruthy();
    expect(within(attentionCard!).getByText(/logger not identified/)).toBeInTheDocument();
  });

  it("prefills the extracted logger code from a typical filename", async () => {
    mockApi({});
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("07_TL-0777_Haifa_NEW_Temp_Time.xlsx")]);
    expect(screen.getByText("From file name: TL-0777")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Logger code for 07_TL-0777_Haifa_NEW_Temp_Time.xlsx"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Edit logger code for 07_TL-0777_Haifa_NEW_Temp_Time.xlsx",
      }),
    );
    expect(
      screen.getByLabelText("Logger code for 07_TL-0777_Haifa_NEW_Temp_Time.xlsx"),
    ).toHaveValue("TL-0777");
  });

  it("lists selected files compactly in natural filename order", async () => {
    mockApi({});
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([
      xlsx("10_TL-0100.xlsx"),
      xlsx("02_generic.xlsx"),
      xlsx("01_TL-0101.xlsx"),
    ]);
    const names = [...document.querySelectorAll(".weekly__picked-name")].map(
      (node) => node.textContent,
    );
    expect(names).toEqual(["01_TL-0101.xlsx", "02_generic.xlsx", "10_TL-0100.xlsx"]);
    expect(screen.getByText("From file name: TL-0101")).toBeInTheDocument();
    expect(screen.getByText("From file name: TL-0100")).toBeInTheDocument();
    expect(screen.getByText("Check during review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review 3 files" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Logger code for/)).not.toBeInTheDocument();
  });

  it("sends a corrected logger code as an existing logger on review", async () => {
    const calls = mockApi({
      review: emptyOutcome({
        files: [
          {
            ...readyFile(0, "07_TL-0777_Haifa_NEW_Temp_Time.xlsx", 4),
            logger: { id: 2, code: "TL-0231", source: "selection" },
          },
        ],
      }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("07_TL-0777_Haifa_NEW_Temp_Time.xlsx")]);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Edit logger code for 07_TL-0777_Haifa_NEW_Temp_Time.xlsx",
      }),
    );
    const codeInput = screen.getByLabelText(
      "Logger code for 07_TL-0777_Haifa_NEW_Temp_Time.xlsx",
    );
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, "TL-0231");
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/uploads/review")).toBe(true);
    });
    const form = calls.find((c) => c.url === "/api/uploads/review")!.init!.body as FormData;
    expect(JSON.parse(String(form.get("selections")))).toEqual({ "0": 2 });
    expect(JSON.parse(String(form.get("new_loggers")))).toEqual([]);
  });

  it("requires a logger when the filename has none", async () => {
    mockApi({
      review: emptyOutcome({ files: [needsLoggerFile(0, "random_export.xlsx")] }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("random_export.xlsx")]);
    expect(screen.getByText("Check during review")).toBeInTheDocument();
    expect(screen.queryByText(/No logger code found in the file name/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Logger code for random_export.xlsx"),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByLabelText("Select existing logger")).toBeChecked();
  });

  it("stages a new fridge with a new logger", async () => {
    let reviewCount = 0;
    mockApi({
      review: (form) => {
        reviewCount += 1;
        if (reviewCount === 1) {
          return emptyOutcome({
            files: [needsLoggerFile(0, "07_TL-0777_Haifa_NEW_Temp_Time.xlsx")],
          });
        }
        expect(JSON.parse(String(form.get("new_fridges")))).toEqual([
          { branch: "Haifa", name: "Walk-in 3" },
        ]);
        expect(JSON.parse(String(form.get("new_loggers")))).toEqual([
          { code: "TL-0777", unit: "C", fridge_id: "new:0" },
        ]);
        expect(JSON.parse(String(form.get("selections")))).toEqual({
          "0": "new:TL-0777",
        });
        return emptyOutcome({
          files: [
            {
              ...readyFile(0, "07_TL-0777_Haifa_NEW_Temp_Time.xlsx", 3),
              logger: { id: null, code: "TL-0777", source: "new" },
            },
          ],
        });
      },
    });

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("07_TL-0777_Haifa_NEW_Temp_Time.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    expect(await screen.findByLabelText("Add new logger")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Celsius (C)"));
    await userEvent.click(screen.getByLabelText("Add new fridge"));
    await userEvent.selectOptions(screen.getByLabelText("City"), "Haifa");
    await userEvent.type(screen.getByLabelText("New fridge name"), "Walk-in 3");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm logger and review again" }),
    );
    await waitFor(() => expect(reviewCount).toBe(2));
    expect(screen.getByText(/Staged new fridges/)).toBeInTheDocument();
    expect(screen.getAllByText(/Haifa — Walk-in 3 \(new\)/).length).toBeGreaterThan(0);
  });

  it("blocks adding a fridge that already exists in the same city", async () => {
    mockApi({
      review: emptyOutcome({ files: [needsLoggerFile(0, "brand_new.xlsx")] }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("brand_new.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await userEvent.click(await screen.findByLabelText("Add new logger"));
    await userEvent.type(screen.getByLabelText("Editable logger code"), "TL-9001");
    await userEvent.click(screen.getByLabelText("Celsius (C)"));
    await userEvent.click(screen.getByLabelText("Add new fridge"));
    await userEvent.selectOptions(screen.getByLabelText("City"), "Haifa");
    await userEvent.type(screen.getByLabelText("New fridge name"), "display");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm logger and review again" }),
    );
    expect(
      await screen.findByText(/already exists in this city/i),
    ).toBeInTheDocument();
  });

  it("records a move of an existing logger onto a new fridge", async () => {
    let reviewCount = 0;
    mockApi({
      review: (form) => {
        reviewCount += 1;
        if (reviewCount === 1) {
          return emptyOutcome({ files: [readyFile(0, "TL-0417_week.xlsx")] });
        }
        expect(JSON.parse(String(form.get("new_fridges")))).toEqual([
          { branch: "Tel Aviv", name: "Overflow" },
        ]);
        expect(JSON.parse(String(form.get("moves")))).toEqual([
          {
            logger_id: 1,
            fridge_id: "new:0",
            effective_at: "2026-09-01 06:00:00",
          },
        ]);
        return emptyOutcome({ files: [readyFile(0, "TL-0417_week.xlsx")] });
      },
    });

    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("TL-0417_week.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Record a logger move/ }));
    await userEvent.selectOptions(screen.getByLabelText("Logger"), "1");
    await userEvent.click(screen.getByLabelText("Add new fridge"));
    await userEvent.selectOptions(screen.getByLabelText("City"), "Tel Aviv");
    await userEvent.type(screen.getByLabelText("New fridge name"), "Overflow");
    fireEvent.change(screen.getByLabelText("Effective date and time"), {
      target: { value: "2026-09-01T06:00" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Add move and review again" }),
    );
    await waitFor(() => expect(reviewCount).toBe(2));
  });

  it("proposes a consistent Logger-column code without silently selecting it", async () => {
    mockApi({
      review: emptyOutcome({
        files: [
          {
            ...needsLoggerFile(0, "04_logger_in_column_generic_filename.xlsx"),
            suggested_logger_code: "TL-0388",
            logger_column: [{ code: "TL-0388", count: 20 }],
            message:
              "logger not identified; select a logger or register a new one. The Logger column consistently contains TL-0388.",
          },
        ],
      }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("04_logger_in_column_generic_filename.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    expect(await screen.findByText(/Suggested logger from the spreadsheet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use TL-0388" })).toBeInTheDocument();
    expect(screen.getByText("Check during review")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(
        "Logger code for 04_logger_in_column_generic_filename.xlsx",
      ),
    ).not.toBeInTheDocument();
  });

  it("collapses repeated logger mismatches behind a summary", async () => {
    const mismatches = Array.from({ length: 20 }, (_, i) => ({
      row_number: i + 2,
      field: "Logger",
      found: "TL-0388",
      expected: "TL-0512",
      message: "row",
    }));
    mockApi({
      review: emptyOutcome({
        files: [
          {
            ...needsLoggerFile(0, "04_logger_in_column_generic_filename.xlsx"),
            logger: { id: 1, code: "TL-0512", source: "selection" },
            suggested_logger_code: "TL-0388",
            mapping_mismatches: mismatches,
            message: "20 rows contain TL-0388, but TL-0512 was selected.",
          },
        ],
      }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("04_logger_in_column_generic_filename.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    expect(
      await screen.findByText("20 rows contain TL-0388, but TL-0512 was selected."),
    ).toBeInTheDocument();
    const details = screen.getByText("Show affected rows (20)").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Show affected rows (20)"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByText(/Row 2:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change logger" })).toBeInTheDocument();
  });

  it("removes one file without dropping the rest", async () => {
    mockApi({
      review: (form) => {
        const uploaded = filesFromForm(form);
        return emptyOutcome({
          files: reviewFilesByName(uploaded, { "keep.xlsx": 12 }),
        });
      },
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("keep.xlsx"), xlsx("drop.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await screen.findByText("Needs attention");
    const dropCard = screen
      .getAllByText("drop.xlsx")
      .map((el) => el.closest("article"))
      .find(Boolean)!;
    await userEvent.click(within(dropCard).getByRole("button", { name: "Remove file" }));
    expect(await screen.findByText(/Removed drop.xlsx/)).toBeInTheDocument();
    expect(screen.getAllByText("keep.xlsx").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "drop.xlsx" })).not.toBeInTheDocument();
  });

  it("replaces one file and keeps the other", async () => {
    mockApi({
      review: (form) =>
        emptyOutcome({
          files: reviewFilesByName(filesFromForm(form), { "keep.xlsx": 12 }),
        }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("keep.xlsx"), xlsx("old.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await screen.findByText("Needs attention");
    const oldCard = screen
      .getAllByText("old.xlsx")
      .map((el) => el.closest("article"))
      .find(Boolean)!;
    await userEvent.click(within(oldCard).getByRole("button", { name: "Replace file" }));
    const replaceInput = screen.getByLabelText("Replace one Excel logger file");
    fireEvent.change(replaceInput, { target: { files: [xlsx("fixed.xlsx")] } });
    expect(await screen.findByText(/Replaced old.xlsx with fixed.xlsx/)).toBeInTheDocument();
    expect(screen.getAllByText("keep.xlsx").length).toBeGreaterThan(0);
  });

  it("imports ready files while another file stays unresolved", async () => {
    mockApi({
      review: (form) =>
        emptyOutcome({
          files: reviewFilesByName(filesFromForm(form), { "good.xlsx": 8 }),
        }),
      import: (form) =>
        emptyOutcome({
          dry_run: false,
          files: filesFromForm(form).map((file, index) =>
            file.name === "good.xlsx"
              ? { ...readyFile(index, "good.xlsx", 8), status: "imported" }
              : needsLoggerFile(index, file.name),
          ),
        }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("good.xlsx"), xlsx("bad.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Import 1 ready file/ }));
    expect(await screen.findByText("Import results")).toBeInTheDocument();
    expect(screen.getByText(/8 readings saved/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    expect(screen.getAllByText("bad.xlsx").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "good.xlsx" })).not.toBeInTheDocument();
    expect(screen.getByText("1 file selected")).toBeInTheDocument();
    expect(screen.queryByText(/No files selected yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add more Excel files" })).toBeInTheDocument();
    const input = screen.getByLabelText("Select Excel logger files") as HTMLInputElement;
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0]?.name).toBe("bad.xlsx");
  });

  it("lets the user correct an unresolved file after import without picking it again", async () => {
    let reviewN = 0;
    const calls = mockApi({
      review: (form) => {
        reviewN += 1;
        const uploaded = form.getAll("files") as File[];
        if (reviewN === 1) {
          return emptyOutcome({
            files: reviewFilesByName(uploaded, { "good.xlsx": 8 }),
          });
        }
        expect(uploaded).toHaveLength(1);
        expect(uploaded[0].name).toBe("bad.xlsx");
        const selections = JSON.parse(String(form.get("selections") || "{}")) as Record<
          string,
          number
        >;
        if (selections["0"] === 1) {
          return emptyOutcome({
            files: [
              {
                ...readyFile(0, "bad.xlsx", 4),
                logger: { id: 1, code: "TL-0417", source: "selection" },
              },
            ],
          });
        }
        return emptyOutcome({ files: [needsLoggerFile(0, "bad.xlsx")] });
      },
      import: (form) =>
        emptyOutcome({
          dry_run: false,
          files: filesFromForm(form).map((file, index) =>
            file.name === "good.xlsx"
              ? { ...readyFile(index, "good.xlsx", 8), status: "imported" }
              : needsLoggerFile(index, file.name),
          ),
        }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("good.xlsx"), xlsx("bad.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Import 1 ready file/ }));
    expect(await screen.findByText("1 file selected")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Select logger"), "1");
    expect(
      await screen.findByRole("button", { name: /Import 1 ready file/ }),
    ).toBeInTheDocument();
    const lastReview = [...calls].reverse().find((c) => c.url === "/api/uploads/review")!;
    const lastFiles = (lastReview.init!.body as FormData).getAll("files") as File[];
    expect(lastFiles.map((f) => f.name)).toEqual(["bad.xlsx"]);
  });

  it("labels a duplicate-only import as already imported", async () => {
    mockApi({
      review: emptyOutcome({
        files: [{ ...readyFile(0, "dup.xlsx", 0), duplicates: 20 }],
      }),
      import: emptyOutcome({
        dry_run: false,
        files: [
          {
            ...readyFile(0, "dup.xlsx", 0),
            status: "imported",
            duplicates: 20,
          },
        ],
      }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("dup.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Import 1 ready file/ }));
    expect(await screen.findByText("Already imported")).toBeInTheDocument();
    expect(screen.getByText(/All readings were duplicates/)).toBeInTheDocument();
    expect(screen.getByText(/No files selected yet/)).toBeInTheDocument();
    const input = screen.getByLabelText("Select Excel logger files") as HTMLInputElement;
    expect(input.files).toHaveLength(0);
  });

  it("does not send already imported files on the next import", async () => {
    let importN = 0;
    const calls = mockApi({
      review: (form) => {
        const uploaded = form.getAll("files") as File[];
        const selections = JSON.parse(String(form.get("selections") || "{}")) as Record<
          string,
          number
        >;
        if (uploaded.length === 2) {
          return emptyOutcome({
            files: reviewFilesByName(uploaded, { "good.xlsx": 8 }),
          });
        }
        if (selections["0"] === 1) {
          return emptyOutcome({
            files: [
              {
                ...readyFile(0, "bad.xlsx", 4),
                logger: { id: 1, code: "TL-0417", source: "selection" },
              },
            ],
          });
        }
        return emptyOutcome({ files: [needsLoggerFile(0, "bad.xlsx")] });
      },
      import: (form) => {
        importN += 1;
        const uploaded = form.getAll("files") as File[];
        if (importN === 1) {
          expect(uploaded.map((f) => f.name).sort()).toEqual(["bad.xlsx", "good.xlsx"]);
          return emptyOutcome({
            dry_run: false,
            files: uploaded.map((file, index) =>
              file.name === "good.xlsx"
                ? { ...readyFile(index, "good.xlsx", 8), status: "imported" }
                : needsLoggerFile(index, file.name),
            ),
          });
        }
        expect(uploaded.map((f) => f.name)).toEqual(["bad.xlsx"]);
        return emptyOutcome({
          dry_run: false,
          files: [{ ...readyFile(0, "bad.xlsx", 4), status: "imported" }],
        });
      },
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("good.xlsx"), xlsx("bad.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Import 1 ready file/ }));
    await userEvent.selectOptions(
      await screen.findByLabelText("Select logger"),
      "1",
    );
    await userEvent.click(await screen.findByRole("button", { name: /Import 1 ready file/ }));
    expect(await screen.findByText(/4 readings saved/)).toBeInTheDocument();
    const importCalls = calls.filter((c) => c.url === "/api/uploads/import");
    expect(importCalls).toHaveLength(2);
  });

  it("does not propose a logger when the Logger column has mixed codes", async () => {
    mockApi({
      review: emptyOutcome({
        files: [
          {
            ...needsLoggerFile(0, "mixed_loggers.xlsx"),
            logger_column: [
              { code: "TL-0388", count: 1 },
              { code: "TL-0512", count: 1 },
            ],
            message:
              "logger not identified; select a logger or register a new one. The Logger column has mixed codes: TL-0388 (1), TL-0512 (1).",
          },
        ],
      }),
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("mixed_loggers.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    expect(await screen.findByText(/mixed codes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use TL-/ })).not.toBeInTheDocument();
  });

  it("corrects a conflicting logger and re-reviews that file", async () => {
    const extraLookups: LookupsResponse = {
      ...lookups,
      loggers: [
        ...lookups.loggers,
        { id: 3, code: "TL-0388", unit: "C" },
        { id: 4, code: "TL-0512", unit: "C" },
      ],
    };
    let reviewN = 0;
    mockApi({
      lookups: extraLookups,
      review: (form) => {
        reviewN += 1;
        const selections = JSON.parse(String(form.get("selections") || "{}")) as Record<
          string,
          number
        >;
        if (reviewN === 1) {
          return emptyOutcome({
            files: [
              {
                ...needsLoggerFile(0, "generic.xlsx"),
                logger: { id: 4, code: "TL-0512", source: "selection" },
                suggested_logger_code: "TL-0388",
                mapping_mismatches: [
                  {
                    row_number: 2,
                    field: "Logger",
                    found: "TL-0388",
                    expected: "TL-0512",
                    message: "row",
                  },
                ],
                message: "1 row contains TL-0388, but TL-0512 was selected.",
              },
            ],
          });
        }
        expect(selections["0"]).toBe(3);
        return emptyOutcome({
          files: [
            {
              ...readyFile(0, "generic.xlsx", 5),
              logger: { id: 3, code: "TL-0388", source: "selection" },
            },
          ],
        });
      },
    });
    render(<WeeklyUpload />);
    await screen.findByText("Weekly Upload");
    await selectFiles([xlsx("generic.xlsx")]);
    await userEvent.click(screen.getByRole("button", { name: /Review \d+ files?/ }));
    expect(
      await screen.findByText("1 row contains TL-0388, but TL-0512 was selected."),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Select logger"), "3");
    expect(
      await screen.findByRole("button", { name: /Import 1 ready file/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Needs attention" })).not.toBeInTheDocument();
  });
});
