// 제품명 정규화: 공백·특수문자 제거, 영문 대소문자 통일 (요구사항정의서 R1-F-03 2단계)
export function normalizeProductName(raw) {
  return raw
    .toUpperCase()
    .replace(/[\s\-_./()[\]]/g, '');
}
