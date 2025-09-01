// import { createBaseStore } from './createBaseStore';
// import { createQueryStore } from './createQueryStore';
// import { createDerivedStore } from './createDerivedStore';
// import type {
//   Store,
//   DerivedStore,
//   BaseStore,
//   PersistConfig,
//   StateCreator,
// } from './types';
// import { QueryStore, QueryStoreConfig, QueryStoreState } from './queryStore/types';
// import { SignalFunction } from './signal';

// /**
//  * Helper type that merges the caller-supplied params type with the dynamic
//  * page parameter. The page parameter key is generic so the caller can
//  * supply a custom key (defaults to `"page"`).
//  */
// export type CombinedParams<
//   PageParamKey extends string,
//   TParams extends Record<string, unknown>,
// > = TParams & { [K in PageParamKey]: number };

// /**
//  * Configuration for the pagination store creator.
//  *
//  * The `fetcher` and other query-related options mirror those accepted by
//  * {@link createQueryStore}. The resulting query store will always expose
//  * data as an array of items (`TItem[]`) for each page. The pagination
//  * store will aggregate pages into a single flat list.
//  *
//  * @typeParam TQueryFnData The raw type returned by the `fetcher` before any
//  *                         optional transform is applied.
//  * @typeParam TItem The type of each individual item in a page.
//  * @typeParam TParams Additional parameters (besides the page parameter) used
//  *                    by the query store.
//  * @typeParam CustomState Optional custom state added to the query store.
//  */
// export interface PaginationStoreConfig<
//   TQueryFnData,
//   TItem,
//   TParams extends Record<string, unknown>,
//   PageParamKey extends string,
//   CustomState = unknown,
// > extends Omit<
//     QueryStoreConfig<TQueryFnData, CombinedParams<PageParamKey, TParams>, TItem[], CustomState>,
//     'params'
//   > {
//   /**
//    * Additional parameters for the query. Values can be either static values
//    * or reactive functions that return an attachable value. The page
//    * parameter should not be included here; it is injected automatically.
//    */
//   params?: QueryStoreConfig<
//     TQueryFnData,
//     CombinedParams<PageParamKey, TParams>,
//     TItem[],
//     CustomState
//   >['params'];
//   /**
//    * The name of the parameter used to specify the page number. Defaults to
//    * `'page'`. If provided, this key will be injected into the underlying
//    * query store's params map, overriding any user-supplied value.
//    */
//   pageParamName?: PageParamKey;
//   /**
//    * The initial page number. Defaults to `1`.
//    */
//   initialPage?: number;
//   /**
//    * An optional function to customize how new page results are merged into
//    * the aggregated list. By default pages are concatenated in ascending
//    * order. The function receives the current aggregated array, the
//    * newly fetched page, and the page index. It must return a new array.
//    */
//   merge?: (existing: TItem[], newPage: TItem[], page: number) => TItem[];
// }

