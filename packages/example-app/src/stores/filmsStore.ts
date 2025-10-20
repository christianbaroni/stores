import { createQueryStore, time } from '@stores';

export type Film = {
  id: string;
  title: string;
  original_title: string;
  original_title_romanised: string;
  image: string;
  movie_banner: string;
  description: string;
  director: string;
  producer: string;
  release_date: string;
  running_time: string;
  rt_score: string;
  people: string[];
  species: string[];
  locations: string[];
  vehicles: string[];
  url: string;
};

export const useFilmsStore = createQueryStore<Film[]>(
  {
    fetcher: fetchFilms,
    staleTime: time.hours(1),
  },
  { storageKey: 'films' }
);

async function fetchFilms(): Promise<Film[]> {
  const res = await fetch('https://ghibliapi.vercel.app/films');
  if (!res.ok) throw new Error('Failed to fetch films');
  const data: Film[] = await res.json();
  return data;
}
