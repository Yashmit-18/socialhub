import { ERROR_CODES } from '@socialhub/shared';

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message = 'Bad request', details) =>
  new AppError(400, ERROR_CODES.BAD_REQUEST, message, details);

export const validationError = (details, message = 'Some fields are invalid') =>
  new AppError(422, ERROR_CODES.VALIDATION_ERROR, message, details);

export const unauthenticated = (
  message = 'Authentication required',
  code = ERROR_CODES.UNAUTHENTICATED,
) => new AppError(401, code, message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, ERROR_CODES.FORBIDDEN, message);

export const notFound = (message = 'Resource not found') =>
  new AppError(404, ERROR_CODES.NOT_FOUND, message);

export const conflict = (message = 'Resource already exists', details) =>
  new AppError(409, ERROR_CODES.CONFLICT, message, details);

export function isDuplicateKeyError(err) {
  return err?.code === 11000 || err?.cause?.code === 11000;
}
