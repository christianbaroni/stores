import { createQueryStore, time } from 'stores';

export type TimeState = {
  currentTime: number;
  formatRelativeTime: (timestamp: number) => string;
};

export const useTimeStore = createQueryStore<number, never, TimeState>(
  {
    fetcher: () => Date.now(),
    setData: ({ data, set }) => set({ currentTime: data }),
    staleTime: time.seconds(1),
    suppressStaleTimeWarning: true,
  },

  (_, get) => ({
    currentTime: Date.now(),
    formatRelativeTime: timestamp => formatRelativeTime(get().currentTime, timestamp),
  })
);

// ============ Helpers ====================================================== //

function formatRelativeTime(currentTime: number, timestamp: number): string {
  const delta = currentTime - timestamp;
  if (delta < time.seconds(1)) return 'just now';
  if (delta < time.minutes(1)) return `${Math.floor(delta / time.seconds(1))}s ago`;
  if (delta < time.hours(1)) return `${Math.floor(delta / time.minutes(1))}m ago`;
  return new Date(timestamp).toLocaleTimeString();
}
