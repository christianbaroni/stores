# Stores

Stores provides a minimal, reactive state layer built on top of Zustand.

It defines three types of runtime-evaluated stores—**base**, **derived**, and **query**—each representing a distinct state type: local, computed, or asynchronously fetched. Stores track dependencies at runtime, evaluate lazily, and clean up automatically when unused.

All stores expose a consistent interface and can be used both inside and outside React. Each store is a node. Together they form a composed graph.

- **Base stores** define synchronous local state with explicit update methods.
- **Derived stores** compute values from other stores and re-run only when inputs change.
- **Query stores** fetch and cache async data, refetching when reactive parameters change.

All store types share a common interface: a React-compatible hook, a
stable store object with `.getState()` and `.subscribe()`, and optional
support for persistence. They compose naturally, interoperate cleanly,
and scale as application complexity grows.

## Base Store

A base store defines local state along with an interface for reading and
updating that state.

```ts
export const useSettingsStore = createBaseStore<Settings>(set => ({
  currency: 'USD',
  setCurrency: currency => set({ currency }),
}));
```

In React, subscribe to values with selectors:

```ts
const currency = useSettingsStore(s => s.currency);
```

Outside React:

```ts
useSettingsStore.getState().currency;
useSettingsStore.subscribe(selector, listener, options);
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
export const settingsActions = createStoreActions(useSettingsStore);
```

## Derived Store

Derived stores compute values from other stores. The `$` accessor tracks
dependencies at runtime:

```ts
export const useTotal = createDerivedStore($ => {
  const { currency } = $(useSettingsStore);
  const { subtotal, tax } = $(useCartStore);
  return formatTotal(currency, subtotal, tax);
});
```

If `currency`, `subtotal`, or `tax` change, the store re-computes.

If the store is not observed, nothing runs.

## Query Store

Query stores manage remote data. They fetch, cache, and revalidate based
on reactive parameters:

```ts
export const useAccountStore = createQueryStore<Account, Params>({
  fetcher: fetchAccount,
  params: {
    userId: $ => $(useAuthStore).userId,
  },
  staleTime: time.minutes(10),
});
```

When `userId` changes, the store refetches. If unobserved, it remains
idle.

Use it in React:

```ts
const account = useAccountStore(s => s.getData());
```

Or imperatively:

```ts
useAccountStore.getState().fetch();
```

Query stores support full customization: extended local state, manual cache control, configurable staleness and retry behavior, and optional persistence.

They deduplicate fetches across consumers and compute stable query keys automatically.

## Store Interface

All stores implement the same API:

```ts
useStore()
useStore(selector, equalityFn?)

useStore.getState()
useStore.setState() // Except for derived stores
useStore.subscribe(selector, listener, options?)
```

## Composed Example

```ts
export const useCurrencyFormatter = createDerivedStore($ => {
  const { currency, locale } = $(useSettingsStore);
  return new Intl.NumberFormat(locale, {
    currency,
    style: 'currency',
  });
});
```

```ts
export const useAccountBalance = createDerivedStore($ => {
  const balance = $(useAccountStore).getData()?.balance ?? 0;
  const formatter = $(useCurrencyFormatter);
  return formatter.format(balance);
});
```

```ts
function AccountSummary() {
  const balance = useAccountBalance();
  return <Text>Balance: {balance}</Text>;
}
```
