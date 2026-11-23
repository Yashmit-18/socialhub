#!/usr/bin/env node
// Prints freshly generated secrets for apps/api/.env. Never commit real values.
import { randomBytes } from 'node:crypto';

console.log(`JWT_ACCESS_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
// Optional: only if you want GET /api/v1/health/details for monitoring.
console.log(`HEALTH_DETAILS_TOKEN=${randomBytes(32).toString('base64url')}`);
