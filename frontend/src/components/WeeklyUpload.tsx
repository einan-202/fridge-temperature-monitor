import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLookups } from "../api/lookups";
import { importWeeklyUpload, reviewWeeklyUpload } from "../api/upload";
import type {
  FridgeRef,
  LookupsResponse,
  StagedMove,
  StagedNewFridge,
  StagedNewLogger,
  UploadFileResult,
  UploadOutcome,
  UploadSelections,
} from "../types/upload";
import {
  remapKeyedByFileIdentity,
  remapRecordByFileIdentity,
  sortFilesNaturally,
} from "../upload/filenameSort";
import { extractLoggerCode } from "../upload/loggerCode";
import { groupMappingMismatches, loggerMismatchHeadline } from "../upload/mismatches";

type Phase = "pick" | "review" | "results";

const NEW_LOGGER_VALUE = "__new__";
const NEW_FRIDGE_VALUE = "__new_fridge__";

type FridgeChoice = {
  mode: "existing" | "new";
  fridgeId: string;
  branch: string;
  name: string;
};

type NewLoggerForm = {
  mode: "existing" | "new";
  code: string;
  unit: "" | "C" | "F";
  fridge: FridgeChoice;
  errors: { code?: string; unit?: string; fridge?: string };
};

function emptyFridgeChoice(): FridgeChoice {
  return { mode: "existing", fridgeId: "", branch: "", name: "" };
}