// /**
//  * Creates a paginated store composed of three parts:
//  *
//  * 1. A **page state store** that holds the current page number and exposes
//  *    imperative actions (`next`, `prev`, `setPage`, and `reset`).
//  * 2. A **query store** responsible for fetching a single page of data. All
//  *    configuration options from {@link createQueryStore} are respected. The
//  *    page parameter is injected automatically.
//  * 3. A **derived store** that flattens the results of all fetched pages
//  *    into a single array. Whenever the page number increases, the derived
//  *    store re-runs to include data from the new page. When the page number
//  *    decreases (e.g. after a reset), the aggregated list is rebuilt from
//  *    scratch.
//  *
//  * The returned object contains these stores along with convenience actions
//  * for paging and prefetching. Consumers can subscribe to `usePages` for the
//  * aggregated list, `usePage` for low-level query interactions, or
//  * `usePager` to observe or manipulate the current page.
//  *
//  * ```ts
//  * // Example usage:
//  * const products = createPaginationStore({
//  *   fetcher: async ({ page, search }) => {
//  *     const res = await fetch(`/api/products?page=${page}&q=${search}`);
//  *     return res.json() as Product[];
//  *   },
//  *   params: { search: $ => $(useSearchStore).query },
//  *   staleTime: time.minutes(5),
//  * });
//  *
//  * function ProductList() {
//  *   const items = products.usePages();
//  *   const { next } = products.actions;
//  *   return (
//  *     <div>
//  *       {items.map(item => <ProductCard key={item.id} product={item} />)}
//  *       <button onClick={next}>Load More</button>
//  *     </div>
//  *   );
//  * }
//  * ```
//  *
//  * @param config The configuration for the pagination store. See
//  *               {@link PaginationStoreConfig} for details.
//  * @param stateCreatorOrPersist Optional custom state creator for the
//  *                              underlying query store, or a persist
//  *                              configuration. If a function is supplied
//  *                              here, it will be used as the custom state
//  *                              creator; if an object with a `storageKey`
//  *                              property is supplied, it will be treated as
//  *                              persistence configuration.
//  * @param maybePersist If a custom state creator is provided as the second
//  *                     argument, a persist configuration can be supplied
//  *                     here as the third argument.
//  *
//  * @returns An object containing the paginated stores and their actions.
//  */
// export function createPaginationStore<
//   TQueryFnData,
//   TItem,
//   TParams extends Record<string, unknown> = Record<string, never>,
//   PageParamKey extends string = 'page',
//   CustomState = unknown,
// >(
//   config: PaginationStoreConfig<TQueryFnData, TItem, TParams, PageParamKey, CustomState>,
//   stateCreatorOrPersist?:
//     | StateCreator<
//         QueryStoreState<
//           TItem[],
//           CombinedParams<PageParamKey, TParams>,
//           CustomState
//         >,
//         CustomState
//       >
//     | PersistConfig<
//         QueryStoreState<
//           TItem[],
//           CombinedParams<PageParamKey, TParams>,
//           CustomState
//         >,
//         any
//       >,
//   maybePersist?: PersistConfig<
//     QueryStoreState<TItem[], CombinedParams<PageParamKey, TParams>, CustomState>,
//     any
//   >,
// ) {
//   // Determine whether a custom state creator or persistence config has been
//   // supplied. The signature mirrors that of `createQueryStore`.
//   type Combined = CombinedParams<PageParamKey, TParams>;

//   let stateCreator:
//     | StateCreator<
//         QueryStoreState<TItem[], Combined, CustomState>,
//         CustomState
//       >
//     | undefined;
//   let persistConfig:
//     | PersistConfig<
//         QueryStoreState<TItem[], Combined, CustomState>,
//         any
//       >
//     | undefined;
//   if (typeof stateCreatorOrPersist === 'function') {
//     stateCreator = stateCreatorOrPersist as StateCreator<
//       QueryStoreState<TItem[], Combined, CustomState>,
//       CustomState
//     >;
//     persistConfig = maybePersist as PersistConfig<
//       QueryStoreState<TItem[], Combined, CustomState>,
//       any
//     >;
//   } else {
//     stateCreator = undefined;
//     persistConfig = stateCreatorOrPersist as PersistConfig<
//       QueryStoreState<TItem[], Combined, CustomState>,
//       any
//     >;
//   }

//   // Extract pagination-specific options with defaults.
//   const pageParamName: PageParamKey = (config.pageParamName ?? 'page') as PageParamKey;
//   const initialPage: number = config.initialPage ?? 1;
//   const mergeFn = config.merge;

//   // Create a base store to track the current page number. This store is
//   // intentionally lightweight and not persisted by default. Consumers
//   // interact with it via the returned `actions` object.
//   const usePager = createBaseStore<{
//     page: number;
//     next: () => void;
//     prev: () => void;
//     reset: () => void;
//     setPage: (p: number) => void;
//   }>((set) => ({
//     page: initialPage,
//     next: () => set(state => ({ page: state.page + 1 })),
//     /**
//      * Decrements the page number, never dropping below the initial page.
//      */
//     prev: () => set(state => ({ page: Math.max(initialPage, state.page - 1) })),
//     /**
//      * Resets the page number back to the initial page.
//      */
//     reset: () => set({ page: initialPage }),
//     /**
//      * Sets the page number to the specified value. No bounds checking is
//      * performed here; it is the caller's responsibility to ensure the
//      * provided page number is valid.
//      */
//     setPage: (p: number) => set({ page: p }),
//   }));

