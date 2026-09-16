/**
 * Small shared pieces.
 *
 * Semantic elements and real ARIA throughout — not as a favour to anything that
 * might read this app, but because it is what a well-built app looks like. An
 * icon-only control gets an aria-label because a screen reader user needs it.
 */

import { formatRupees } from '../data/restaurants.js';
import { selectTotals, useTiffin } from '../state/store.js';

export function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      className={veg ? 't-veg-mark' : 't-veg-mark is-nonveg'}
      role="img"
      aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
    />
  );
}

export function Header() {
  const navigate = useTiffin((s) => s.navigate);
  const lines = useTiffin((s) => s.lines);
  const { itemCount } = selectTotals({ lines });

  return (
    <header className="t-header">
      <h1 className="t-wordmark">
        Tiffin<span>Hyderabad</span>
      </h1>
      <div className="t-header-spacer" />
      {/*
        Icon-only. The only thing that names this control is its aria-label —
        which is exactly what the accessibility tree exposes on a phone.
      */}
      <button
        type="button"
        className="t-icon-btn"
        aria-label={itemCount === 0 ? 'Cart, empty' : `Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
        onClick={() => navigate({ name: 'cart' })}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
          <circle cx="10" cy="20" r="1.4" />
          <circle cx="18" cy="20" r="1.4" />
        </svg>
        {itemCount > 0 && <span className="t-badge">{itemCount}</span>}
      </button>
    </header>
  );
}

export function QtyStepper({ itemId, qty }: { itemId: string; qty: number }) {
  const changeQty = useTiffin((s) => s.changeQty);
  return (
    <div className="t-stepper">
      <button type="button" aria-label="Decrease quantity" onClick={() => changeQty(itemId, -1)}>
        −
      </button>
      <span className="t-qty" aria-live="polite">
        {qty}
      </span>
      <button type="button" aria-label="Increase quantity" onClick={() => changeQty(itemId, 1)}>
        +
      </button>
    </div>
  );
}

export function BillRow({ label, value, total = false }: { label: string; value: number; total?: boolean }) {
  return (
    <div className={total ? 't-bill-row is-total' : 't-bill-row'}>
      <span>{label}</span>
      <span>{formatRupees(value)}</span>
    </div>
  );
}
