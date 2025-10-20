import { createBaseStore, time } from '@stores';
import { Film } from './filmsStore';

export type FavoritesState = {
  favorites: Record<string, Film>;
  addFavorite: (film: Film) => void;
  removeFavorite: (id: string) => void;
};

export const useFavoritesStore = createBaseStore<FavoritesState>(
  set => ({
    favorites: {},

    addFavorite: film => set(state => ({ favorites: { ...state.favorites, [film.id]: film } })),

    removeFavorite: id =>
      set(state => {
        const { [id]: _, ...rest } = state.favorites;
        return { favorites: rest };
      }),
  }),
  { persistThrottleMs: time.ms(50), storageKey: 'favorites', sync: true }
);

export const { addFavorite, removeFavorite } = useFavoritesStore.getState();
