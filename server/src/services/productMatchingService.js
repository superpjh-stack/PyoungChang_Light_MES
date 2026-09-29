import { normalizeProductName } from '../lib/normalize.js';
import { similarityScore, extractSizeToken } from '../lib/similarity.js';
import * as aliasRepo from '../repositories/productAliasRepository.js';

const SIZE_TOKEN_BONUS = 0.15;
const MAX_CANDIDATES = 3;

// 요구사항정의서 R1-F-03 3단계 매핑: ①정확일치 → ②정규화일치 → ③유사도 추천
export function matchProductName(db, customerCode, rawName) {
  // 1단계: 정확 일치 (거래처코드 + 원본 표기 그대로)
  const exact = aliasRepo.getAlias(db, customerCode, rawName);
  if (exact) {
    const updated = aliasRepo.recordAliasUsage(db, exact.id);
    return { matchType: 'EXACT', product_code: exact.product_code, alias: updated, candidates: [] };
  }

  // 2단계: 정규화 일치 (공백/특수문자 제거, 대소문자 통일 후 같은 거래처의 다른 별칭과 비교)
  const normalizedKey = normalizeProductName(rawName);
  const normalizedMatch = db
    .prepare(
      `SELECT * FROM product_alias WHERE customer_code = ? AND normalized_key = ? ORDER BY use_count DESC LIMIT 1`
    )
    .get(customerCode, normalizedKey);
  if (normalizedMatch) {
    const newAlias = aliasRepo.createAlias(db, {
      customer_code: customerCode,
      raw_name: rawName,
      product_code: normalizedMatch.product_code,
      match_type: 'NORMALIZED',
    });
    const updated = aliasRepo.recordAliasUsage(db, newAlias.id);
    return { matchType: 'NORMALIZED', product_code: normalizedMatch.product_code, alias: updated, candidates: [] };
  }

  // 3단계: 유사도 추천 (편집거리 기반 + 규격 토큰 매칭 보너스, 후보 최대 3개)
  const rawSizeToken = extractSizeToken(rawName);
  const products = db.prepare('SELECT * FROM product').all();
  const candidates = products
    .map((product) => {
      const productText = normalizeProductName(`${product.name}${product.spec ?? ''}`);
      let score = similarityScore(normalizedKey, productText);
      const productSizeToken = extractSizeToken(product.spec ?? product.name);
      if (rawSizeToken && productSizeToken && rawSizeToken === productSizeToken) {
        score = Math.min(1, score + SIZE_TOKEN_BONUS);
      }
      return { product_code: product.product_code, name: product.name, score: Number(score.toFixed(4)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  return { matchType: candidates.length ? 'SUGGESTED' : 'NONE', product_code: null, candidates };
}

// 매핑 대기함: 업로드된 주문 라인 중 아직 표준코드가 없는 원본 표기를 (거래처, 표기명) 단위로 모아 보여준다
export function listPendingMappings(db) {
  return db
    .prepare(
      `SELECT o.customer_code, d.raw_product_name, COUNT(*) AS line_count, GROUP_CONCAT(DISTINCT d.order_no) AS order_nos
       FROM order_dtl d
       JOIN order_hdr o ON o.order_no = d.order_no
       WHERE d.product_code IS NULL
       GROUP BY o.customer_code, d.raw_product_name
       ORDER BY line_count DESC, o.customer_code`
    )
    .all()
    .map((row) => ({ ...row, order_nos: row.order_nos ? row.order_nos.split(',') : [] }));
}

// 매핑 대기함에서 담당자가 표준 제품을 확정하면: 별칭 학습 + 해당 원본표기를 쓴 모든 미매핑 주문 라인 일괄 갱신
export function resolvePendingMapping(db, { customer_code, raw_name, product_code, registered_by }) {
  const alias = aliasRepo.createAlias(db, {
    customer_code,
    raw_name,
    product_code,
    match_type: 'SUGGESTED_APPROVED',
    registered_by,
  });

  const pendingLines = db
    .prepare(
      `SELECT d.order_no, d.line_no, d.quantity, d.unit_price
       FROM order_dtl d
       JOIN order_hdr o ON o.order_no = d.order_no
       WHERE d.product_code IS NULL AND d.raw_product_name = ? AND o.customer_code = ?`
    )
    .all(raw_name, customer_code);

  const update = db.prepare(
    `UPDATE order_dtl SET product_code = ?, amount = ? WHERE order_no = ? AND line_no = ?`
  );
  const tx = db.transaction((lines) => {
    for (const line of lines) {
      const amount = line.unit_price != null ? line.quantity * line.unit_price : null;
      update.run(product_code, amount, line.order_no, line.line_no);
    }
  });
  tx(pendingLines);

  if (pendingLines.length > 0) {
    db.prepare(
      `UPDATE product_alias SET use_count = use_count + ?, last_used_at = datetime('now') WHERE id = ?`
    ).run(pendingLines.length, alias.id);
  }
  return { alias: aliasRepo.getAlias(db, customer_code, raw_name), updatedLines: pendingLines.length };
}
