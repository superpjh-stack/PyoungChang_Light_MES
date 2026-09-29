import * as customerRepo from '../repositories/customerRepository.js';
import * as productRepo from '../repositories/productRepository.js';

// R1-I-01: ERP→MES 거래처/제품/단가 마스터 동기화.
// 실제 연동 방식(API/DB View/파일)이 ERP 측과 미확정이라, R1-F-09와 같은 원칙으로
// "수동 Import(담당자가 ERP에서 내려받은 목록을 업로드)"를 1차 스텁으로 구현한다.
// 나중에 방식이 확정되면 이 서비스는 그대로 두고 자동 배치가 같은 함수를 호출하도록 바꾸면 된다.
function runImport(db, rows, upsertRow) {
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error('rows 배열이 필요합니다');
    err.status = 400;
    throw err;
  }
  const created = [];
  const updated = [];
  const errors = [];
  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const wasUpdate = upsertRow(row);
        (wasUpdate ? updated : created).push(row);
      } catch (err) {
        errors.push({ row, message: err.message });
      }
    }
  });
  tx();
  return { createdCount: created.length, updatedCount: updated.length, errors };
}

export function importCustomers(db, rows) {
  return runImport(db, rows, (row) => {
    if (!row.customer_code || !row.name) {
      const err = new Error('customer_code, name은 필수입니다');
      err.status = 400;
      throw err;
    }
    const existing = customerRepo.getCustomer(db, row.customer_code);
    if (existing) {
      customerRepo.updateCustomer(db, row.customer_code, row);
      return true;
    }
    customerRepo.createCustomer(db, row);
    return false;
  });
}

export function importProducts(db, rows) {
  return runImport(db, rows, (row) => {
    if (!row.product_code || !row.name) {
      const err = new Error('product_code, name은 필수입니다');
      err.status = 400;
      throw err;
    }
    const existing = productRepo.getProduct(db, row.product_code);
    if (existing) {
      productRepo.updateProduct(db, row.product_code, row);
      return true;
    }
    productRepo.createProduct(db, row);
    return false;
  });
}

export function importCustomerPrices(db, rows) {
  return runImport(db, rows, (row) => customerRepo.upsertCustomerPrice(db, row).updated);
}
