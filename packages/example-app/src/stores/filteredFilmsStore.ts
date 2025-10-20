import { createDerivedStore } from '@stores';
import { useFilmsStore } from './filmsStore';
import { useSearchStore } from './searchStore';
import { useSortStore } from './sortStore';

export const useFilteredFilmsStore = createDerivedStore(
  $ => {
    const films = $(useFilmsStore).getData();
    const query = $(useSearchStore).query.toLowerCase();
    const sortBy = $(useSortStore).sortBy;
    const sortOrder = $(useSortStore).sortOrder;

    const filtered = films?.filter(film => film.title.toLowerCase().includes(query));
    if (!filtered) return undefined;

    const sorted = filtered.sort((a, b) => {
      const aVal = sortBy === 'release_date' || sortBy === 'rt_score' ? Number(a[sortBy]) : a[sortBy];
      const bVal = sortBy === 'release_date' || sortBy === 'rt_score' ? Number(b[sortBy]) : b[sortBy];
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  },
  { lockDependencies: true }
);
