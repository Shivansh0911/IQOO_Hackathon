// RULE B fixture: an ordinary, well-built component. Must lint clean, forever.
export function CartButton({ count }: { count: number }) {
  return (
    <button type="button" aria-label={`Cart, ${count} items`}>
      Cart
    </button>
  );
}
