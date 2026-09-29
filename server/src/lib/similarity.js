// 문자열 유사도(편집거리 기반) + 규격 토큰 매칭 (요구사항정의서 R1-F-03 3단계)

export function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const currRow = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // 삭제
        currRow[j - 1] + 1, // 삽입
        prevRow[j - 1] + cost // 치환
      );
    }
    prevRow = currRow;
  }
  return prevRow[n];
}

export function similarityScore(a, b) {
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// 규격 토큰 추출: 숫자+단위 (예: 10kg, 500g, 1.5L)
const SIZE_TOKEN_RE = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|box|ea)/i;

export function extractSizeToken(text) {
  const match = SIZE_TOKEN_RE.exec(text ?? '');
  if (!match) return null;
  return `${match[1]}${match[2]}`.toUpperCase();
}
