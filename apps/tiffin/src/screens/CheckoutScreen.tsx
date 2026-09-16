import { useState } from 'react';
import { formatRupees } from '../data/restaurants.js';
import { selectTotals, useTiffin } from '../state/store.js';
import { BillRow } from '../components/common.js';

const PAYMENT_METHODS = ['UPI', 'Card ending 4417', 'Cash on delivery'] as const;

export function CheckoutScreen() {
  const navigate = useTiffin((s) => s.navigate);
  const placeOrder = useTiffin((s) => s.placeOrder);
  const lines = useTiffin((s) => s.lines);
  const totals = selectTotals({ lines });
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);

  if (lines.length === 0) {
    return (
      <div className="t-pad t-empty">
        <h2>Nothing to check out</h2>
        <button type="button" className="t-back" onClick={() => navigate({ name: 'search' })}>
          ← Back to results
        </button>
      </div>
    );
  }

  return (
    <div className="t-pad">
      <button type="button" className="t-back" onClick={() => navigate({ name: 'cart' })}>
        ← Back to cart
      </button>

      <h1 className="t-section-title" style={{ marginTop: 0 }}>
        Checkout
      </h1>

      <section className="t-address" aria-label="Delivery address">
        <p className="t-address-label">Deliver to</p>
        <p>
          <strong>Home</strong> · Flat 302, Amrutha Heights, Madhapur, Hyderabad 500081
        </p>
      </section>

      <h2 className="t-section-title">Payment method</h2>
      <div role="radiogroup" aria-label="Payment method">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            className="t-pay-option"
            onClick={() => setMethod(m)}
          >
            <span className="t-radio" aria-hidden="true" />
            {m}
          </button>
        ))}
      </div>

      <section className="t-bill" aria-label="Bill details">
        <BillRow label="Item total" value={totals.subtotal} />
        <BillRow label="Delivery fee" value={totals.deliveryFee} />
        <BillRow label="Taxes and charges" value={totals.taxes} />
        <BillRow label="Total" value={totals.total} total />
      </section>

      <button type="button" className="t-primary" onClick={placeOrder}>
        Place order · {formatRupees(totals.total)}
      </button>
    </div>
  );
}

export function ConfirmedScreen({ orderId }: { orderId: string }) {
  const navigate = useTiffin((s) => s.navigate);
  const lastOrderTotal = useTiffin((s) => s.lastOrderTotal);

  return (
    <div className="t-confirmed">
      <div className="t-tick" aria-hidden="true">
        ✓
      </div>
      <h1>Order placed</h1>
      <p className="t-card-cuisines" style={{ marginTop: 6 }}>
        Your food is being prepared. Arriving in about 30 minutes.
      </p>
      <p className="t-order-id">
        Order {orderId}
        {lastOrderTotal !== null ? ` · ${formatRupees(lastOrderTotal)}` : ''}
      </p>
      <button type="button" className="t-primary" onClick={() => navigate({ name: 'search' })}>
        Back to restaurants
      </button>
    </div>
  );
}
