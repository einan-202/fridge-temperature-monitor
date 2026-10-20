import type { UploadFileResult } from "../types/upload";

export interface MismatchGroup {
  field: string;
  found: string;
  expected: string;
  rows: number[];
}

export function groupMappingMismatches(
  mismatches: UploadFileResult["mapping_mismatches"],
): MismatchGroup[] {
  const groups = new Map<string, MismatchGroup>();
  for (const item of mismatches) {
    const key = `${item.field}\0${item.found}\0${item.expected}`;
    const group = groups.get(key) ?? {
      field: item.field,
      found: item.found,
      expected: item.expected,
      rows: [],
    };
    group.rows.push(item.row_number);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function loggerMismatchHeadline(group: MismatchGroup): string {
  const n = group.rows.length;
  const verb = n === 1 ? "contains" : "contain";
  return `${n} row${n === 1 ? "" : "s"} ${verb} ${group.found}, but ${group.expected} was selected.`;
}