//   // Destructure out the pagination options so they are not passed through
//   // to the underlying query store. All remaining config keys are forwarded.
//   const {
//     pageParamName: _omit1,
//     initialPage: _omit2,
//     merge: _omit3,
//     params: originalParams,
//     ...queryConfigRest
//   } = config;

//   // Build the params object for the query store. We explicitly type this
//   // object as the params type expected by `QueryStoreConfig` for the
//   // combined parameters. Dynamic keys are supported by TypeScript via
//   // computed property names and generic constraints.
//   const mergedParams: Pick<QueryStoreConfig<
//     TQueryFnData,
//     Combined,
//     TItem[],
//     CustomState
//   >, 'params'> = originalParams
//     ? {
//       ...(originalParams),
//       [pageParamName]: ($: SignalFunction) => $(usePager).page,
//     }
//     : {
//       [pageParamName]: ($: SignalFunction) => $(usePager).page,
//     };

//   const queryConfig: QueryStoreConfig<
//     TQueryFnData,
//     Combined,
//     TItem[],
//     CustomState
//   > = {
//     ...queryConfigRest,
//     params: mergedParams.params,
//   };

//   // Create the query store for individual pages. We supply the concrete
//   // parameter type to preserve type safety. The `createQueryStore` helper
//   // uses the overload that matches the provided arguments.
//   const usePage: QueryStore<TItem[], Combined, CustomState> = (stateCreator)
//     ? createQueryStore(queryConfig, stateCreator, persistConfig)
//     : createQueryStore(queryConfig);

//   // Derived store that aggregates pages into a single flat array. It
//   // recomputes whenever the current page or any page's data changes.
//   const usePages: DerivedStore<TItem[]> = createDerivedStore($ => {
//     const currentPage: number = $(usePager).page;
//     let aggregated: TItem[] = [];
//     for (let i = initialPage; i <= currentPage; i++) {
//       // Build a partial params object with only the page parameter. Missing
//       // parameters will be resolved by the query store at runtime. Use
//       // `Combined` type to ensure the object keys are compatible.
//       const param: Combined = { ...({} as Combined), [pageParamName]: i };
//       // Invoke getData() via the proxy returned by `$` so that the
//       // invocation and its arguments are tracked as dependencies.
//       const pageStoreProxy = $(usePage);
//       const pageData = pageStoreProxy.getData(param) as TItem[] | null;
//       if (Array.isArray(pageData)) {
//         aggregated = mergeFn ? mergeFn(aggregated, pageData, i) : aggregated.concat(pageData);
//       }
//     }
//     return aggregated;
//   });

//   // Convenience actions for consumers. These proxy through to the page
//   // state store and query store as appropriate.
//   const actions = {
//     /** Advance to the next page. Triggers a refetch of the new page. */
//     next(): void {
//       usePager.getState().next();
//     },
//     /** Decrement the current page if possible. */
//     prev(): void {
//       usePager.getState().prev();
//     },
//     /** Reset back to the initial page. */
//     reset(): void {
//       usePager.getState().reset();
//     },
//     /** Set the current page to an arbitrary number. */
//     setPage(page: number): void {
//       usePager.getState().setPage(page);
//     },
//     /**
//      * Manually fetch data for the specified page. This can be used to
//      * prefetch upcoming pages ahead of time. Accepts the same fetch
//      * options as the underlying query store's `fetch` method.
//      */
//     fetchPage(
//       page: number,
//       options?: Parameters<ReturnType<typeof usePage>['fetch']>[1],
//     ): Promise<TItem[] | null> {
//       const params: Combined = { ...({} as Combined), [pageParamName]: page };
//       return usePage.getState().fetch(params, options);
//     },
//     /**
//      * Manually fetch the next page without updating the current page. This
//      * is useful for background prefetching. When called from within a
//      * component that is subscribed to the query store, the fetch will
//      * update the cache for the next page.
//      */
//     fetchNext(
//       options?: Parameters<ReturnType<typeof usePage>['fetch']>[1],
//     ): Promise<TItem[] | null> {
//       const nextPage = usePager.getState().page + 1;
//       const params: Combined = { ...({} as Combined), [pageParamName]: nextPage };
//       return usePage.getState().fetch(params, options);
//     },
//   };

