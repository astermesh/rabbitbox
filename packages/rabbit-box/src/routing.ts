import type { Exchange } from './types/exchange.ts';
import type { Binding } from './types/binding.ts';
import { channelError } from './errors/factories.ts';

/** AMQP class/method IDs for queue.bind (where x-match validation occurs). */
const QUEUE_CLASS_ID = 50;
const QUEUE_BIND_METHOD_ID = 20;

/**
 * Direct exchange routing: exact string equality.
 */
export function directMatch(routingKey: string, bindingKey: string): boolean {
  return routingKey === bindingKey;
}

/**
 * Fanout exchange routing: always matches.
 */
export function fanoutMatch(): boolean {
  return true;
}

/**
 * Topic exchange routing: dot-separated word matching with wildcards.
 *
 * - `*` matches exactly one word
 * - `#` matches zero or more words
 *
 * Uses recursive matching as recommended in research (correctness over performance).
 */
export function topicMatch(routingKey: string, pattern: string): boolean {
  // Both empty → match
  if (routingKey === '' && pattern === '') return true;

  // # alone matches everything including empty
  if (pattern === '#') return true;

  const routingWords = routingKey === '' ? [] : routingKey.split('.');
  const patternWords = pattern === '' ? [] : pattern.split('.');

  return topicMatchWords(routingWords, 0, patternWords, 0);
}

function topicMatchWords(
  rWords: string[],
  ri: number,
  pWords: string[],
  pi: number,
): boolean {
  // Both exhausted → match
  if (ri === rWords.length && pi === pWords.length) return true;

  // Pattern exhausted but routing words remain → no match
  if (pi === pWords.length) return false;

  const pWord = pWords[pi];

  if (pWord === '#') {
    // # at the end of pattern always matches remaining
    if (pi === pWords.length - 1) return true;

    // # in the middle: try consuming 0, 1, 2, ... routing words
    for (let skip = 0; skip <= rWords.length - ri; skip++) {
      if (topicMatchWords(rWords, ri + skip, pWords, pi + 1)) {
        return true;
      }
    }
    return false;
  }

  // Routing words exhausted but pattern has non-# words remaining → no match
  if (ri === rWords.length) return false;

  if (pWord === '*') {
    // * matches exactly one word
    return topicMatchWords(rWords, ri + 1, pWords, pi + 1);
  }

  // Exact word comparison
  if (rWords[ri] === pWord) {
    return topicMatchWords(rWords, ri + 1, pWords, pi + 1);
  }

  return false;
}

/** Valid x-match modes. */
const VALID_X_MATCH_MODES = new Set([
  'all',
  'any',
  'all-with-x',
  'any-with-x',
]);

/**
 * Headers exchange routing: match message headers against binding arguments.
 *
 * Modes:
 * - `all` (default): all binding args (excluding x-* keys) must match
 * - `any`: at least one binding arg (excluding x-* keys) must match
 * - `all-with-x`: all binding args (including x-* keys) must match
 * - `any-with-x`: at least one binding arg (including x-* keys) must match
 *
 * The `x-match` key itself is always excluded from comparison.
 * Void-typed (undefined) binding arg values check key presence only.
 */
export function headersMatch(
  messageHeaders: Record<string, unknown>,
  bindingArgs: Record<string, unknown>,
): boolean {
  const xMatch = (bindingArgs['x-match'] as string | undefined) ?? 'all';

  if (!VALID_X_MATCH_MODES.has(xMatch)) {
    throw channelError.preconditionFailed(
      `invalid x-match value '${xMatch}': expected all, any, all-with-x, or any-with-x`,
      QUEUE_CLASS_ID,
      QUEUE_BIND_METHOD_ID,
    );
  }

  const includeX = xMatch === 'all-with-x' || xMatch === 'any-with-x';
  const requireAll = xMatch === 'all' || xMatch === 'all-with-x';

  // Build comparison set: binding args minus x-match, and optionally minus x-* keys
  const comparisonKeys: string[] = [];
  for (const key of Object.keys(bindingArgs)) {
    if (key === 'x-match') continue;
    if (!includeX && key.startsWith('x-')) continue;
    comparisonKeys.push(key);
  }

  if (comparisonKeys.length === 0) {
    // No comparison keys: "all" with nothing = true, "any" with nothing = false
    return requireAll;
  }

  for (const key of comparisonKeys) {
    const bindingValue = bindingArgs[key];
    const isVoid = bindingValue === undefined;

    let matches: boolean;
    if (isVoid) {
      // Void-typed: check key presence only
      matches = key in messageHeaders;
    } else {
      matches = messageHeaders[key] === bindingValue;
    }

    if (requireAll && !matches) return false;
    if (!requireAll && matches) return true;
  }

  // If requireAll and we got here, all matched
  // If !requireAll (any) and we got here, none matched
  return requireAll;
}

/**
 * Route a message through an exchange, returning all matched bindings.
 *
 * Dispatches to the correct matcher based on exchange type.
 *
 * @param exchange - The exchange to route through
 * @param bindings - All bindings for this exchange
 * @param routingKey - The message routing key
 * @param messageHeaders - Message headers (required for headers exchange)
 * @returns Array of matched bindings
 */
export function route(
  exchange: Exchange,
  bindings: readonly Binding[],
  routingKey: string,
  messageHeaders?: Record<string, unknown>,
): Binding[] {
  switch (exchange.type) {
    case 'direct':
      return bindings.filter((b) => directMatch(routingKey, b.routingKey));

    case 'fanout':
      return bindings.filter(() => fanoutMatch());

    case 'topic':
      return bindings.filter((b) => topicMatch(routingKey, b.routingKey));

    case 'headers':
      return bindings.filter((b) =>
        headersMatch(messageHeaders ?? {}, b.arguments),
      );
  }
}
