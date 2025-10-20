import { createBaseStore } from '@stores';

export type SortBy = 'title' | 'release_date' | 'rt_score';
export type SortOrder = 'asc' | 'desc';

export type SortState = {
  sortBy: SortBy;
  sortOrder: SortOrder;
  setSortBy: (value: SortBy) => void;
  toggleSortOrder: () => void;
};

export const useSortStore = createBaseStore<SortState>(set => ({
  sortBy: 'title',
  sortOrder: 'asc',
  setSortBy: value => set({ sortBy: value }),
  toggleSortOrder: () => set(state => ({ sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' })),
}));

export const { setSortBy, toggleSortOrder } = useSortStore.getState();
