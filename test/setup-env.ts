import { inject } from 'vitest';

export const E2E_DB_NAME = 'budget-master-e2e';

// Overwrite, so neither the prod .env nor CI's missing .env decides the target (process.env wins over .env).
process.env.MONGO_URI = inject('mongoUri');
process.env.MONGO_DB_NAME = E2E_DB_NAME;
process.env.FRONTEND_URI = 'http://localhost:4100';
process.env.TEST_FRONTEND_URI = 'http://localhost:4101';
process.env.DOMAIN_URI = 'http://localhost:4102';
process.env.NODE_ENV = 'test';