function emptyNewForm(
  code = "",
  mode: "existing" | "new" = "existing",
): NewLoggerForm {
  return { mode, code, unit: "", fridge: emptyFridgeChoice(), errors: {} };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findLoggerByCode(
  lookups: LookupsResponse | null,
  code: string,
): LookupsResponse["loggers"][0] | undefined {
  const key = code.trim().toLowerCase();
  if (!key || !lookups) return undefined;
  return lookups.loggers.find((l) => l.code.toLowerCase() === key);
}

function uniqueBranches(fridges: LookupsResponse["fridges"]): string[] {
  return [...new Set(fridges.map((f) => f.branch))].sort((a, b) => a.localeCompare(b));
}

function fridgeAlreadyExists(
  lookups: LookupsResponse | null,
  staged: StagedNewFridge[],
  branch: string,
  name: string,
): "existing" | "staged" | null {
  if (!branch.trim() || !name.trim()) return null;
  if (
    lookups?.fridges.some(
      (f) => sameName(f.branch, branch) && sameName(f.name, name),
    )
  ) {
    return "existing";
  }
  if (staged.some((f) => sameName(f.branch, branch) && sameName(f.name, name))) {
    return "staged";
  }
  return null;
}

function resolveFridgeRef(
  lookups: LookupsResponse | null,
  staged: StagedNewFridge[],
  choice: FridgeChoice,
): { ref?: FridgeRef; staged: StagedNewFridge[]; error?: string } {
  if (choice.mode === "existing") {
    if (!choice.fridgeId) return { staged, error: "Select a fridge." };
    return { ref: Number(choice.fridgeId), staged };
  }
  if (!choice.branch.trim()) return { staged, error: "Select a city." };
  if (!choice.name.trim()) return { staged, error: "Enter the new fridge name." };
  const duplicate = fridgeAlreadyExists(lookups, staged, choice.branch, choice.name);
  if (duplicate === "existing") {
    return {
      staged,
      error: "That fridge already exists in this city. Select it instead.",
    };
  }
  if (duplicate === "staged") {
    const index = staged.findIndex(
      (f) => sameName(f.branch, choice.branch) && sameName(f.name, choice.name),
    );
    return { ref: `new:${index}`, staged };
  }
  const next = [...staged, { branch: choice.branch.trim(), name: choice.name.trim() }];
  return { ref: `new:${next.length - 1}`, staged: next };
}

function isXlsx(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx");
}

function isCompletedImport(file: UploadFileResult): boolean {
  return file.status === "imported";
}

function isAlreadyImported(file: UploadFileResult): boolean {
  return file.status === "imported" && file.inserted === 0 && file.duplicates > 0;
}

function syncNativeFileInput(input: HTMLInputElement | null, next: File[]): void {
  if (!input) return;
  try {
    const transfer = new DataTransfer();
    for (const file of next) transfer.items.add(file);
    input.files = transfer.files;
  } catch {
    try {
      Object.defineProperty(input, "files", { configurable: true, value: next });
    } catch {
      /* jsdom / older browsers */
    }
  }
  if (next.length === 0) input.value = "";
}

function remainingFilesAfterImport(currentFiles: File[], result: UploadOutcome): File[] {
  const completed = new Set(
    result.files.filter(isCompletedImport).map((file) => file.file_index),
  );
  return sortFilesNaturally(currentFiles.filter((_, index) => !completed.has(index)));
}

function codesFromFilenames(nextFiles: File[]): Record<number, string> {
  const codes: Record<number, string> = {};
  nextFiles.forEach((file, index) => {
    codes[index] = extractLoggerCode(file.name) ?? "";
  });
  return codes;
}

function formsFromFiles(
  nextFiles: File[],
  lookups: LookupsResponse | null,
): Record<number, NewLoggerForm> {
  const forms: Record<number, NewLoggerForm> = {};
  nextFiles.forEach((file, index) => {
    const suggested = extractLoggerCode(file.name) ?? "";
    const known = findLoggerByCode(lookups, suggested);
    forms[index] = emptyNewForm(suggested, suggested && !known ? "new" : "existing");
  });
  return forms;
}

function loggerSourceLabel(source: string | null): string {
  if (source === "filename") return "from file name";
  if (source === "selection") return "you selected";
  if (source === "new") return "new logger";
  return source ?? "";
}

function fridgeLabel(f: { branch: string; name: string }): string {
  return `${f.branch} — ${f.name}`;
}

function describeFridgeRef(
  ref: FridgeRef,
  lookups: LookupsResponse | null,
  staged: StagedNewFridge[],
): string {
  if (typeof ref === "string" && ref.startsWith("new:")) {
    const fridge = staged[Number(ref.slice(4))];
    return fridge ? `${fridgeLabel(fridge)} (new)` : ref;
  }
  const fridge = lookups?.fridges.find((f) => f.id === Number(ref));
  return fridge ? fridgeLabel(fridge) : String(ref);
}

function plainIssue(file: UploadFileResult): string {
  if (file.message) return file.message;
  if (file.mapping_mismatches.length > 0) {
    return file.mapping_mismatches[0].message;
  }
  if (file.status === "invalid") return "This file could not be read.";
  if (file.status === "failed") return "Something went wrong with this file.";
  return "This file needs your attention before it can be imported.";
}

function buildPayload(
  files: File[],
  selections: UploadSelections,
  newLoggers: StagedNewLogger[],
  moves: StagedMove[],
  newFridges: StagedNewFridge[] = [],
) {
  return { files, selections, newLoggers, newFridges, moves };
}

function selectionsFromCodes(
  files: File[],
  lookups: LookupsResponse | null,
  fileCodes: Record<number, string>,
  existing: UploadSelections,
): UploadSelections {
  const next: UploadSelections = {};
  files.forEach((_, index) => {
    const key = String(index);
    const prev = existing[key];
    // An explicit choice (dropdown or confirmed new logger) wins over a
    // typed/suggested code so Review again cannot silently swap loggers.
    if (typeof prev === "number") {
      next[key] = prev;
      return;
    }
    if (typeof prev === "string" && prev.toLowerCase().startsWith("new:")) {
      next[key] = prev;
      return;
    }
    const code = (fileCodes[index] ?? "").trim();
    const logger = findLoggerByCode(lookups, code);
    if (logger) {
      next[key] = logger.id;
    }
  });
  return next;
}

export function WeeklyUpload({
  onOpenInitialSetup,
}: {
  onOpenInitialSetup?: () => void;
} = {}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [files, setFiles] = useState<File[]>([]);
  const [unsupportedNote, setUnsupportedNote] = useState<string | null>(null);
  const [lookups, setLookups] = useState<LookupsResponse | null>(null);
  const [lookupsError, setLookupsError] = useState<string | null>(null);
  const [selections, setSelections] = useState<UploadSelections>({});
  const [fileCodes, setFileCodes] = useState<Record<number, string>>({});
  const [newLoggers, setNewLoggers] = useState<StagedNewLogger[]>([]);
  const [newFridges, setNewFridges] = useState<StagedNewFridge[]>([]);
  const [moves, setMoves] = useState<StagedMove[]>([]);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [importOutcome, setImportOutcome] = useState<UploadOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingLogger, setEditingLogger] = useState<Record<number, boolean>>({});
  const [editingPicked, setEditingPicked] = useState<Record<number, boolean>>({});
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<number | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveLoggerId, setMoveLoggerId] = useState("");
  const [moveFridge, setMoveFridge] = useState<FridgeChoice>(emptyFridgeChoice());
  const [moveAt, setMoveAt] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [newForms, setNewForms] = useState<Record<number, NewLoggerForm>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const pickMode = useRef<"replace" | "append">("replace");
  const [importHistory, setImportHistory] = useState<UploadFileResult[]>([]);

  const loadLookups = useCallback(async () => {
    setLookupsError(null);
    try {
      const data = await fetchLookups();
      setLookups(data);
    } catch (err) {
      setLookups(null);
      setLookupsError(
        err instanceof Error ? err.message : "Could not load loggers and fridges",
      );
    }
  }, []);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    if (files.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [files.length]);

  const needsAttention = useMemo(
    () =>
      (outcome?.files ?? []).filter(
        (f) =>
          f.status === "needs_attention" ||
          f.status === "invalid" ||
          f.status === "failed",
      ),
    [outcome],
  );

  const readyFiles = useMemo(
    () => (outcome?.files ?? []).filter((f) => f.status === "ready"),
    [outcome],
  );

  const unresolvedCount = needsAttention.length;

  const onPickFiles = (list: FileList | null, mode: "replace" | "append" = pickMode.current) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const ok = picked.filter(isXlsx);
    const bad = picked.filter((f) => !isXlsx(f));
    setUnsupportedNote(
      bad.length
        ? `${bad.length} file(s) skipped — only .xlsx Excel files are supported.`
        : null,
    );
    if (ok.length === 0) {
      syncNativeFileInput(fileInputRef.current, files);
      return;
    }

    if (mode === "append" && files.length > 0) {
      const nextFiles = sortFilesNaturally([...files, ...ok]);
      const nextSelections = remapKeyedByFileIdentity(
        files,
        nextFiles,
        selections,
      ) as UploadSelections;
      const nextCodes: Record<number, string> = {};
      nextFiles.forEach((file, index) => {
        const old = files.indexOf(file);
        nextCodes[index] =
          old >= 0
            ? (fileCodes[old] ?? extractLoggerCode(file.name) ?? "")
            : (extractLoggerCode(file.name) ?? "");
      });
      const nextForms = remapRecordByFileIdentity(files, nextFiles, newForms);
      nextFiles.forEach((file, index) => {
        if (nextForms[index]) return;
        const suggested = extractLoggerCode(file.name) ?? "";
        const known = findLoggerByCode(lookups, suggested);
        nextForms[index] = emptyNewForm(
          suggested,
          suggested && !known ? "new" : "existing",
        );
      });
      setFiles(nextFiles);
      setSelections(nextSelections);
      setFileCodes(nextCodes);
      setNewForms(nextForms);
      setEditingLogger(remapRecordByFileIdentity(files, nextFiles, editingLogger));
      setEditingPicked(remapRecordByFileIdentity(files, nextFiles, editingPicked));
      setError(null);
      setNotice(`Added ${ok.length} file${ok.length === 1 ? "" : "s"} to this batch.`);
      syncNativeFileInput(fileInputRef.current, nextFiles);
      void runReview(nextFiles, nextSelections, newLoggers, moves, newFridges);
      return;
    }

    const nextFiles = sortFilesNaturally(ok);
    setFiles(nextFiles);
    setFileCodes(codesFromFilenames(nextFiles));
    setSelections({});
    setNewLoggers([]);
    setNewFridges([]);
    setMoves([]);
    setOutcome(null);
    setImportOutcome(null);
    setImportHistory([]);
    setError(null);
    setPhase("pick");
    setNewForms(formsFromFiles(nextFiles, lookups));
    setNotice(null);
    setEditingLogger({});
    setEditingPicked({});
    syncNativeFileInput(fileInputRef.current, nextFiles);
  };

  const runReview = async (
    nextFiles: File[] = files,
    nextSelections: UploadSelections = selections,
    nextNew: StagedNewLogger[] = newLoggers,
    nextMoves: StagedMove[] = moves,
    nextFridges: StagedNewFridge[] = newFridges,
  ) => {
    if (nextFiles.length === 0) {
      setError("Select at least one .xlsx file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const withCodes = selectionsFromCodes(nextFiles, lookups, fileCodes, nextSelections);
      setSelections(withCodes);
      const body = await reviewWeeklyUpload(
        buildPayload(nextFiles, withCodes, nextNew, nextMoves, nextFridges),
      );
      setOutcome(body);
      setPhase("review");
      setReadyOpen(false);
      setEditingPicked({});
      if (body.moves_rejected?.length || body.new_loggers_rejected?.length) {
        /* shown in UI below */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  const onSelectLogger = async (fileIndex: number, value: string) => {
    if (!value) {
      const next = { ...selections };
      delete next[String(fileIndex)];
      setSelections(next);
      setNewForms((prev) => ({
        ...prev,
        [fileIndex]: { ...(prev[fileIndex] ?? emptyNewForm(fileCodes[fileIndex] ?? "")), mode: "existing" },
      }));
      return;
    }
    if (value === NEW_LOGGER_VALUE) {
      const suggested = fileCodes[fileIndex] || extractLoggerCode(files[fileIndex]?.name ?? "") || "";
      setNewForms((prev) => ({
        ...prev,
        [fileIndex]: prev[fileIndex]
          ? { ...prev[fileIndex], mode: "new", code: prev[fileIndex].code || suggested }
          : emptyNewForm(suggested, "new"),
      }));
      const next = { ...selections };
      delete next[String(fileIndex)];
      setSelections(next);
      return;
    }
    setNewForms((prev) => ({
      ...prev,
      [fileIndex]: { ...(prev[fileIndex] ?? emptyNewForm()), mode: "existing" },
    }));
    const nextSelections: UploadSelections = {
      ...selections,
      [String(fileIndex)]: Number(value),
    };
    const stillUsed = new Set(
      Object.values(nextSelections)
        .filter((v): v is string => typeof v === "string" && v.startsWith("new:"))
        .map((v) => v.slice(4).toLowerCase()),
    );
    const nextNew = newLoggers.filter((n) => stillUsed.has(n.code.toLowerCase()));
    setSelections(nextSelections);
    setNewLoggers(nextNew);
    await runReview(files, nextSelections, nextNew, moves, newFridges);
  };

  const onConfirmNewLogger = async (fileIndex: number) => {
    const form = newForms[fileIndex] ?? emptyNewForm(fileCodes[fileIndex] ?? "");
    const code = form.code.trim();
    const errors: NewLoggerForm["errors"] = {};
    if (!code) errors.code = "Enter the logger code.";
    const existing = findLoggerByCode(lookups, code);
    if (!existing) {
      if (form.unit !== "C" && form.unit !== "F") {
        errors.unit = "Choose Celsius (C) or Fahrenheit (F).";
      }
    }
    const fridgeResult = existing
      ? { ref: undefined as FridgeRef | undefined, staged: newFridges }
      : resolveFridgeRef(lookups, newFridges, form.fridge);
    if (!existing && fridgeResult.error) errors.fridge = fridgeResult.error;
    if (Object.keys(errors).length > 0) {
      setNewForms((prev) => ({
        ...prev,
        [fileIndex]: { ...form, code, errors },
      }));
      return;
    }

    setFileCodes((prev) => ({ ...prev, [fileIndex]: code }));

    if (existing) {
      const nextSelections: UploadSelections = {
        ...selections,
        [String(fileIndex)]: existing.id,
      };
      const stillUsed = new Set(
        Object.values(nextSelections)
          .filter((v): v is string => typeof v === "string" && v.startsWith("new:"))
          .map((v) => v.slice(4).toLowerCase()),
      );
      const nextNew = newLoggers.filter((n) => stillUsed.has(n.code.toLowerCase()));
      setSelections(nextSelections);
      setNewLoggers(nextNew);
      setNewForms((prev) => ({ ...prev, [fileIndex]: { ...form, code, errors: {} } }));
      setError(null);
      await runReview(files, nextSelections, nextNew, moves, newFridges);
      return;
    }

    const stagedFridges = fridgeResult.staged;
    const staged: StagedNewLogger = {
      code,
      unit: form.unit as "C" | "F",
      fridge_id: fridgeResult.ref!,
    };
    const key = code.toLowerCase();
    const nextNew = [...newLoggers.filter((n) => n.code.toLowerCase() !== key), staged];
    const nextSelections: UploadSelections = {
      ...selections,
      [String(fileIndex)]: `new:${code}`,
    };
    setNewFridges(stagedFridges);
    setNewLoggers(nextNew);
    setSelections(nextSelections);
    setNewForms((prev) => ({ ...prev, [fileIndex]: { ...form, code, errors: {} } }));
    setError(null);
    await runReview(files, nextSelections, nextNew, moves, stagedFridges);
  };

  const onAddMove = async () => {
    const fieldErrors: string[] = [];
    if (!moveLoggerId) fieldErrors.push("Choose the logger.");
    if (!moveAt) fieldErrors.push("Enter the move date and time.");
    const fridgeResult = resolveFridgeRef(lookups, newFridges, moveFridge);
    if (fridgeResult.error) fieldErrors.push(fridgeResult.error);
    if (fieldErrors.length > 0) {
      setMoveError(fieldErrors.join(" "));
      return;
    }
    const effective = moveAt.length === 16 ? `${moveAt}:00` : moveAt;
    const staged: StagedMove = {
      logger_id: Number(moveLoggerId),
      fridge_id: fridgeResult.ref!,
      effective_at: effective.replace("T", " "),
    };
    const nextMoves = [...moves, staged];
    const nextFridges = fridgeResult.staged;
    setMoves(nextMoves);
    setNewFridges(nextFridges);
    setMoveError(null);
    setError(null);
    setMoveLoggerId("");
    setMoveFridge(emptyFridgeChoice());
    setMoveAt("");
    await runReview(files, selections, newLoggers, nextMoves, nextFridges);
  };

  const onRemoveFile = (fileIndex: number) => {
    const nextFiles = files.filter((_, i) => i !== fileIndex);
    const nextSelections: UploadSelections = {};
    const nextForms: typeof newForms = {};
    for (const [key, val] of Object.entries(selections)) {
      const idx = Number(key);
      if (idx === fileIndex) continue;
      const newIdx = idx > fileIndex ? idx - 1 : idx;
      nextSelections[String(newIdx)] = val;
    }
    for (const [key, val] of Object.entries(newForms)) {
      const idx = Number(key);
      if (idx === fileIndex) continue;
      const newIdx = idx > fileIndex ? idx - 1 : idx;
      nextForms[newIdx] = val;
    }
    const nextCodes: Record<number, string> = {};
    for (const [key, val] of Object.entries(fileCodes)) {
      const idx = Number(key);
      if (idx === fileIndex) continue;
      const newIdx = idx > fileIndex ? idx - 1 : idx;
      nextCodes[newIdx] = val;
    }
    const removedName = files[fileIndex]?.name ?? "file";
    setFiles(nextFiles);
    setSelections(nextSelections);
    setNewForms(nextForms);
    setFileCodes(nextCodes);
    setEditingLogger((prev) => {
      const next: Record<number, boolean> = {};
      for (const [key, val] of Object.entries(prev)) {
        const idx = Number(key);
        if (idx === fileIndex) continue;
        next[idx > fileIndex ? idx - 1 : idx] = val;
      }
      return next;
    });
    setEditingPicked((prev) => {
      const next: Record<number, boolean> = {};
      for (const [key, val] of Object.entries(prev)) {
        const idx = Number(key);
        if (idx === fileIndex) continue;
        next[idx > fileIndex ? idx - 1 : idx] = val;
      }
      return next;
    });
    setNotice(`Removed ${removedName}. Other files were kept.`);
    syncNativeFileInput(fileInputRef.current, nextFiles);
    if (nextFiles.length === 0) {
      setPhase("pick");
      setOutcome(null);
      return;
    }
    void runReview(nextFiles, nextSelections, newLoggers, moves, newFridges);
  };

  const startReplaceFile = (fileIndex: number) => {
    replaceTarget.current = fileIndex;
    replaceInputRef.current?.click();
  };

  const onReplaceFilePicked = (list: FileList | null) => {
    const index = replaceTarget.current;
    replaceTarget.current = null;
    if (index == null || !list || list.length === 0) return;
    const replacement = list[0];
    if (!isXlsx(replacement)) {
      setError("Replacement must be an .xlsx Excel file.");
      return;
    }
    const previousName = files[index]?.name ?? "file";
    const nextFiles = files.map((file, i) => (i === index ? replacement : file));
    const nextSelections = { ...selections };
    delete nextSelections[String(index)];
    const suggested = extractLoggerCode(replacement.name) ?? "";
    const known = findLoggerByCode(lookups, suggested);
    setFiles(nextFiles);
    setFileCodes((prev) => ({ ...prev, [index]: suggested }));
    setNewForms((prev) => ({
      ...prev,
      [index]: emptyNewForm(suggested, suggested && !known ? "new" : "existing"),
    }));
    setSelections(nextSelections);
    setEditingLogger((prev) => ({ ...prev, [index]: true }));
    setNotice(`Replaced ${previousName} with ${replacement.name}. Other files were kept.`);
    setError(null);
    if (replaceInputRef.current) replaceInputRef.current.value = "";
    syncNativeFileInput(fileInputRef.current, nextFiles);
    void runReview(nextFiles, nextSelections, newLoggers, moves, newFridges);
  };

  const onUseSuggestedLogger = async (fileIndex: number, code: string) => {
    const logger = findLoggerByCode(lookups, code);
    setFileCodes((prev) => ({ ...prev, [fileIndex]: code }));
    setNewForms((prev) => ({
      ...prev,
      [fileIndex]: {
        ...(prev[fileIndex] ?? emptyNewForm(code)),
        mode: logger ? "existing" : "new",
        code,
      },
    }));
    if (!logger) {
      setEditingLogger((prev) => ({ ...prev, [fileIndex]: true }));
      setNotice(`Suggested logger ${code} is not in the list yet. Confirm it as a new logger.`);
      return;
    }
    const nextSelections: UploadSelections = {
      ...selections,
      [String(fileIndex)]: logger.id,
    };
    setSelections(nextSelections);
    setNotice(`Using ${code} for this file. Reviewing again…`);
    await runReview(files, nextSelections, newLoggers, moves, newFridges);
  };

  const onImport = async () => {
    if (importLock.current || busy || readyFiles.length === 0) return;
    importLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = await importWeeklyUpload(
        buildPayload(files, selections, newLoggers, moves, newFridges),
      );
      setImportOutcome(body);
      const completed = body.files.filter(isCompletedImport);
      setImportHistory((prev) => [...prev, ...completed]);

      const remainingFiles = remainingFilesAfterImport(files, body);
      const nextSelections = remapKeyedByFileIdentity(
        files,
        remainingFiles,
        selections,
      ) as UploadSelections;
      const nextForms = remapRecordByFileIdentity(files, remainingFiles, newForms);
      const nextCodes = remapRecordByFileIdentity(files, remainingFiles, fileCodes);
      const nextEditing = remapRecordByFileIdentity(files, remainingFiles, editingLogger);

      setFiles(remainingFiles);
      setSelections(nextSelections);
      setNewForms(nextForms);
      setFileCodes(nextCodes);
      setEditingLogger(nextEditing);
      setEditingPicked({});
      syncNativeFileInput(fileInputRef.current, remainingFiles);
      // Moves and new loggers were applied on the server; clear staged state
      setMoves([]);
      setNewLoggers([]);
      setNewFridges([]);
      setNotice(
        remainingFiles.length > 0
          ? `Imported ${completed.length} file${completed.length === 1 ? "" : "s"}. ${remainingFiles.length} still ${remainingFiles.length === 1 ? "needs" : "need"} attention and remain in this batch.`
          : `Imported ${completed.length} file${completed.length === 1 ? "" : "s"}.`,
      );

      if (remainingFiles.length > 0) {
        try {
          const again = await reviewWeeklyUpload(
            buildPayload(remainingFiles, nextSelections, [], [], []),
          );
          setOutcome(again);
          setPhase("review");
        } catch {
          setOutcome({
            ...body,
            dry_run: true,
            files: body.files.filter((f) => !isCompletedImport(f)),
          });
          setPhase("review");
        }
        void loadLookups();
      } else {
        setOutcome(null);
        setPhase("results");
        void loadLookups();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      importLock.current = false;
    }
  };

  const onStartOver = () => {
    setFiles([]);
    setSelections({});
    setFileCodes({});
    setNewLoggers([]);
    setNewFridges([]);
    setMoves([]);
    setOutcome(null);
    setImportOutcome(null);
    setImportHistory([]);
    setError(null);
    setUnsupportedNote(null);
    setPhase("pick");
    setNewForms({});
    setNotice(null);
    setEditingLogger({});
    setEditingPicked({});
    syncNativeFileInput(fileInputRef.current, []);
  };

  const noLoggers = lookups !== null && lookups.loggers.length === 0;

  return (
    <div className="weekly">
      <header className="weekly__header">
        <h1 className="weekly__title">Weekly Upload</h1>
        <p className="weekly__subtitle">
          Upload this week's temperature files, then review them before importing.
        </p>
      </header>

      {lookupsError ? (
        <div className="weekly__banner weekly__banner--error" role="alert">
          Could not load loggers and fridges. {lookupsError}{" "}
          <button type="button" className="weekly__link-btn" onClick={() => void loadLookups()}>
            Try again
          </button>
        </div>
      ) : null}

      {noLoggers ? (
        <div className="weekly__banner weekly__banner--amber" role="status">
          No loggers are registered yet. Run <strong>Initial Setup</strong> once before
          weekly uploads.
          {onOpenInitialSetup ? (
            <>
              {" "}
              <button type="button" className="weekly__link-btn" onClick={onOpenInitialSetup}>
                Open Initial Setup
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="weekly__banner weekly__banner--error" role="alert">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="weekly__banner" role="status">
          {notice}
        </div>
      ) : null}

      <input
        ref={replaceInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="weekly__file-input weekly__file-input--hidden"
        aria-label="Replace one Excel logger file"
        onChange={(e) => onReplaceFilePicked(e.target.files)}
      />

      {importOutcome || importHistory.length > 0 ? (
        <ImportResults
          outcome={importOutcome}
          history={importHistory}
          unresolvedLeft={files.length}
          onDismiss={() => {
            setImportOutcome(null);
            if (files.length === 0) setImportHistory([]);
          }}
        />
      ) : null}

      <section
        className={`weekly-card weekly-card--picker${phase === "review" ? " weekly-card--picker-after" : ""}`}
        aria-labelledby="pick-heading"
      >
          <h2 id="pick-heading" className="weekly-card__title">
            Select files
          </h2>
          <p className="weekly-card__help">
            Excel files (.xlsx) only. Make sure each file is assigned to the correct fridge.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            className="weekly__file-input weekly__file-input--hidden"
            aria-label="Select Excel logger files"
            onChange={(e) => onPickFiles(e.target.files, pickMode.current)}
          />
          <div className="weekly__actions">
            <button
              type="button"
              className="weekly-btn weekly-btn--ghost"
              disabled={busy || noLoggers}
              onClick={() => {
                pickMode.current = files.length > 0 ? "append" : "replace";
                fileInputRef.current?.click();
              }}
            >
              {files.length > 0 ? "Add more Excel files" : "Select Excel files"}
            </button>
          </div>
          {unsupportedNote ? (
            <p className="weekly__note weekly__note--amber">{unsupportedNote}</p>
          ) : null}
          {files.length > 0 ? (
            <div className="weekly__file-list">
              <p className="weekly__file-count">
                {files.length} file{files.length === 1 ? "" : "s"} selected
              </p>
              <ul className="weekly__picked">
                {files.map((f, index) => {
                  const filenameCode = extractLoggerCode(f.name);
                  const typed = (fileCodes[index] ?? "").trim();
                  const hint = typed || filenameCode;
                  const editing = Boolean(editingPicked[index]);
                  return (
                    <li key={`${f.name}-${f.size}-${f.lastModified}-${index}`}>
                      <div className="weekly__picked-row">
                        <div className="weekly__picked-main">
                          <span className="weekly__picked-name">{f.name}</span>
                          {hint ? (
                            <span className="weekly__picked-meta">
                              {filenameCode && typed === filenameCode
                                ? `From file name: ${filenameCode}`
                                : `Logger: ${hint}`}
                            </span>
                          ) : (
                            <span className="weekly__picked-meta">Check during review</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="weekly__link-btn"
                          disabled={busy}
                          aria-label={
                            editing
                              ? `Done editing logger code for ${f.name}`
                              : `Edit logger code for ${f.name}`
                          }
                          onClick={() =>
                            setEditingPicked((prev) => ({ ...prev, [index]: !prev[index] }))
                          }
                        >
                          {editing ? "Done" : "Edit"}
                        </button>
                      </div>
                      {editing ? (
                        <label className="weekly__code-label">
                          Logger code
                          <input
                            type="text"
                            value={fileCodes[index] ?? ""}
                            aria-label={`Logger code for ${f.name}`}
                            disabled={busy}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFileCodes((prev) => ({ ...prev, [index]: value }));
                              setNewForms((prev) => ({
                                ...prev,
                                [index]: {
                                  ...(prev[index] ?? emptyNewForm()),
                                  code: value,
                                },
                              }));
                            }}
                          />
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="weekly__note">No files selected yet.</p>
          )}
          <div className="weekly__actions">
            <button
              type="button"
              className="weekly-btn weekly-btn--primary"
              disabled={busy || files.length === 0 || noLoggers}
              onClick={() => void runReview()}
            >
              {busy && phase === "pick"
                ? "Reviewing…"
                : files.length === 0
                  ? "Review files"
                  : `Review ${files.length} file${files.length === 1 ? "" : "s"}`}
            </button>
            {files.length > 0 ? (
              <button
                type="button"
                className="weekly-btn weekly-btn--ghost"
                disabled={busy}
                onClick={onStartOver}
              >
                Clear selection
              </button>
            ) : null}
          </div>
        </section>

      {phase === "review" && outcome ? (
        <div className="weekly-review">
          <p className="weekly__summary" role="status">
            {readyFiles.length} ready to import
            {unresolvedCount > 0
              ? ` · ${unresolvedCount} need${unresolvedCount === 1 ? "s" : ""} attention`
              : ""}
            {outcome.moves_applied?.length
              ? ` · ${outcome.moves_applied.length} move(s) checked`
              : ""}
          </p>

          {unresolvedCount > 0 ? (
            <div className="weekly__banner weekly__banner--amber" role="status">
              {unresolvedCount === 1
                ? "1 file still needs attention."
                : `${unresolvedCount} files still need attention.`}{" "}
              Unresolved files are <strong>not saved</strong> on the server and may be
              lost if you leave this page.
            </div>
          ) : null}

          {(outcome.new_loggers_rejected?.length ?? 0) > 0 ? (
            <div className="weekly__banner weekly__banner--error" role="alert">
              {outcome.new_loggers_rejected.map((r, i) => (
                <p key={i}>{String(r.reason ?? JSON.stringify(r))}</p>
              ))}
            </div>
          ) : null}

          {(outcome.moves_rejected?.length ?? 0) > 0 ? (
            <div className="weekly__banner weekly__banner--error" role="alert">
              {outcome.moves_rejected.map((r, i) => (
                <p key={i}>{String(r.reason ?? JSON.stringify(r))}</p>
              ))}
            </div>
          ) : null}

          {(outcome.new_fridges_rejected?.length ?? 0) > 0 ? (
            <div className="weekly__banner weekly__banner--error" role="alert">
              {outcome.new_fridges_rejected.map((r, i) => (
                <p key={i}>{String(r.reason ?? JSON.stringify(r))}</p>
              ))}
            </div>
          ) : null}

          {needsAttention.length > 0 ? (
            <section className="weekly-section" aria-labelledby="needs-heading">
              <h2 id="needs-heading" className="weekly-section__title weekly-section__title--attention">
                Needs attention
              </h2>
              <div className="weekly-stack">
                {needsAttention.map((file) => (
                  <AttentionCard
                    key={`${file.file_index}-${file.filename}`}
                    file={file}
                    lookups={lookups}
                    selection={selections[String(file.file_index)]}
                    newForm={
                      newForms[file.file_index] ??
                      emptyNewForm(fileCodes[file.file_index] ?? "")
                    }
                    stagedFridges={newFridges}
                    busy={busy}
                    onSelectLogger={(v) => void onSelectLogger(file.file_index, v)}
                    onNewFormChange={(patch) =>
                      setNewForms((prev) => {
                        const base = prev[file.file_index] ?? emptyNewForm();
                        const next: NewLoggerForm = {
                          ...base,
                          ...patch,
                          fridge: patch.fridge
                            ? { ...base.fridge, ...patch.fridge }
                            : base.fridge,
                          errors: patch.errors ?? base.errors,
                        };
                        if (patch.code !== undefined) {
                          setFileCodes((codes) => ({
                            ...codes,
                            [file.file_index]: patch.code ?? "",
                          }));
                        }
                        return { ...prev, [file.file_index]: next };
                      })
                    }
                    onConfirmNew={() => void onConfirmNewLogger(file.file_index)}
                    onRemove={() => onRemoveFile(file.file_index)}
                    onReplace={() => startReplaceFile(file.file_index)}
                    onReview={() => void runReview()}
                    onChangeLogger={() =>
                      setEditingLogger((prev) => ({ ...prev, [file.file_index]: true }))
                    }
                    onUseSuggested={
                      file.suggested_logger_code
                        ? () =>
                            void onUseSuggestedLogger(
                              file.file_index,
                              file.suggested_logger_code as string,
                            )
                        : undefined
                    }
                    editingLogger={Boolean(editingLogger[file.file_index])}
                    onOpenMove={() => setMoveOpen(true)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="weekly-card weekly-card--muted">
            <button
              type="button"
              className="weekly-collapse"
              aria-expanded={moveOpen}
              onClick={() => setMoveOpen((o) => !o)}
            >
              Record a logger move {moveOpen ? "▾" : "▸"}
            </button>
            {moveOpen ? (
              <div className="weekly-move">
                <p className="weekly-card__help">
                  If a logger changed fridge, record the move with the real date and
                  time. Nothing is guessed.
                </p>
                {moves.length > 0 ? (
                  <ul className="weekly__staged">
                    {moves.map((m, i) => {
                      const logger = lookups?.loggers.find((l) => l.id === m.logger_id);
                      return (
                        <li key={i}>
                          {logger?.code ?? m.logger_id} → {describeFridgeRef(m.fridge_id, lookups, newFridges)} at{" "}
                          {m.effective_at}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <div className="weekly-form-grid">
                  <label>
                    Logger
                    <select
                      value={moveLoggerId}
                      onChange={(e) => setMoveLoggerId(e.target.value)}
                      disabled={busy}
                    >
                      <option value="">Select…</option>
                      {(lookups?.loggers ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <FridgeFields
                    idPrefix="move"
                    lookups={lookups}
                    choice={moveFridge}
                    disabled={busy}
                    error={moveError && moveError.toLowerCase().includes("fridge") ? moveError : undefined}
                    onChange={setMoveFridge}
                  />
                  <label>
                    Effective date and time
                    <input
                      type="datetime-local"
                      value={moveAt}
                      onChange={(e) => setMoveAt(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                </div>
                {moveError ? <p className="weekly-field-error">{moveError}</p> : null}
                <button
                  type="button"
                  className="weekly-btn weekly-btn--secondary"
                  disabled={busy}
                  onClick={() => void onAddMove()}
                >
                  Add move and review again
                </button>
              </div>
            ) : null}
          </section>

          {newFridges.length > 0 ? (
            <section className="weekly-card weekly-card--muted">
              <h3 className="weekly-card__subtitle">Staged new fridges</h3>
              <ul className="weekly__staged">
                {newFridges.map((f, i) => (
                  <li key={`${f.branch}-${f.name}-${i}`}>
                    {fridgeLabel(f)} (new)
                  </li>
                ))}
              </ul>
              <p className="weekly__note">Saved only when you import ready files.</p>
            </section>
          ) : null}

          {newLoggers.length > 0 ? (
            <section className="weekly-card weekly-card--muted">
              <h3 className="weekly-card__subtitle">Staged new loggers</h3>
              <ul className="weekly__staged">
                {newLoggers.map((n) => (
                  <li key={n.code}>
                    {n.code} · {n.unit} · {describeFridgeRef(n.fridge_id, lookups, newFridges)}
                  </li>
                ))}
              </ul>
              <p className="weekly__note">
                These are saved only when you import ready files.
              </p>
            </section>
          ) : null}

          <section className="weekly-section" aria-labelledby="ready-heading">
            <button
              type="button"
              id="ready-heading"
              className="weekly-collapse weekly-collapse--section"
              aria-expanded={readyOpen}
              onClick={() => setReadyOpen((o) => !o)}
            >
              Ready to import ({readyFiles.length}) {readyOpen ? "▾" : "▸"}
            </button>
            {readyOpen ? (
              <div className="weekly-stack">
                {readyFiles.length === 0 ? (
                  <p className="weekly__note">No files are ready yet.</p>
                ) : (
                  readyFiles.map((file) => (
                    <article key={file.file_index} className="weekly-file weekly-file--ready">
                      <h3 className="weekly-file__name">{file.filename}</h3>
                      <p className="weekly-file__meta">
                        Logger: {file.logger?.code ?? "—"}
                        {file.logger?.source
                          ? ` (${loggerSourceLabel(file.logger.source)})`
                          : ""}
                      </p>
                      <FileActions
                        busy={busy}
                        onChangeLogger={() =>
                          setEditingLogger((prev) => ({ ...prev, [file.file_index]: true }))
                        }
                        onReplace={() => startReplaceFile(file.file_index)}
                        onRemove={() => onRemoveFile(file.file_index)}
                        onReview={() => void runReview()}
                      />
                      {editingLogger[file.file_index] && lookups ? (
                        <label>
                          Select logger
                          <select
                            value={
                              typeof selections[String(file.file_index)] === "number"
                                ? String(selections[String(file.file_index)])
                                : file.logger?.id != null
                                  ? String(file.logger.id)
                                  : ""
                            }
                            disabled={busy}
                            onChange={(e) => void onSelectLogger(file.file_index, e.target.value)}
                          >
                            <option value="">Select…</option>
                            {lookups.loggers.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.code} ({l.unit})
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {file.fridges.length > 0 ? (
                        <p className="weekly-file__meta">
                          Fridge
                          {file.fridges.length > 1 ? "s" : ""}:{" "}
                          {file.fridges.map(fridgeLabel).join("; ")}
                        </p>
                      ) : null}
                      <p className="weekly-file__meta">
                        Would insert {file.inserted} reading
                        {file.inserted === 1 ? "" : "s"}
                        {file.duplicates > 0
                          ? ` · ${file.duplicates} duplicate${file.duplicates === 1 ? "" : "s"} skipped`
                          : ""}
                        {file.rejected_total > 0
                          ? ` · ${file.rejected_total} rejected`
                          : ""}
                      </p>
                    </article>
                  ))
                )}
              </div>
            ) : null}
          </section>

          <div className="weekly__actions weekly__actions--sticky">
            <button
              type="button"
              className="weekly-btn weekly-btn--primary"
              disabled={busy || readyFiles.length === 0}
              onClick={() => void onImport()}
            >
              {busy
                ? "Working…"
                : `Import ${readyFiles.length} ready file${readyFiles.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              className="weekly-btn weekly-btn--ghost"
              disabled={busy}
              onClick={() => void runReview()}
            >
              Review again
            </button>
          </div>
        </div>
      ) : null}

      {phase === "results" && importOutcome ? (
        <section className="weekly-card weekly-card--finished">
          <h2 className="weekly-card__title">Import finished</h2>
          <p className="weekly-card__help">
            All selected files were processed. You can upload more files anytime.
          </p>
          <button type="button" className="weekly-btn weekly-btn--primary" onClick={onStartOver}>
            Upload more files
          </button>
        </section>
      ) : null}
    </div>
  );
}

function FridgeFields({
  idPrefix,
  lookups,
  choice,
  disabled,
  error,
  onChange,
}: {
  idPrefix: string;
  lookups: LookupsResponse | null;
  choice: FridgeChoice;
  disabled: boolean;
  error?: string;
  onChange: (choice: FridgeChoice) => void;
}) {
  const branches = uniqueBranches(lookups?.fridges ?? []);
  return (
    <fieldset className="weekly-choice">
      <legend>Fridge</legend>
      <label>
        <input
          type="radio"
          name={`${idPrefix}-fridge-mode`}
          checked={choice.mode === "existing"}
          disabled={disabled}
          onChange={() => onChange({ ...choice, mode: "existing" })}
        />
        Select existing fridge
      </label>
      <label>
        <input
          type="radio"
          name={`${idPrefix}-fridge-mode`}
          checked={choice.mode === "new"}
          disabled={disabled}
          onChange={() => onChange({ ...choice, mode: "new" })}
        />
        Add new fridge
      </label>
      {choice.mode === "existing" ? (
        <label>
          Fridge
          <select
            value={choice.fridgeId}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value === NEW_FRIDGE_VALUE) {
                onChange({ ...choice, mode: "new" });
                return;
              }
              onChange({ ...choice, fridgeId: e.target.value });
            }}
          >
            <option value="">Select…</option>
            {(lookups?.fridges ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {fridgeLabel(f)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label>
            City
            <select
              value={choice.branch}
              disabled={disabled}
              onChange={(e) => onChange({ ...choice, branch: e.target.value })}
            >
              <option value="">Select…</option>
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </label>
          <label>
            New fridge name
            <input
              type="text"
              value={choice.name}
              disabled={disabled}
              onChange={(e) => onChange({ ...choice, name: e.target.value })}
            />
          </label>
        </>
      )}
      {error ? <p className="weekly-field-error">{error}</p> : null}
    </fieldset>
  );
}

function FileActions({
  busy,
  onChangeLogger,
  onReplace,
  onRemove,
  onReview,
}: {
  busy: boolean;
  onChangeLogger: () => void;
  onReplace: () => void;
  onRemove: () => void;
  onReview: () => void;
}) {
  return (
    <div className="weekly-file-actions">
      <button type="button" className="weekly-btn weekly-btn--ghost" disabled={busy} onClick={onChangeLogger}>
        Change logger
      </button>
      <button type="button" className="weekly-btn weekly-btn--ghost" disabled={busy} onClick={onReplace}>
        Replace file
      </button>
      <button type="button" className="weekly-btn weekly-btn--ghost" disabled={busy} onClick={onRemove}>
        Remove file
      </button>
      <button type="button" className="weekly-btn weekly-btn--ghost" disabled={busy} onClick={onReview}>
        Review again
      </button>
    </div>
  );
}

function MismatchGroups({
  mismatches,
}: {
  mismatches: UploadFileResult["mapping_mismatches"];
}) {
  const groups = groupMappingMismatches(mismatches);
  if (groups.length === 0) return null;
  return (
    <div className="weekly-file__errors">
      <p className="weekly-file__errors-title">Column mismatches</p>
      {groups.map((group) => (
        <div key={`${group.field}-${group.found}-${group.expected}`}>
          <p className="weekly-file__issue">
            {group.field === "Logger"
              ? loggerMismatchHeadline(group)
              : `${group.rows.length} row${group.rows.length === 1 ? "" : "s"}: ${group.field} found “${group.found}”, expected “${group.expected}”.`}
          </p>
          <details>
            <summary>Show affected rows ({group.rows.length})</summary>
            <ul>
              {group.rows.map((row) => (
                <li key={row}>
                  Row {row}: {group.field} found &ldquo;{group.found}&rdquo;, expected
                  &ldquo;{group.expected}&rdquo;
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
      <p className="weekly__note">
        Change the logger or replace this Excel file. The app does not override values
        inside the workbook.
      </p>
    </div>
  );
}

function AttentionCard({
  file,
  lookups,
  selection,
  newForm,
  stagedFridges: _stagedFridges,
  busy,
  onSelectLogger,
  onNewFormChange,
  onConfirmNew,
  onRemove,
  onReplace,
  onReview,
  onChangeLogger,
  onUseSuggested,
  editingLogger,
  onOpenMove,
}: {
  file: UploadFileResult;
  lookups: LookupsResponse | null;
  selection: number | string | undefined;
  newForm: NewLoggerForm;
  stagedFridges: StagedNewFridge[];
  busy: boolean;
  onSelectLogger: (value: string) => void;
  onNewFormChange: (
    patch: Partial<Omit<NewLoggerForm, "fridge" | "errors">> & {
      fridge?: Partial<FridgeChoice>;
      errors?: NewLoggerForm["errors"];
    },
  ) => void;
  onConfirmNew: () => void;
  onRemove: () => void;
  onReplace: () => void;
  onReview: () => void;
  onChangeLogger: () => void;
  onUseSuggested?: () => void;
  editingLogger: boolean;
  onOpenMove: () => void;
}) {
  const hasLoggerMismatch = file.mapping_mismatches.some((m) => m.field === "Logger");
  const needsLogger =
    !file.logger ||
    hasLoggerMismatch ||
    editingLogger ||
    (typeof file.message === "string" &&
      (file.message.includes("logger not identified") ||
        file.message.includes("staged new logger") ||
        file.message.includes("not in the database") ||
        file.message.includes("invalid logger selection")));

  const needsMove =
    typeof file.message === "string" &&
    (file.message.includes("Record each known move") ||
      file.message.includes("no fridge assignment") ||
      file.message.includes("unresolved fridge"));

  const suggestedExisting = findLoggerByCode(lookups, newForm.code);
  const showNewForm =
    newForm.mode === "new" ||
    (typeof selection === "string" && selection.startsWith("new:"));
  const selectValue = showNewForm
    ? NEW_LOGGER_VALUE
    : typeof selection === "number"
      ? String(selection)
      : file.logger?.id != null
        ? String(file.logger.id)
        : "";

  return (
    <article className="weekly-file weekly-file--attention">
      <h3 className="weekly-file__name">{file.filename}</h3>
      {file.mapping_mismatches.length === 0 ? (
        <p className="weekly-file__issue">{plainIssue(file)}</p>
      ) : null}
      <FileActions
        busy={busy}
        onChangeLogger={onChangeLogger}
        onReplace={onReplace}
        onRemove={onRemove}
        onReview={onReview}
      />
      {file.suggested_logger_code && onUseSuggested ? (
        <p className="weekly__note">
          Suggested logger from the spreadsheet: <strong>{file.suggested_logger_code}</strong>{" "}
          <button type="button" className="weekly__link-btn" onClick={onUseSuggested}>
            Use {file.suggested_logger_code}
          </button>
        </p>
      ) : null}

      {file.mapping_mismatches.length > 0 ? (
        <MismatchGroups mismatches={file.mapping_mismatches} />
      ) : null}

      {file.rejected_total > 0 ? (
        <div className="weekly-file__errors">
          <p className="weekly-file__errors-title">
            {file.rejected_total} rejected row{file.rejected_total === 1 ? "" : "s"}
          </p>
          <ul>
            {file.rejected.slice(0, 10).map((r, i) => (
              <li key={i}>
                Row {r.row_number}: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(file.conflicts.length > 0 || file.fridge_conflicts.length > 0) ? (
        <div className="weekly-file__errors">
          <p className="weekly-file__errors-title">Conflicts</p>
          <p className="weekly__note">
            {file.conflicts.length + file.fridge_conflicts.length} conflict
            {file.conflicts.length + file.fridge_conflicts.length === 1 ? "" : "s"}{" "}
            reported. Existing readings are kept; nothing is overwritten.
          </p>
        </div>
      ) : null}

      {needsLogger && lookups ? (
        <div className="weekly-correction">
          <fieldset className="weekly-choice">
            <legend>Logger</legend>
            <label>
              <input
                type="radio"
                name={`logger-mode-${file.file_index}`}
                checked={!showNewForm}
                disabled={busy}
                onChange={() => onSelectLogger("")}
              />
              Select existing logger
            </label>
            <label>
              <input
                type="radio"
                name={`logger-mode-${file.file_index}`}
                checked={showNewForm}
                disabled={busy}
                onChange={() => onSelectLogger(NEW_LOGGER_VALUE)}
              />
              Add new logger
            </label>
          </fieldset>
          {!showNewForm ? (
            <label>
              Select logger
              <select
                value={selectValue === NEW_LOGGER_VALUE ? "" : selectValue}
                disabled={busy}
                onChange={(e) => onSelectLogger(e.target.value)}
              >
                <option value="">Select…</option>
                {lookups.loggers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} ({l.unit})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="weekly-form-grid weekly-form-grid--new">
              <label>
                Logger code
                <input
                  type="text"
                  value={newForm.code}
                  disabled={busy}
                  aria-label="Editable logger code"
                  onChange={(e) => onNewFormChange({ code: e.target.value })}
                />
              </label>
              {newForm.errors.code ? (
                <p className="weekly-field-error">{newForm.errors.code}</p>
              ) : null}
              {suggestedExisting ? (
                <p className="weekly__note">
                  This code already exists. Confirm to use {suggestedExisting.code} as
                  it is — existing loggers are not renamed.
                </p>
              ) : null}
              <fieldset className="weekly-units">
                <legend>Unit (required)</legend>
                <label>
                  <input
                    type="radio"
                    name={`unit-${file.file_index}`}
                    checked={newForm.unit === "C"}
                    disabled={busy || Boolean(suggestedExisting)}
                    onChange={() => onNewFormChange({ unit: "C" })}
                  />
                  Celsius (C)
                </label>
                <label>
                  <input
                    type="radio"
                    name={`unit-${file.file_index}`}
                    checked={newForm.unit === "F"}
                    disabled={busy || Boolean(suggestedExisting)}
                    onChange={() => onNewFormChange({ unit: "F" })}
                  />
                  Fahrenheit (F)
                </label>
              </fieldset>
              {newForm.errors.unit ? (
                <p className="weekly-field-error">{newForm.errors.unit}</p>
              ) : null}
              {!suggestedExisting ? (
                <FridgeFields
                  idPrefix={`file-${file.file_index}`}
                  lookups={lookups}
                  choice={newForm.fridge}
                  disabled={busy}
                  error={newForm.errors.fridge}
                  onChange={(fridge) => onNewFormChange({ fridge })}
                />
              ) : null}
              <button
                type="button"
                className="weekly-btn weekly-btn--secondary"
                disabled={busy}
                onClick={onConfirmNew}
              >
                Confirm logger and review again
              </button>
            </div>
          )}
        </div>
      ) : null}

      {needsMove ? (
        <p className="weekly__note">
          Use <button type="button" className="weekly__link-btn" onClick={onOpenMove}>Record a logger move</button>{" "}
          with the real date and time, then review again.
        </p>
      ) : null}

      {file.logger ? (
        <p className="weekly-file__meta">
          Logger: {file.logger.code}
          {file.logger.source ? ` (${loggerSourceLabel(file.logger.source)})` : ""}
        </p>
      ) : null}
    </article>
  );
}

function ImportResults({
  outcome,
  history,
  unresolvedLeft,
  onDismiss,
}: {
  outcome: UploadOutcome | null;
  history: UploadFileResult[];
  unresolvedLeft: number;
  onDismiss: () => void;
}) {
  const completed = history.length > 0 ? history : (outcome?.files ?? []).filter(isCompletedImport);
  const lastUnresolved = (outcome?.files ?? []).filter((f) => !isCompletedImport(f));

  return (
    <section className="weekly-card weekly-card--results" aria-labelledby="import-results">
      <div className="weekly-card__results-head">
        <h2 id="import-results" className="weekly-card__title">
          Import results
        </h2>
        <button type="button" className="weekly__link-btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <p className="weekly-card__help">
        {completed.length} file{completed.length === 1 ? "" : "s"} processed
        {unresolvedLeft > 0 ? ` · ${unresolvedLeft} still in this batch` : ""}.
      </p>
      {completed.length > 0 ? (
        <ul className="weekly-results">
          {completed.map((f, index) => (
            <li
              key={`done-${index}-${f.filename}`}
              className={`weekly-results__item weekly-results__item--${isAlreadyImported(f) ? "duplicate" : f.status}`}
            >
              <strong>{f.filename}</strong>
              <span className="weekly-results__status">{importStatusLabel(f)}</span>
              <span className="weekly-results__detail">{importStatusDetail(f)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {lastUnresolved.length > 0 ? (
        <>
          <h3 className="weekly-card__subtitle">Not imported</h3>
          <ul className="weekly-results">
            {lastUnresolved.map((f) => (
              <li
                key={`open-${f.file_index}-${f.filename}`}
                className={`weekly-results__item weekly-results__item--${f.status}`}
              >
                <strong>{f.filename}</strong>
                <span className="weekly-results__status">{importStatusLabel(f)}</span>
                <span className="weekly-results__detail">{plainIssue(f)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {unresolvedLeft > 0 ? (
        <div className="weekly__banner weekly__banner--amber" role="status">
          {unresolvedLeft === 1
            ? "1 file remains in the batch below. Continue editing it — you do not need to select it again."
            : `${unresolvedLeft} files remain in the batch below. Continue editing them — you do not need to select them again.`}
        </div>
      ) : null}
    </section>
  );
}

function importStatusLabel(file: UploadFileResult): string {
  if (isAlreadyImported(file)) return "Already imported";
  switch (file.status) {
    case "imported":
      return "Imported";
    case "ready":
      return "Ready (not imported)";
    case "needs_attention":
      return "Needs attention";
    case "invalid":
      return "Invalid";
    case "failed":
      return "Failed";
    default:
      return file.status;
  }
}

function importStatusDetail(file: UploadFileResult): string {
  if (isAlreadyImported(file)) {
    return "All readings were duplicates. Nothing new was saved.";
  }
  if (file.status === "imported") {
    const parts = [
      `${file.inserted} reading${file.inserted === 1 ? "" : "s"} saved`,
    ];
    if (file.duplicates > 0) {
      parts.push(
        `${file.duplicates} duplicate${file.duplicates === 1 ? "" : "s"} skipped`,
      );
    }
    if (file.conflicts.length > 0) {
      parts.push(
        `${file.conflicts.length} conflict${file.conflicts.length === 1 ? "" : "s"}`,
      );
    }
    if (file.fridge_conflicts.length > 0) {
      parts.push(
        `${file.fridge_conflicts.length} fridge conflict${file.fridge_conflicts.length === 1 ? "" : "s"}`,
      );
    }
    if (file.rejected_total > 0) {
      parts.push(`${file.rejected_total} rejected`);
    }
    return parts.join(" · ");
  }
  return plainIssue(file);
}
