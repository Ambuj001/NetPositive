export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, msg, details) => new HttpError(400, code, msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (code = 'forbidden', msg) => new HttpError(403, code, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const conflict = (code, msg) => new HttpError(409, code, msg);
