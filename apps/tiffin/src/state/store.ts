/**
 * Tiffin's state. An ordinary app store: a route, a query, some filters, a cart.
 *
 * It is persisted to sessionStorage so a reload keeps the cart, and it exposes a
 * `reset` so a demo can put the app back to a known state in one call. Nothing
 * here knows that anything but a human will ever click a button.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DELIVERY_FEE, findItem, RESTAURANTS, TAX_RATE } from '../data/restaurants.js';
import type { Restaurant } from '../data/restaurants.js';

export type Route =
  | { readonly name: 'search' }
  | { readonly name: 'restaurant'; readonly restaurantId: string }
  | { readonly name: 'cart' }
  | { readonly name: 'checkout' }
  | { readonly name: 'confirmed'; readonly orderId: string };

export interface CartLine {
  readonly restaurantId: string;
  readonly itemId: string;
  readonly qty: number;
}

export type FilterKey = 'rating4' | 'pureVeg' | 'fastDelivery' | 'offers';

export interface TiffinState {
  readonly route: Route;
  readonly query: string;
  readonly filters: Readonly<Record<FilterKey, boolean>>;
  readonly lines: readonly CartLine[];
  readonly lastOrderTotal: number | null;

  navigate(route: Route): void;
  setQuery(query: string): void;
  toggleFilter(key: FilterKey): void;
  addItem(restaurantId: string, itemId: string): void;
  changeQty(itemId: string, delta: number): void;
  removeItem(itemId: string): void;
  clearCart(): void;
  placeOrder(): void;
  reset(): void;
}

/**
 * sessionStorage, or a shrug.
 *
 * It is absent in a test runner, blocked in a private window, and full on a
 * phone that has been open for a week. Persistence is a convenience here, never
 * a requirement: if it is unavailable the app runs normally and simply forgets
 * on reload. Nothing is swallowed silently that a user would want to know about —
 * losing a session cart is not worth an error dialog.
 */
const memory = new Map<string, string>();
const sessionSafe: Storage = (() => {
  try {
    const probe = '__tiffin_probe__';
    globalThis.sessionStorage.setItem(probe, '1');
    globalThis.sessionStorage.removeItem(probe);
    return globalThis.sessionStorage;
  } catch {
    return {
      get length() {
        return memory.size;
      },
      key: (i) => [...memory.keys()][i] ?? null,
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
      clear: () => memory.clear(),
    };
  }
})();

const INITIAL = {
  route: { name: 'search' } as Route,
  query: '',
  filters: { rating4: false, pureVeg: false, fastDelivery: false, offers: false },
  lines: [] as readonly CartLine[],
  lastOrderTotal: null as number | null,
};

export const useTiffin = create<TiffinState>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      navigate: (route) => set({ route }),
      setQuery: (query) => set({ query }),

      toggleFilter: (key) => set((s) => ({ filters: { ...s.filters, [key]: !s.filters[key] } })),

      addItem: (restaurantId, itemId) =>
        set((s) => {
          const existing = s.lines.find((l) => l.itemId === itemId);
          if (existing) {
            return { lines: s.lines.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + 1 } : l)) };
          }
          // Tiffin, like every delivery app, holds one restaurant's order at a time.
          const switching = s.lines.length > 0 && s.lines[0]?.restaurantId !== restaurantId;
          const base = switching ? [] : s.lines;
          return { lines: [...base, { restaurantId, itemId, qty: 1 }] };
        }),

      changeQty: (itemId, delta) =>
        set((s) => ({
          lines: s.lines
            .map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + delta } : l))
            .filter((l) => l.qty > 0),
        })),

      removeItem: (itemId) => set((s) => ({ lines: s.lines.filter((l) => l.itemId !== itemId) })),

      clearCart: () => set({ lines: [] }),

      placeOrder: () => {
        const total = selectTotals(get()).total;
        set({
          lines: [],
          lastOrderTotal: total,
          route: { name: 'confirmed', orderId: `TIF${Math.floor(100000 + Math.random() * 899999)}` },
        });
      },

      reset: () => set({ ...INITIAL }),
    }),
    {
      name: 'tiffin-session',
      storage: createJSONStorage(() => sessionSafe),
      partialize: (s) => ({ route: s.route, query: s.query, filters: s.filters, lines: s.lines }) as never,
    },
  ),
);

// ── Selectors ─────────────────────────────────────────────────────────────

export interface Totals {
  readonly itemCount: number;
  readonly subtotal: number;
  readonly deliveryFee: number;
  readonly taxes: number;
  readonly total: number;
}

export function selectTotals(state: Pick<TiffinState, 'lines'>): Totals {
  const subtotal = state.lines.reduce((sum, line) => {
    const item = findItem(line.restaurantId, line.itemId);
    return sum + (item ? item.price * line.qty : 0);
  }, 0);
  const itemCount = state.lines.reduce((n, l) => n + l.qty, 0);
  const deliveryFee = subtotal === 0 ? 0 : DELIVERY_FEE;
  const taxes = Math.round(subtotal * TAX_RATE);
  return { itemCount, subtotal, deliveryFee, taxes, total: subtotal + deliveryFee + taxes };
}

export function selectRestaurants(state: Pick<TiffinState, 'query' | 'filters'>): readonly Restaurant[] {
  const q = state.query.trim().toLowerCase();
  return RESTAURANTS.filter((r) => {
    if (q) {
      const haystack = [r.name, r.area, ...r.cuisines, ...r.items.map((i) => i.name)].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (state.filters.rating4 && r.rating < 4.0) return false;
    if (state.filters.pureVeg && !r.pureVeg) return false;
    if (state.filters.fastDelivery && r.deliveryMins > 30) return false;
    if (state.filters.offers && !r.offer) return false;
    return true;
  });
}
