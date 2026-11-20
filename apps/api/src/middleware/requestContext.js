import { randomUUID } from 'node:crypto';

const INCOMING_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Assigns a request id (honouring a sane upstream X-Request-Id) and echoes it back. */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/** Client metadata recorded on sessions and activity logs. */
export function clientContext(req) {
  return {
    ip: req.ip?.slice(0, 64),
    userAgent: req.get('user-agent')?.slice(0, 512),
  };
}
