import { findItem, findRestaurant, formatRupees } from '../data/restaurants.js';
import { selectTotals, useTiffin } from '../state/store.js';
import { BillRow, QtyStepper, VegMark } from '../components/common.js';

export function CartScreen() {
  const navigate = useTiffin((s) => s.navigate);
  const lines = useTiffin((s) => s.lines);
  const removeItem = useTiffin((s) => s.removeItem);
  const totals = selectTotals({ lines });

  if (lines.length === 0) {
    return (
      <div className="t-pad">
        <button type="button" className="t-back" onClick={() => navigate({ name: 'search' })}>
          ← Back to results
        </button>
        <div className="t-empty">
          <h2>Your cart is empty</h2>
          <p>Add something from a restaurant and it will show up here.</p>
        </div>
      </div>
    );
  }

  const restaurant = findRestaurant(lines[0]?.restaurantId ?? '');

  return (
    <div className="t-pad">
      <button type="button" className="t-back" onClick={() => navigate({ name: 'search' })}>
        ← Back to results
      </button>

      <h1 className="t-section-title" style={{ marginTop: 0 }}>
        Your cart
      </h1>
      {restaurant && <p className="t-card-cuisines">From {restaurant.name}</p>}

      <ul className="t-list" style={{ gap: 0, marginTop: 8 }}>
        {lines.map((line) => {
          const menuItem = findItem(line.restaurantId, line.itemId);
          if (!menuItem) return null;
          return (
            <li className="t-item" key={line.itemId}>
              <div className="t-item-body">
                <span className="t-item-name">
                  <VegMark veg={menuItem.veg} />
                  {menuItem.name}
                </span>
                <p className="t-item-price">{formatRupees(menuItem.price * line.qty)}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <QtyStepper itemId={line.itemId} qty={line.qty} />
                <button
                  type="button"
                  className="t-clear"
                  aria-label={`Remove ${menuItem.name} from cart`}
                  onClick={() => removeItem(line.itemId)}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="t-bill" aria-label="Bill details">
        <BillRow label="Item total" value={totals.subtotal} />
        <BillRow label="Delivery fee" value={totals.deliveryFee} />
        <BillRow label="Taxes and charges" value={totals.taxes} />
        <BillRow label="Total" value={totals.total} total />
      </section>

      <button type="button" className="t-primary" onClick={() => navigate({ name: 'checkout' })}>
        Proceed to checkout · {formatRupees(totals.total)}
      </button>
    </div>
  );
}
