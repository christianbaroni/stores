import { createBaseStore, createDerivedStore } from 'stores';

export type VirtualizedListItem = {
  id: string;
  name: string;
  email: string;
  company: string;
  city: string;
  status: 'Active' | 'Inactive' | 'Pending';
  value: number;
  date: string;
};

const names = [
  'Alice',
  'Bob',
  'Charlie',
  'Diana',
  'Eve',
  'Frank',
  'Grace',
  'Heidi',
  'Ivan',
  'Judy',
  'Karl',
  'Laura',
  'Mallory',
  'Niaj',
  'Olivia',
  'Peggy',
  'Quentin',
  'Rupert',
  'Sybil',
  'Trent',
  'Uma',
  'Victor',
  'Wendy',
  'Xavier',
  'Yvonne',
  'Zach',
];
const companies = [
  'Globex',
  'Initech',
  'Umbrella',
  'Hooli',
  'Stark Industries',
  'Wayne Enterprises',
  'Wonka Inc.',
  'Acme Corp',
  'Soylent',
  'Cyberdyne',
];
const cities = ['New York', 'San Francisco', 'London', 'Berlin', 'Tokyo', 'Paris', 'Sydney', 'Toronto', 'Dublin', 'Amsterdam'];
const statuses = ['Active', 'Inactive', 'Pending'] as const;

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate() {
  const start = new Date(2020, 0, 1).getTime();
  const end = new Date().getTime();
  return new Date(start + Math.random() * (end - start)).toISOString().slice(0, 10);
}

function generateVirtualizedList(): VirtualizedListItem[] {
  return Array.from({ length: 10000 }, (_, i) => {
    const name = `${randomFrom(names)} ${String.fromCharCode(65 + (i % 26))}`;
    const company = randomFrom(companies);
    const city = randomFrom(cities);
    const status = randomFrom(statuses);
    const value = Math.floor(Math.random() * 100000) / 100;
    const date = randomDate();
    const email = `${name.toLowerCase().replace(/ /g, '.')}@${company.toLowerCase().replace(/ /g, '')}.com`;
    return {
      id: (i + 1).toString(),
      name,
      email,
      company,
      city,
      status,
      value,
      date,
    };
  });
}

export type VirtualizedListState = {
  items: VirtualizedListItem[];
  query: string;
  setQuery: (q: string) => void;
};

export const useVirtualizedListStore = createBaseStore<VirtualizedListState>(set => ({
  items: generateVirtualizedList(),
  query: '',
  setQuery: query => set({ query }),
}));

export const setVirtualizedListQuery = useVirtualizedListStore.getState().setQuery;

export const useFilteredList = createDerivedStore(
  $ => {
    const items = $(useVirtualizedListStore).items;
    const query = $(useVirtualizedListStore).query.toLowerCase();
    if (!query) return items;
    return items.filter(
      item =>
        item.name.toLowerCase().includes(query) ||
        item.email.toLowerCase().includes(query) ||
        item.company.toLowerCase().includes(query) ||
        item.city.toLowerCase().includes(query) ||
        item.status.toLowerCase().includes(query) ||
        item.id.includes(query)
    );
  },
  { lockDependencies: true }
);
