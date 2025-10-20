import { createBaseStore } from '@stores';

export type SearchState = {
  query: string;
  setQuery: (q: string) => void;
};

export const useSearchStore = createBaseStore<SearchState>(set => ({
  query: '',
  setQuery: q => set({ query: q }),
}));

export const { setQuery } = useSearchStore.getState();
