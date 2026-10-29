type DiffKind = 'same' | 'removed' | 'added';

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

export interface WordDiff {
  expected: DiffSegment[];
  actual: DiffSegment[];
}

const TOKEN = /\s+|[^\s]+/gu;

function tokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function longestCommonSubsequence(left: readonly string[], right: readonly string[]): boolean[][] {
  const table = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      const below = table[row + 1]?.[column] ?? 0;
      const across = table[row]?.[column + 1] ?? 0;
      const diagonal = table[row + 1]?.[column + 1] ?? 0;
      const current = table[row];
      if (current !== undefined) {
        current[column] = left[row] === right[column] ? diagonal + 1 : Math.max(below, across);
      }
    }
  }

  const keptLeft = Array.from({ length: left.length }, () => false);
  const keptRight = Array.from({ length: right.length }, () => false);
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      keptLeft[row] = true;
      keptRight[column] = true;
      row += 1;
      column += 1;
    } else if ((table[row + 1]?.[column] ?? 0) >= (table[row]?.[column + 1] ?? 0)) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return [keptLeft, keptRight];
}

function segments(
  parts: readonly string[],
  kept: readonly boolean[],
  changed: DiffKind,
): DiffSegment[] {
  const result: DiffSegment[] = [];
  parts.forEach((text, index) => {
    const isWhitespace = text.trim() === '';
    const kind: DiffKind = kept[index] === true || isWhitespace ? 'same' : changed;
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text;
    else result.push({ kind, text });
  });
  return result;
}

export function diffWords(expected: string, actual: string): WordDiff {
  const left = tokens(expected);
  const right = tokens(actual);
  const [keptLeft = [], keptRight = []] = longestCommonSubsequence(left, right);
  return {
    expected: segments(left, keptLeft, 'removed'),
    actual: segments(right, keptRight, 'added'),
  };
}
