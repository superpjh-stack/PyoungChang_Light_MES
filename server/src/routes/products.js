import { Router } from 'express';
import * as productRepo from '../repositories/productRepository.js';
import * as aliasRepo from '../repositories/productAliasRepository.js';

export function productsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(productRepo.listProducts(db));
  });

  router.post('/', (req, res, next) => {
    try {
      res.status(201).json(productRepo.createProduct(db, req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:code', (req, res) => {
    const product = productRepo.getProduct(db, req.params.code);
    if (!product) return res.status(404).json({ error: '제품을 찾을 수 없습니다' });
    res.json(product);
  });

  router.put('/:code', (req, res) => {
    const updated = productRepo.updateProduct(db, req.params.code, req.body ?? {});
    if (!updated) return res.status(404).json({ error: '제품을 찾을 수 없습니다' });
    res.json(updated);
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return router;
}

export function productAliasesRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const { customer_code, product_code } = req.query;
    res.json(aliasRepo.listAliases(db, { customer_code, product_code }));
  });

  router.post('/', (req, res, next) => {
    try {
      res.status(201).json(aliasRepo.createAlias(db, req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  router.post('/bulk', (req, res, next) => {
    try {
      const aliases = Array.isArray(req.body) ? req.body : req.body?.aliases;
      if (!Array.isArray(aliases)) {
        const err = new Error('배열 형태의 aliases가 필요합니다');
        err.status = 400;
        throw err;
      }
      res.status(201).json(aliasRepo.bulkCreateAliases(db, aliases));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/use', (req, res, next) => {
    try {
      res.json(aliasRepo.recordAliasUsage(db, Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return router;
}