//   return {
//     /** Derived store providing a flat array of all items across fetched pages. */
//     usePages,
//     /** Query store for individual pages. Exposes all query store methods. */
//     usePage,
//     /** Base store that tracks the current page number. */
//     usePager,
//     /** Convenience actions for paging and prefetching. */
//     actions,
//   } as {
//     usePages: DerivedStore<TItem[]>;
//     usePage: QueryStore<TItem[], Combined, CustomState>;
//     usePager: BaseStore<{ page: number; next: () => void; prev: () => void; reset: () => void; setPage: (p: number) => void }>;
//     actions: {
//       next(): void;
//       prev(): void;
//       reset(): void;
//       setPage(p: number): void;
//       fetchPage(page: number, options?: Parameters<ReturnType<typeof usePage>['fetch']>[1]): Promise<TItem[] | null>;
//       fetchNext(options?: Parameters<ReturnType<typeof usePage>['fetch']>[1]): Promise<TItem[] | null>;
//     };
//   };
// }

// // /**
// //  * Configuration for the pagination store creator.
// //  *
// //  * The `fetcher` and other query-related options mirror those accepted by
// //  * {@link createQueryStore}. The resulting query store will always expose
// //  * data as an array of items (`TItem[]`) for each page. The pagination
// //  * store will aggregate pages into a single flat list.
// //  *
// //  * @typeParam TQueryFnData The raw type returned by the `fetcher` before any
// //  *                         optional transform is applied.
// //  * @typeParam TItem The type of each individual item in a page.
// //  * @typeParam TParams Additional parameters (besides the page parameter) used
// //  *                    by the query store.
// //  * @typeParam CustomState Optional custom state added to the query store.
// //  */
// // export interface PaginationStoreConfig<
// //   TQueryFnData,
// //   TItem,
// //   TParams extends Record<string, unknown> = Record<string, never>,
// //   CustomState = unknown,
// // > extends QueryStoreConfig<TQueryFnData, any, TItem[], CustomState> {
// //   /**
// //    * The name of the parameter used to specify the page number. Defaults to
// //    * `'page'`. If provided, this key will be injected into the underlying
// //    * query store's params map, overriding any user-supplied value.
// //    */
// //   pageParamName?: string;
// //   /**
// //    * The initial page number. Defaults to `1`.
// //    */
// //   initialPage?: number;
// //   /**
// //    * An optional function to customize how new page results are merged into
// //    * the aggregated list. By default pages are concatenated in ascending
// //    * order. The function receives the current aggregated array, the
// //    * newly fetched page, and the page index. It must return a new array.
// //    */
// //   merge?: (existing: TItem[], newPage: TItem[], page: number) => TItem[];
// // }

