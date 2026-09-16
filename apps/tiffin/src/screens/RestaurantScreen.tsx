import { findRestaurant, formatRupees } from '../data/restaurants.js';
import { useTiffin } from '../state/store.js';
import { QtyStepper, VegMark } from '../components/common.js';

export function RestaurantScreen({ restaurantId }: { restaurantId: string }) {
  const navigate = useTiffin((s) => s.navigate);
  const addItem = useTiffin((s) => s.addItem);
  const lines = useTiffin((s) => s.lines);
  const restaurant = findRestaurant(restaurantId);

  if (!restaurant) {
    return (
      <div className="t-pad t-empty">
        <h2>That restaurant is no longer listed</h2>
        <button type="button" className="t-back" onClick={() => navigate({ name: 'search' })}>
          ← Back to results
        </button>
      </div>
    );
  }

  return (
    <div className="t-pad">
      <button type="button" className="t-back" onClick={() => navigate({ name: 'search' })}>
        ← Back to results
      </button>

      <div className="t-hero">
        <span className="t-monogram" style={{ background: restaurant.tint }} aria-hidden="true">
          {restaurant.monogram}
        </span>
        <div>
          <h1>{restaurant.name}</h1>
          <p className="t-card-cuisines">
            {restaurant.cuisines.join(', ')} · {restaurant.area}
          </p>
          <p className="t-card-meta">
            <span className="t-rating">{restaurant.rating.toFixed(1)} ★</span>
            <span>{restaurant.deliveryMins} min</span>
            <span>{formatRupees(restaurant.priceForTwo)} for two</span>
          </p>
          {restaurant.offer && <span className="t-offer">{restaurant.offer}</span>}
        </div>
      </div>

      <h2 className="t-section-title">Menu</h2>
      <ul className="t-list" style={{ gap: 0 }}>
        {restaurant.items.map((menuItem) => {
          const line = lines.find((l) => l.itemId === menuItem.id);
          return (
            <li className="t-item" key={menuItem.id}>
              <div className="t-item-body">
                <span className="t-item-name">
                  <VegMark veg={menuItem.veg} />
                  {menuItem.name}
                  {menuItem.bestseller && <span className="t-tag-best">Bestseller</span>}
                </span>
                <p className="t-item-desc">{menuItem.desc}</p>
                <p className="t-item-price">{formatRupees(menuItem.price)}</p>
              </div>
              {line ? (
                <QtyStepper itemId={menuItem.id} qty={line.qty} />
              ) : (
                <button
                  type="button"
                  className="t-add"
                  disabled={menuItem.soldOut === true}
                  aria-label={menuItem.soldOut === true ? `${menuItem.name} is sold out` : `Add ${menuItem.name} to cart`}
                  onClick={() => addItem(restaurant.id, menuItem.id)}
                >
                  {menuItem.soldOut === true ? 'Sold out' : 'Add'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
