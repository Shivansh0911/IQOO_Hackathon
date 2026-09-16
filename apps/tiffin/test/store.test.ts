/**
 * Tiffin's own tests. It is a real app, so its rules are tested like one:
 * filtering, cart arithmetic, quantity edges, and the one-restaurant rule.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RESTAURANTS } from '../src/data/restaurants.js';
import { selectRestaurants, selectTotals, useTiffin } from '../src/state/store.js';

const store = () => useTiffin.getState();

beforeEach(() => {
  store().reset();
});

describe('catalogue', () => {
  it('seeds enough restaurants for a search to mean something', () => {
    expect(RESTAURANTS.length).toBeGreaterThanOrEqual(12);
  });

  it('gives every restaurant items with real prices', () => {
    for (const r of RESTAURANTS) {
      expect(r.items.length).toBeGreaterThan(0);
      for (const i of r.items) expect(i.price).toBeGreaterThan(0);
    }
  });

  it('has unique ids across restaurants and items', () => {
    const ids = [...RESTAURANTS.map((r) => r.id), ...RESTAURANTS.flatMap((r) => r.items.map((i) => i.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('search and filters', () => {
  const filters = { rating4: false, pureVeg: false, fastDelivery: false, offers: false };

  it('matches on dish name, not only restaurant name', () => {
    const results = selectRestaurants({ query: 'biryani', filters });
    expect(results.length).toBeGreaterThan(1);
    expect(results.some((r) => r.items.some((i) => i.name.toLowerCase().includes('biryani')))).toBe(true);
  });

  it('matches on area', () => {
    expect(selectRestaurants({ query: 'gachibowli', filters }).length).toBeGreaterThan(0);
  });

  it('filters by rating', () => {
    const results = selectRestaurants({ query: '', filters: { ...filters, rating4: true } });
    expect(results.every((r) => r.rating >= 4.0)).toBe(true);
    expect(results.length).toBeLessThan(RESTAURANTS.length);
  });

  it('filters by pure veg', () => {
    expect(selectRestaurants({ query: '', filters: { ...filters, pureVeg: true } }).every((r) => r.pureVeg)).toBe(true);
  });

  it('filters by delivery time', () => {
    const results = selectRestaurants({ query: '', filters: { ...filters, fastDelivery: true } });
    expect(results.every((r) => r.deliveryMins <= 30)).toBe(true);
  });

  it('combines a query with a filter', () => {
    const results = selectRestaurants({ query: 'biryani', filters: { ...filters, rating4: true } });
    expect(results.every((r) => r.rating >= 4.0)).toBe(true);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(selectRestaurants({ query: 'zzzzz', filters })).toHaveLength(0);
  });
});

describe('cart', () => {
  it('adds an item, then increments rather than duplicating', () => {
    store().addItem('r1', 'r1i1');
    store().addItem('r1', 'r1i1');
    expect(store().lines).toHaveLength(1);
    expect(store().lines[0]?.qty).toBe(2);
  });

  it('holds one restaurant at a time, like every delivery app', () => {
    store().addItem('r1', 'r1i1');
    store().addItem('r4', 'r4i1');
    expect(store().lines).toHaveLength(1);
    expect(store().lines[0]?.restaurantId).toBe('r4');
  });

  it('removes a line when its quantity reaches zero', () => {
    store().addItem('r1', 'r1i1');
    store().changeQty('r1i1', -1);
    expect(store().lines).toHaveLength(0);
  });

  it('computes subtotal, fee, taxes and total', () => {
    store().addItem('r1', 'r1i1'); // 329
    store().changeQty('r1i1', 1); // x2 = 658
    const t = selectTotals(store());
    expect(t.subtotal).toBe(658);
    expect(t.deliveryFee).toBe(29);
    expect(t.taxes).toBe(33);
    expect(t.total).toBe(720);
    expect(t.itemCount).toBe(2);
  });

  it('charges no delivery fee on an empty cart', () => {
    expect(selectTotals({ lines: [] })).toMatchObject({ total: 0, deliveryFee: 0 });
  });

  it('empties the cart and records the total when an order is placed', () => {
    store().addItem('r4', 'r4i1');
    const expected = selectTotals(store()).total;
    store().placeOrder();
    expect(store().lines).toHaveLength(0);
    expect(store().lastOrderTotal).toBe(expected);
    expect(store().route.name).toBe('confirmed');
  });
});

describe('reset', () => {
  it('puts the app back to a known state in one call', () => {
    store().addItem('r1', 'r1i1');
    store().setQuery('biryani');
    store().toggleFilter('pureVeg');
    store().navigate({ name: 'cart' });

    store().reset();

    expect(store().lines).toHaveLength(0);
    expect(store().query).toBe('');
    expect(store().filters.pureVeg).toBe(false);
    expect(store().route).toEqual({ name: 'search' });
  });
});
