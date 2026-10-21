import { useMemo, useRef, useState } from "react";
import {
  importHistoricalUpload,
  reviewHistoricalUpload,
} from "../api/upload";
import type {
  HistoricalFridge,
  LoggerUnitInfo,
  UploadFileResult,
  UploadOutcome,
} from "../types/upload";

type Phase = "pick" | "review" | "results";
type TempUnit = "C" | "F";
type UnitChoice = TempUnit | "";

export interface InitialSetupProps {
  onOpenDashboard?: () => void;
  onOpenWeeklyUpload?: () => void;
}

function isXlsx(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

export function unitLabel(unit: string | null | undefined): string {
  if (unit === "F") return "Fahrenheit";
  if (unit === "C") return "Celsius";
  return "not set";
}

export function proposedSourceUnit(logger: LoggerUnitInfo): UnitChoice {
  return logger.unit === "C" || logger.unit === "F" ? logger.unit : "";
}

function fridgeLabel(fridge: HistoricalFridge): string {
  return `${fridge.branch} — ${fridge.name}`;
}

function needsNativeChoice(logger: LoggerUnitInfo): boolean {
  return logger.source === "unresolved" && logger.is_new;
}

function mapsReady(
  loggers: LoggerUnitInfo[],
  sourceUnits: Record<string, UnitChoice>,
  nativeUnits: Record<string, UnitChoice>,
): boolean {
  return loggers.every((logger) => {
    if (sourceUnits[logger.code] !== "C" && sourceUnits[logger.code] !== "F") {
      return false;
    }
    if (needsNativeChoice(logger) && nativeUnits[logger.code] !== "C" && nativeUnits[logger.code] !== "F") {
      return false;
    }
    return true;
  });
}

function buildMaps(
  loggers: LoggerUnitInfo[],
  sourceUnits: Record<string, UnitChoice>,
  nativeUnits: Record<string, UnitChoice>,
): { loggerUnits: Record<string, TempUnit>; sourceUnits: Record<string, TempUnit> } {
  const loggerUnits: Record<string, TempUnit> = {};
  const sources: Record<string, TempUnit> = {};
  for (const logger of loggers) {
    const source = sourceUnits[logger.code];
    if (source === "C" || source === "F") sources[logger.code] = source;
    if (needsNativeChoice(logger)) {
      const native = nativeUnits[logger.code];
      if (native === "C" || native === "F") loggerUnits[logger.code] = native;
    }
  }
  return { loggerUnits, sourceUnits: sources };
}

function mapsEqual(
  a: { loggerUnits: Record<string, TempUnit>; sourceUnits: Record<string, TempUnit> },
  b: { loggerUnits: Record<string, TempUnit>; sourceUnits: Record<string, TempUnit> },
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function seedChoices(loggers: LoggerUnitInfo[]): {
  sourceUnits: Record<string, UnitChoice>;
  nativeUnits: Record<string, UnitChoice>;
} {
  const sourceUnits: Record<string, UnitChoice> = {};
  const nativeUnits: Record<string, UnitChoice> = {};
  for (const logger of loggers) {
    sourceUnits[logger.code] = proposedSourceUnit(logger);
    nativeUnits[logger.code] = needsNativeChoice(logger) ? "" : (logger.unit ?? "");
  }
  return { sourceUnits, nativeUnits };
}

function countLine(label: string, value: number | undefined): string | null {
  if (value == null) return null;
  return `${label}: ${value}`;
}

export function InitialSetup({ onOpenDashboard, onOpenWeeklyUpload }: InitialSetupProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [unsupportedNote, setUnsupportedNote] = useState<string | null>(null);
  const [mapping, setMapping] = useState<UploadOutcome | null>(null);
  const [preview, setPreview] = useState<UploadOutcome | null>(null);
  const [result, setResult] = useState<UploadOutcome | null>(null);
  const [sourceUnits, setSourceUnits] = useState<Record<string, UnitChoice>>({});
  const [nativeUnits, setNativeUnits] = useState<Record<string, UnitChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const previewMaps = useRef<{
    loggerUnits: Record<string, TempUnit>;
    sourceUnits: Record<string, TempUnit>;
  } | null>(null);

  const loggers = mapping?.logger_units ?? mapping?.historical?.logger_units ?? [];
  const fridges = mapping?.historical?.fridges ?? [];
  const currentMaps = useMemo(
    () => buildMaps(loggers, sourceUnits, nativeUnits),
    [loggers, sourceUnits, nativeUnits],
  );
  const unitsComplete = mapsReady(loggers, sourceUnits, nativeUnits);
  const previewMatches =
    preview != null &&
    previewMaps.current != null &&
    mapsEqual(currentMaps, previewMaps.current);
  const previewReady =
    previewMatches &&
    preview?.blocked !== true &&
    preview?.files[0]?.status === "ready";

  const onPickFile = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = list[0];
    if (!isXlsx(picked)) {
      setUnsupportedNote("Only .xlsx Excel files are supported.");
      setFile(null);
      return;
    }
    setUnsupportedNote(null);
    setFile(picked);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setError(null);
    previewMaps.current = null;
    setPhase("pick");
  };

  const runMappingReview = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    previewMaps.current = null;
    try {
      const outcome = await reviewHistoricalUpload({ file });
      setMapping(outcome);
      const nextLoggers = outcome.logger_units ?? outcome.historical?.logger_units ?? [];
      const seeded = seedChoices(nextLoggers);
      setSourceUnits(seeded.sourceUnits);
      setNativeUnits(seeded.nativeUnits);
      if (outcome.files[0]?.status === "invalid") {
        setError(outcome.files[0].message ?? outcome.message ?? "This file could not be read.");
        setPhase("pick");
        return;
      }
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not review this file");
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!file || busy || !unitsComplete) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await reviewHistoricalUpload({
        file,
        loggerUnits: currentMaps.loggerUnits,
        sourceUnits: currentMaps.sourceUnits,
      });
      setPreview(outcome);
      previewMaps.current = currentMaps;
      if (outcome.blocked || outcome.files[0]?.status === "invalid") {
        setError(
          outcome.files[0]?.message ??
            outcome.message ??
            "Could not preview this import. Check the units and try again.",
        );
      }
    } catch (err) {
      setPreview(null);
      previewMaps.current = null;
      setError(err instanceof Error ? err.message : "Could not preview this import");
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!file || busy || !previewReady || importLock.current) return;
    importLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const outcome = await importHistoricalUpload({
        file,
        loggerUnits: currentMaps.loggerUnits,
        sourceUnits: currentMaps.sourceUnits,
      });
      setResult(outcome);
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      importLock.current = false;
    }
  };

  const onStartOver = () => {
    setFile(null);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setSourceUnits({});
    setNativeUnits({});
    setError(null);
    setUnsupportedNote(null);
    setPhase("pick");
    previewMaps.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const setSource = (code: string, unit: UnitChoice) => {
    setSourceUnits((prev) => ({ ...prev, [code]: unit }));
    setPreview(null);
    previewMaps.current = null;
  };

  const setNative = (code: string, unit: UnitChoice) => {
    setNativeUnits((prev) => ({ ...prev, [code]: unit }));
    setSourceUnits((prev) => (prev[code] ? prev : { ...prev, [code]: unit }));
    setPreview(null);
    previewMaps.current = null;
  };

  const fileResult: UploadFileResult | undefined = (result ?? preview)?.files[0];
  const counts = previewReady ? preview?.historical : undefined;

  return (
    <div className="weekly">
      <header className="weekly__header">
        <h1 className="weekly__title">Initial Setup</h1>
        <p className="weekly__subtitle">
          Load your existing temperature Excel file once. Weekly files can be added later.
        </p>
      </header>

      {error ? (
        <div className="weekly__banner weekly__banner--error" role="alert">
          {error}
        </div>
      ) : null}

      {phase !== "results" ? (
        <section className="weekly-card weekly-card--picker" aria-labelledby="setup-pick-heading">
          <h2 id="setup-pick-heading" className="weekly-card__title">
            1. Select file
          </h2>
          <p className="weekly-card__help">
            Choose one Excel file (.xlsx) that lists logger, city, fridge, time and temperature.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="weekly__file-input"
            aria-label="Select historical Excel file"
            onChange={(e) => onPickFile(e.target.files)}
          />
          {unsupportedNote ? (
            <p className="weekly__note weekly__note--amber">{unsupportedNote}</p>
          ) : null}
          {file ? <p className="weekly__file-count">Selected: {file.name}</p> : null}
          <div className="weekly__actions">
            <button
              type="button"
              className="weekly-btn weekly-btn--primary"
              disabled={!file || busy}
              onClick={() => void runMappingReview()}
            >
              {busy && phase === "pick" ? "Reviewing…" : "Review file"}
            </button>
          </div>
        </section>
      ) : null}

      {phase === "review" ? (
        <section className="weekly-review" aria-labelledby="setup-review-heading">
          <h2 id="setup-review-heading" className="weekly-card__title">
            2. Check fridges and temperature units
          </h2>
          <p className="weekly-card__help">
            Units must match the numbers in this Excel file. Suggested units come from each
            logger’s usual device setting. Change a unit only if this file was already converted.
          </p>

          {fridges.length > 0 ? (
            <div className="weekly-card">
              <h3 className="weekly-card__subtitle">Fridges in this file</h3>
              <ul className="weekly-fridge-list">
                {fridges.map((fridge) => (
                  <li key={`${fridge.branch}-${fridge.name}`}>{fridgeLabel(fridge)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="weekly-card">
              <h3 className="weekly-card__subtitle">Temperature units</h3>
            {loggers.length === 0 ? (
              <p className="weekly-card__help">No loggers were found in this file.</p>
            ) : (
              loggers.map((logger) => (
                <LoggerUnitRow
                  key={logger.code}
                  logger={logger}
                  sourceUnit={sourceUnits[logger.code] ?? ""}
                  nativeUnit={nativeUnits[logger.code] ?? ""}
                  onSourceChange={(unit) => setSource(logger.code, unit)}
                  onNativeChange={(unit) => setNative(logger.code, unit)}
                />
              ))
            )}
          </div>

          <div className="weekly__actions">
            <button
              type="button"
              className="weekly-btn weekly-btn--secondary"
              disabled={!unitsComplete || busy}
              onClick={() => void runPreview()}
            >
              {busy && !previewReady ? "Previewing…" : "Preview import"}
            </button>
          </div>

          {previewReady && counts ? (
            <div className="weekly-card weekly-card--muted">
              <h3 className="weekly-card__subtitle">3. Confirm these units</h3>
              <p className="weekly-card__help">
                We will treat the numbers in this file as shown below. This does not change the
                logger’s usual device unit used for later weekly files.
              </p>
              <ul className="weekly-fridge-list">
                {loggers.map((logger) => (
                  <li key={`confirm-${logger.code}`}>
                    {logger.code}
                    {logger.branch ? ` (${logger.branch})` : ""}:{" "}
                    {unitLabel(sourceUnits[logger.code])}
                    {needsNativeChoice(logger)
                      ? ` in this file · device ${unitLabel(nativeUnits[logger.code])}`
                      : ` in this file · device stays ${unitLabel(logger.unit)}`}
                  </li>
                ))}
              </ul>
              <p className="weekly__file-count">
                {[
                  countLine("New readings", counts.inserted),
                  countLine("Duplicate readings", counts.duplicates),
                  countLine("Conflicting readings", counts.conflicts),
                  countLine("Same time, different fridge", counts.fridge_conflicts),
                  countLine("Rows that could not be read", counts.rejected_total),
                  countLine("Invalid temperature readings", counts.invalid_values),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {fileResult && fileResult.rejected.length > 0 ? (
                <RejectedList file={fileResult} />
              ) : null}
              {fileResult && fileResult.conflicts.length > 0 ? (
                <p className="weekly-file__issue">
                  {fileResult.conflicts.length} conflict
                  {fileResult.conflicts.length === 1 ? "" : "s"} will be reported and the first
                  stored reading will be kept.
                </p>
              ) : null}
              <div className="weekly__actions">
                <button
                  type="button"
                  className="weekly-btn weekly-btn--primary"
                  disabled={!previewReady || busy}
                  onClick={() => void runImport()}
                >
                  {busy ? "Importing…" : "Import"}
                </button>
              </div>
            </div>
          ) : (
            <p className="weekly__note">
              Import stays off until you preview with the confirmed units.
            </p>
          )}
        </section>
      ) : null}

      {phase === "results" && result ? (
        <ResultCard
          result={result}
          onDashboard={onOpenDashboard}
          onWeekly={onOpenWeeklyUpload}
          onStartOver={onStartOver}
        />
      ) : null}
    </div>
  );
}

function LoggerUnitRow({
  logger,
  sourceUnit,
  nativeUnit,
  onSourceChange,
  onNativeChange,
}: {
  logger: LoggerUnitInfo;
  sourceUnit: UnitChoice;
  nativeUnit: UnitChoice;
  onSourceChange: (unit: UnitChoice) => void;
  onNativeChange: (unit: UnitChoice) => void;
}) {
  const askNative = needsNativeChoice(logger);
  return (
    <div className="weekly-logger">
      <p className="weekly-logger__code">
        {logger.code}
        {logger.branch ? <span className="weekly-logger__meta"> · {logger.branch}</span> : null}
      </p>
      {askNative ? (
        <fieldset className="weekly-units">
          <legend>Usual device unit</legend>
          <label>
            <input
              type="radio"
              name={`native-${logger.code}`}
              checked={nativeUnit === "C"}
              onChange={() => onNativeChange("C")}
            />
            Celsius
          </label>
          <label>
            <input
              type="radio"
              name={`native-${logger.code}`}
              checked={nativeUnit === "F"}
              onChange={() => onNativeChange("F")}
            />
            Fahrenheit
          </label>
        </fieldset>
      ) : (
        <p className="weekly-logger__native">
          Usual device unit: {unitLabel(logger.unit)} (kept as-is)
        </p>
      )}
      <fieldset className="weekly-units">
        <legend>Unit in this Excel file</legend>
        <label>
          <input
            type="radio"
            name={`source-${logger.code}`}
            checked={sourceUnit === "C"}
            onChange={() => onSourceChange("C")}
          />
          Celsius
        </label>
        <label>
          <input
            type="radio"
            name={`source-${logger.code}`}
            checked={sourceUnit === "F"}
            onChange={() => onSourceChange("F")}
          />
          Fahrenheit
        </label>
      </fieldset>
    </div>
  );
}

function RejectedList({ file }: { file: UploadFileResult }) {
  return (
    <div className="weekly-file__errors">
      <p className="weekly-file__errors-title">
        Rows that could not be read ({file.rejected_total}
        {file.rejected_total > file.rejected.length ? ", first 100 shown" : ""})
      </p>
      <ul>
        {file.rejected.map((row) => (
          <li key={`${row.row_number}-${row.reason}`}>
            Row {row.row_number}: {row.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultCard({
  result,
  onDashboard,
  onWeekly,
  onStartOver,
}: {
  result: UploadOutcome;
  onDashboard?: () => void;
  onWeekly?: () => void;
  onStartOver: () => void;
}) {
  const file = result.files[0];
  const hist = result.historical;
  const multiFridge =
    (hist?.fridges ?? []).length > 1 &&
    new Set((result.logger_units ?? hist?.logger_units ?? []).map((l) => l.code)).size <
      (hist?.fridges ?? []).length;
  const alreadyImported = file?.status === "imported" && file.inserted === 0 && file.duplicates > 0;

  return (
    <section className="weekly-card weekly-card--results" aria-labelledby="setup-result-heading">
      <h2 id="setup-result-heading" className="weekly-card__title">
        Import complete
      </h2>
      {alreadyImported ? (
        <p className="weekly-card__help">
          All readings were already in the report. Nothing new was saved.
        </p>
      ) : (
        <p className="weekly-card__help">
          {[
            countLine("New readings", hist?.inserted ?? file?.inserted),
            countLine("Duplicate readings", hist?.duplicates ?? file?.duplicates),
            countLine("Conflicting readings", hist?.conflicts ?? file?.conflicts.length),
            countLine("Rows that could not be read", hist?.rejected_total ?? file?.rejected_total),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {file && file.rejected.length > 0 ? <RejectedList file={file} /> : null}
      {multiFridge ? (
        <p className="weekly-card__help">
          A logger listed under more than one fridge will need a recorded move in Weekly Upload
          before later weekly files can be assigned automatically.
        </p>
      ) : null}
      <div className="weekly__actions">
        {onDashboard ? (
          <button type="button" className="weekly-btn weekly-btn--primary" onClick={onDashboard}>
            View dashboard
          </button>
        ) : null}
        {onWeekly ? (
          <button type="button" className="weekly-btn weekly-btn--secondary" onClick={onWeekly}>
            Weekly Upload
          </button>
        ) : null}
        <button type="button" className="weekly-btn weekly-btn--ghost" onClick={onStartOver}>
          Import another file
        </button>
      </div>
    </section>
  );
}
