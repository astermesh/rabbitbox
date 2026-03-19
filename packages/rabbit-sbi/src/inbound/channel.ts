// =============================================================================
// prefetch (basic.qos)
// =============================================================================

export interface PrefetchMeta {
  readonly previousCount: number;
  readonly channelConsumerCount: number;
  realDurationMs?: number;
}

export interface PrefetchCtx {
  readonly count: number;
  readonly global: boolean;
  readonly meta: PrefetchMeta;
}

export type PrefetchResult = undefined;

// =============================================================================
// confirmSelect
// =============================================================================

export interface ConfirmSelectMeta {
  readonly alreadyInConfirmMode: boolean;
  readonly channelIsTransactional: boolean;
  realDurationMs?: number;
}

export interface ConfirmSelectCtx {
  readonly meta: ConfirmSelectMeta;
}

export type ConfirmSelectResult = undefined;
