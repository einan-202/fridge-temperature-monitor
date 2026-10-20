/** Numeric-aware filename order so 01, 02, 10 stay in sequence. */
export function compareFilenames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortFilesNaturally(files: readonly File[]): File[] {
  return [...files].sort((a, b) => compareFilenames(a.name, b.name));
}

export function remapRecordByFileIdentity<T>(
  prevFiles: readonly File[],
  nextFiles: readonly File[],
  prev: Record<number, T>,
): Record<number, T> {
  const oldIndex = new Map<File, number>();
  prevFiles.forEach((file, index) => oldIndex.set(file, index));
  const next: Record<number, T> = {};
  nextFiles.forEach((file, index) => {
    const from = oldIndex.get(file);
    if (from !== undefined && Object.prototype.hasOwnProperty.call(prev, from)) {
      next[index] = prev[from];
    }
  });
  return next;
}

export function remapKeyedByFileIdentity<T>(
  prevFiles: readonly File[],
  nextFiles: readonly File[],
  prev: Record<string, T>,
): Record<string, T> {
  const numbered: Record<number, T> = {};
  for (const [key, value] of Object.entries(prev)) {
    numbered[Number(key)] = value;
  }
  const remapped = remapRecordByFileIdentity(prevFiles, nextFiles, numbered);
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(remapped)) {
    next[String(key)] = value;
  }
  return next;
}
