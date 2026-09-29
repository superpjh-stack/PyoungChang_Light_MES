import { Router } from 'express';
import * as customerRepo from '../repositories/customerRepository.js';

export function customersRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const missingErpMapping = req.query.missingErpMapping === 'true';
    res.json(customerRepo.listCustomers(db, { missingErpMapping }));
  });

  router.post('/', (req, res, next) => {
    try {
      const created = customerRepo.createCustomer(db, req.body ?? {});
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:code', (req, res) => {
    const customer = customerRepo.getCustomer(db, req.params.code);
    if (!customer) return res.status(404).json({ error: '거래처를 찾을 수 없습니다' });
    res.json(customer);
  });

  router.put('/:code', (req, res) => {
    const updated = customerRepo.updateCustomer(db, req.params.code, req.body ?? {});
    if (!updated) return res.status(404).json({ error: '거래처를 찾을 수 없습니다' });
    res.json(updated);
  });

  router.get('/:code/delivery-sites', (req, res) => {
    res.json(customerRepo.listDeliverySites(db, req.params.code));
  });

  router.post('/:code/delivery-sites', (req, res, next) => {
    try {
      const site = customerRepo.addDeliverySite(db, req.params.code, req.body ?? {});
      res.status(201).json(site);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:code/prices', (req, res) => {
    res.json(customerRepo.listCustomerPrices(db, req.params.code));
  });

  router.post('/:code/prices', (req, res, next) => {
    try {
      const prices = customerRepo.addCustomerPrice(db, req.params.code, req.body ?? {});
      res.status(201).json(prices);
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