// // /**
// //  * Creates a paginated store composed of three parts:
// //  *
// //  * 1. A **page state store** that holds the current page number and exposes
// //  *    imperative actions (`next`, `prev`, `setPage`, and `reset`).
// //  * 2. A **query store** responsible for fetching a single page of data. All
// //  *    configuration options from {@link createQueryStore} are respected. The
// //  *    page parameter is injected automatically.
// //  * 3. A **derived store** that flattens the results of all fetched pages
// //  *    into a single array. Whenever the page number increases, the derived
// //  *    store re-runs to include data from the new page. When the page number
// //  *    decreases (e.g. after a reset), the aggregated list is rebuilt from
// //  *    scratch.
// //  *
// //  * The returned object contains these stores along with convenience actions
// //  * for paging and prefetching. Consumers can subscribe to `usePages` for the
// //  * aggregated list, `usePage` for low-level query interactions, or
// //  * `usePager` to observe or manipulate the current page.
// //  *
// //  * ```ts
// //  * // Example usage:
// //  * const products = createPaginationStore({
// //  *   fetcher: async ({ page, search }) => {
// //  *     const res = await fetch(`/api/products?page=${page}&q=${search}`);
// //  *     return res.json() as Product[];
// //  *   },
// //  *   params: { search: $ => $(useSearchStore).query },
// //  *   staleTime: time.minutes(5),
// //  * });
// //  *
// //  * function ProductList() {
// //  *   const items = products.usePages();
// //  *   const { next } = products.actions;
// //  *   return (
// //  *     <div>
// //  *       {items.map(item => <ProductCard key={item.id} product={item} />)}
// //  *       <button onClick={next}>Load More</button>
// //  *     </div>
// //  *   );
// //  * }
// //  * ```
// //  *
// //  * @param config The configuration for the pagination store. See
// //  *               {@link PaginationStoreConfig} for details.
// //  * @param stateCreatorOrPersist Optional custom state creator for the
// //  *                              underlying query store, or a persist
// //  *                              configuration. If a function is supplied
// //  *                              here, it will be used as the custom state
// //  *                              creator; if an object with a `storageKey`
// //  *                              property is supplied, it will be treated as
// //  *                              persistence configuration.
// //  * @param maybePersist If a custom state creator is provided as the second
// //  *                     argument, a persist configuration can be supplied
// //  *                     here as the third argument.
// //  *
// //  * @returns An object containing the paginated stores and their actions.
// //  */
// // export function createPaginationStore<
// //   TQueryFnData,
// //   TItem,
// //   TParams extends Record<string, unknown> = Record<string, never>,
// //   CustomState = unknown,
// // >(
// //   config: PaginationStoreConfig<TQueryFnData, TItem, TParams, CustomState>,
// //   stateCreatorOrPersist?: StateCreator<any, CustomState> | PersistConfig<any, any>,
// //   maybePersist?: PersistConfig<any, any>,
// // ) {
// //   // Determine whether a custom state creator or persistence config has been
// //   // supplied. The signature mirrors that of `createQueryStore`.
// //   let stateCreator: StateCreator<any, CustomState> | undefined;
// //   let persistConfig: PersistConfig<any, any> | undefined;
// //   if (typeof stateCreatorOrPersist === 'function') {
// //     stateCreator = stateCreatorOrPersist as StateCreator<any, CustomState>;
// //     persistConfig = maybePersist as PersistConfig<any, any> | undefined;
// //   } else {
// //     stateCreator = undefined;
// //     persistConfig = stateCreatorOrPersist as PersistConfig<any, any> | undefined;
// //   }

// //   // Extract pagination-specific options with defaults.
// //   const pageParamName = config.pageParamName ?? 'page';
// //   const initialPage = config.initialPage ?? 1;
// //   const mergeFn = config.merge;

// //   // Create a base store to track the current page number. This store is
// //   // intentionally lightweight and not persisted by default. Consumers
// //   // interact with it via the returned `actions` object.
// //   const usePager = createBaseStore<{
// //     page: number;
// //     next: () => void;
// //     prev: () => void;
// //     reset: () => void;
// //     setPage: (p: number) => void;
// //   }>((set) => ({
// //     page: initialPage,
// //     next: () => set(state => ({ page: state.page + 1 })),
// //     /**
// //      * Decrements the page number, never dropping below the initial page.
// //      */
// //     prev: () => set(state => ({ page: Math.max(initialPage, state.page - 1) })),
// //     /**
// //      * Resets the page number back to the initial page.
// //      */
// //     reset: () => set({ page: initialPage }),
// //     /**
// //      * Sets the page number to the specified value. No bounds checking is
// //      * performed here; it is the caller's responsibility to ensure the
// //      * provided page number is valid.
// //      */
// //     setPage: (p: number) => set({ page: p }),
// //   }));

// //   // Destructure out the pagination options so they are not passed through
// //   // to the underlying query store. All remaining config keys are forwarded.
// //   const {
// //     pageParamName: _omit1,
// //     initialPage: _omit2,
// //     merge: _omit3,
// //     params: originalParams = undefined,
// //     ...queryConfigRest
// //   } = config;

// //   // Inject the page parameter into the query store's params. If the user
// //   // supplied a page param manually, it will be overwritten by this value.
// //   const newParams:  = { ...originalParams };
// //   newParams[pageParamName] = ($: any) => ($ as any)(usePager).page;

// //   const queryConfig: QueryStoreConfig<TQueryFnData, any, TItem[], CustomState> = {
// //     ...queryConfigRest,
// //     params: newParams,
// //   };

