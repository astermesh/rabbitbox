/**
 * AMQP 0-9-1 reply codes as defined in the specification.
 * Verified against amqp0-9-1.extended.xml.
 */

// ── Success ──────────────────────────────────────────────────────────

export const REPLY_SUCCESS = 200;

// ── Channel-level (soft) errors ──────────────────────────────────────

export const CONTENT_TOO_LARGE = 311;
export const NO_ROUTE = 312;
export const NO_CONSUMERS = 313;

export const ACCESS_REFUSED = 403;
export const NOT_FOUND = 404;
export const RESOURCE_LOCKED = 405;
export const PRECONDITION_FAILED = 406;

// ── Connection-level (hard) errors ───────────────────────────────────

export const CONNECTION_FORCED = 320;

export const INVALID_PATH = 402;

export const FRAME_ERROR = 501;
export const SYNTAX_ERROR = 502;
export const COMMAND_INVALID = 503;
export const CHANNEL_ERROR = 504;
export const UNEXPECTED_FRAME = 505;
export const RESOURCE_ERROR = 506;

export const NOT_ALLOWED = 530;
export const NOT_IMPLEMENTED = 540;
export const INTERNAL_ERROR = 541;
