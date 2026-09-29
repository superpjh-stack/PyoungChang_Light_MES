import { Router } from 'express';
import * as userRepo from '../repositories/userRepository.js';

export function usersRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(userRepo.listUsers(db));
  });

  router.post('/', (req, res, next) => {
    try {
      res.status(201).json(userRepo.createUser(db, req.body ?? {}));
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
