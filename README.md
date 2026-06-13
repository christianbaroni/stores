# Stores

Stores provides a minimal, reactive state layer that runs with or without React.

It defines three types of runtime-evaluated stores—**base**, **derived**, and **query**—each representing a distinct state type: local, computed, or asynchronously fetched. Stores track dependencies at runtime, evaluate lazily, and clean up automatically when unused.

All stores expose a consistent interface and can be used both inside and outside React. Each store is a node. Together they form a composed graph.

- **Base stores** define synchronous local state with explicit update methods.
- **Derived stores** compute values from other stores and re-run only when inputs change.
- **Query stores** fetch and cache async data, refetching when reactive parameters change.

All store types expose a stable store object with `.getState()` and
`.subscribe()`, plus optional support for persistence. In the React build,
stores are also callable hooks. In the vanilla build, stores remain plain store
objects. They compose naturally, interoperate cleanly, and scale as application
complexity grows.

## Runtime Modes

The root import is mode-aware:

- React web apps use `@storesjs/stores` by default.
- React Native apps use `@storesjs/stores`; the `react-native` package condition selects the native build.
- Vanilla apps use `@storesjs/stores` with the `vanilla` package condition enabled.

For TypeScript vanilla projects, use a condition-aware resolver and add the
same condition to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "customConditions": ["vanilla"]
  }
}
```

## Base Store

A base store defines local state along with an interface for reading and
updating that state.

```ts
export const settingsStore = createBaseStore<Settings>(set => ({
  currency: 'USD',
  setCurrency: currency => set({ currency }),
}));
```

In React, subscribe to values with selectors:

```ts
const currency = settingsStore(s => s.currency);
```

Outside React:

```ts
settingsStore.getState().currency;
settingsStore.subscribe(selector, listener, options);
```

Enable persistence per store:

```ts
createBaseStore<Settings>(set => ({ ... }), {
  storageKey: 'settings',
  partialize: state => ({ currency: state.currency }),
});
```

You can also export actions as a stable object:

```ts
export const settingsActions = createStoreActions(settingsStore);
```

## Derived Store

Derived stores compute values from other stores. The `$` accessor tracks
dependencies at runtime:

```ts
export const totalStore = createDerivedStore($ => {
  const { currency } = $(settingsStore);
  const { subtotal, tax } = $(cartStore);
  return formatTotal(currency, subtotal, tax);
});
```

If `currency`, `subtotal`, or `tax` change, the store re-computes.

If the store is not observed, nothing runs.

## Query Store

Query stores manage remote data. They fetch, cache, and revalidate based
on reactive parameters:

```ts
export const accountStore = createQueryStore<Account, Params>({
  fetcher: fetchAccount,
  params: {
    userId: $ => $(authStore).userId,
  },
  staleTime: time.minutes(10),
});
```

When `userId` changes, the store refetches. If unobserved, it remains
idle.

Use it in React:

```ts
const account = accountStore(s => s.getData());
```

Or imperatively:

```ts
accountStore.getState().fetch();
```

Query stores support full customization: extended local state, manual cache control, configurable staleness and retry behavior, and optional persistence.

They deduplicate fetches across consumers and compute stable query keys automatically.

## Store Interface

All stores implement the same store-object API:

```ts
store.getState()
store.setState() // Except for derived stores
store.subscribe(selector, listener, options?)
```

In the React build, stores are also callable hooks:

```ts
store()
store(selector, equalityFn?)
```

## Composed Example

```ts
export const currencyFormatterStore = createDerivedStore($ => {
  const { currency, locale } = $(settingsStore);
  return new Intl.NumberFormat(locale, {
    currency,
    style: 'currency',
  });
});
```

```ts
export const accountBalanceStore = createDerivedStore($ => {
  const balance = $(accountStore).getData()?.balance ?? 0;
  const formatter = $(currencyFormatterStore);
  return formatter.format(balance);
});
```

```ts
function AccountSummary() {
  const balance = accountBalanceStore();
  return <Text>Balance: {balance}</Text>;
}
```
