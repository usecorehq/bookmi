/**
 * Stub that satisfies Drizzle's fluent API for the reads exercised by e2e
 * specs. Each `select()` starts a thenable chain, so awaiting it at any
 * point (with or without a terminal `.limit()`) resolves to an empty array.
 *
 * The ROOT object must stay non-thenable: Nest's instance loader resolves
 * provider dependencies through `Promise.all`, which unwraps thenables — a
 * `then` on the root would inject `[]` instead of the fake.
 */
export function fakeDb() {
  return {
    select: () => fakeChain(),
    insert: () => fakeChain(),
    update: () => fakeChain(),
    delete: () => fakeChain(),
    execute: () => Promise.resolve([]),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb()),
  };
}

function fakeChain() {
  const chain: Record<string, unknown> = {};
  const noop = () => chain;
  chain.from = noop;
  chain.where = noop;
  chain.orderBy = noop;
  chain.leftJoin = noop;
  chain.innerJoin = noop;
  chain.values = noop;
  chain.set = noop;
  chain.onConflictDoUpdate = noop;
  chain.onConflictDoNothing = noop;
  chain.returning = () => Promise.resolve([]);
  chain.limit = () => Promise.resolve([]);
  chain.then = (
    resolve?: (rows: unknown[]) => unknown,
    reject?: (err: unknown) => unknown,
  ) => Promise.resolve([]).then(resolve, reject);
  return chain;
}
