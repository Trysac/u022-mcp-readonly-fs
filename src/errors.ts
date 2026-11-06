/** Stable machine-readable codes of {@link PolicyError}. */
export type PolicyErrorCode = "MISSING_ROOT" | "INVALID_GLOB" | "INVALID_LIMIT";

/** Base error of the library, thrown while building a policy. */
export class PolicyError extends Error {
  /** Stable machine-readable code. */
  readonly code: PolicyErrorCode;

  /**
   * @param code - Machine-readable code.
   * @param message - Human readable text; it never contains secrets.
   */
  constructor(code: PolicyErrorCode, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}
