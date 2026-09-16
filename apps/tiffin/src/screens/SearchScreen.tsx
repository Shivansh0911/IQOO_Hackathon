import type { FilterKey } from '../state/store.js';
import { selectRestaurants, useTiffin } from '../state/store.js';
import type { Restaurant } from '../data/restaurants.js';
import { formatRupees } from '../data/restaurants.js';
import { VegMark } from '../components/common.js';

const FILTERS: readonly { key: FilterKey; label: string }[] = [
  { key: 'rating4', label: 'Rating 4.0+' },
  { key: 'pureVeg', label: 'Pure Veg' },
  { key: 'fastDelivery', label: 'Fast Delivery' },
  { key: 'offers', label: 'Offers' },
];

/**
 * A restaurant card.
 *
 * It is one <button> and its text lives entirely in child elements. That is
 * ordinary, good markup — the whole card is the tap target, so the whole card is
 * the control — and it is also the shape that a naive tree-flattener mangles.
 */
function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  const navigate = useTiffin((s) => s.navigate);
  return (
    <li>
      <button
        type="button"
        className="t-card"
        onClick={() => navigate({ name: 'restaurant', restaurantId: restaurant.id })}
      >
        <span className="t-monogram" style={{ background: restaurant.tint }} aria-hidden="true">
          {restaurant.monogram}
        </span>
        <span className="t-card-body">
          <span className="t-card-name">{restaurant.name}</span>
          <span className="t-card-cuisines">
            {restaurant.cuisines.join(', ')} · {restaurant.area}
          </span>
          <span className="t-card-meta">
            <span className="t-rating">{restaurant.rating.toFixed(1)} ★</span>
            <span>{restaurant.deliveryMins} min</span>
            <span>{formatRupees(restaurant.priceForTwo)} for two</span>
            {restaurant.pureVeg && <VegMark veg />}
          </span>
          {restaurant.offer && <span className="t-offer">{restaurant.offer}</span>}
        </span>
      </button>
    </li>
  );
}

export function SearchScreen() {
  const query = useTiffin((s) => s.query);
  const setQuery = useTiffin((s) => s.setQuery);
  const filters = useTiffin((s) => s.filters);
  const toggleFilter = useTiffin((s) => s.toggleFilter);
  const results = selectRestaurants({ query, filters });

  return (
    <div className="t-pad">
      <search>
        <div className="t-searchbar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7a6a60" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="Search for restaurants or dishes"
            placeholder="Search for restaurants or dishes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.length > 0 && (
            // Icon-only: the label is the only thing that says what it does.
            <button type="button" className="t-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>

        <div className="t-chips" role="group" aria-label="Filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="t-chip"
              aria-pressed={filters[f.key]}
              onClick={() => toggleFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </search>

      <h2 className="t-result-count">
        {results.length} {results.length === 1 ? 'restaurant' : 'restaurants'}
        {query.trim() ? ` for “${query.trim()}”` : ' near you'}
      </h2>

      {results.length === 0 ? (
        <div className="t-empty">
          <h2>Nothing matched</h2>
          <p>Try a different dish, or clear a filter.</p>
        </div>
      ) : (
        <ul className="t-list">
          {results.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
