export interface KiwoomErrorDetails {
  httpStatus?: number;
  returnCode?: number;
  apiId?: string;
}

/** Error from the Kiwoom REST API, already translated to a human-readable message. */
export class KiwoomApiError extends Error {
  readonly details: KiwoomErrorDetails;

  constructor(message: string, details: KiwoomErrorDetails = {}) {
    super(message);
    this.name = "KiwoomApiError";
    this.details = details;
  }
}

export class KiwoomAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KiwoomAuthError";
  }
}