// //   // Create the query store for individual pages. Note: we intentionally use
// //   // `any` for the params type here because the actual param shape includes
// //   // the dynamic page parameter in addition to whatever the caller may have
// //   // specified. TypeScript cannot easily infer the combined type when the
// //   // page parameter name is dynamic.
// //   const usePage: QueryStore<TItem[], any, CustomState> = (stateCreator || persistConfig)
// //     ? // Overload where a custom state creator and/or persistence config are provided.
// //       (createQueryStore as any)(queryConfig, stateCreator, persistConfig)
// //     : // Simplest overload: config only.
// //       (createQueryStore as any)(queryConfig);

// //   // Derived store that aggregates pages into a single flat array. It
// //   // recomputes whenever the current page or any page's data changes.
// //   const usePages: DerivedStore<TItem[]> = createDerivedStore($ => {
// //     const currentPage: number = $(usePager).page;
// //     let aggregated: TItem[] = [];
// //     for (let i = initialPage; i <= currentPage; i++) {
// //       // Build a partial params object with only the page parameter. Missing
// //       // parameters will be filled in by the query store's internal logic.
// //       const param: Record<string, unknown> = { [pageParamName]: i };
// //       // Invoke getData() via the proxy returned by `$` so that the
// //       // invocation and its arguments are tracked as dependencies.
// //       const pageStoreProxy: any = $(usePage);
// //       const pageData = pageStoreProxy.getData(param) as TItem[] | null;
// //       if (Array.isArray(pageData)) {
// //         aggregated = mergeFn ? mergeFn(aggregated, pageData, i) : aggregated.concat(pageData);
// //       }
// //     }
// //     return aggregated;
// //   });

// //   // Convenience actions for consumers. These proxy through to the page
// //   // state store and query store as appropriate.
// //   const actions = {
// //     /** Advance to the next page. Triggers a refetch of the new page. */
// //     next(): void {
// //       usePager.getState().next();
// //     },
// //     /** Decrement the current page if possible. */
// //     prev(): void {
// //       usePager.getState().prev();
// //     },
// //     /** Reset back to the initial page. */
// //     reset(): void {
// //       usePager.getState().reset();
// //     },
// //     /** Set the current page to an arbitrary number. */
// //     setPage(page: number): void {
// //       usePager.getState().setPage(page);
// //     },
// //     /**
// //      * Manually fetch data for the specified page. This can be used to
// //      * prefetch upcoming pages ahead of time. Accepts the same fetch
// //      * options as the underlying query store's `fetch` method.
// //      */
// //     fetchPage(page: number, options?: Parameters<ReturnType<typeof usePage>['fetch']>[1]): ReturnType<ReturnType<typeof usePage>['fetch']> {
// //       const params: Record<string, unknown> = { [pageParamName]: page };
// //       return usePage.getState().fetch(params as any, options);
// //     },
// //     /**
// //      * Manually fetch the next page without updating the current page. This
// //      * is useful for background prefetching. When called from within a
// //      * component that is subscribed to the query store, the fetch will
// //      * update the cache for the next page.
// //      */
// //     fetchNext(options?: Parameters<ReturnType<typeof usePage>['fetch']>[1]): ReturnType<ReturnType<typeof usePage>['fetch']> {
// //       const nextPage = usePager.getState().page + 1;
// //       const params: Record<string, unknown> = { [pageParamName]: nextPage };
// //       return usePage.getState().fetch(params as any, options);
// //     },
// //   };

// //   return {
// //     /** Derived store providing a flat array of all items across fetched pages. */
// //     usePages,
// //     /** Query store for individual pages. Exposes all query store methods. */
// //     usePage,
// //     /** Base store that tracks the current page number. */
// //     usePager,
// //     /** Convenience actions for paging and prefetching. */
// //     actions,
// //   } as {
// //     usePages: DerivedStore<TItem[]>;
// //     usePage: QueryStore<TItem[], any, CustomState>;
// //     usePager: BaseStore<{ page: number; next: () => void; prev: () => void; reset: () => void; setPage: (p: number) => void }>;
// //     actions: {
// //       next(): void;
// //       prev(): void;
// //       reset(): void;
// //       setPage(p: number): void;
// //       fetchPage(page: number, options?: any): Promise<TItem[] | null>;
// //       fetchNext(options?: any): Promise<TItem[] | null>;
// //     };
// //   };
// // }
