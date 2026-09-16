/** Tiffin's public surface: the app, and the store a host page may reset. */
export { TiffinApp } from './TiffinApp.js';
export { useTiffin, selectTotals, selectRestaurants } from './state/store.js';
export type { Route, TiffinState, Totals, FilterKey } from './state/store.js';
export { RESTAURANTS, findRestaurant, findItem, formatRupees } from './data/restaurants.js';
export type { Restaurant, MenuItem } from './data/restaurants.js';
