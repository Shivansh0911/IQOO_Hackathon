import { useEffect, useRef } from 'react';
import { Header } from './components/common.js';
import { SearchScreen } from './screens/SearchScreen.js';
import { RestaurantScreen } from './screens/RestaurantScreen.js';
import { CartScreen } from './screens/CartScreen.js';
import { CheckoutScreen, ConfirmedScreen } from './screens/CheckoutScreen.js';
import { useTiffin } from './state/store.js';

/**
 * Tiffin.
 *
 * A food delivery app. It renders screens, keeps a cart, and takes clicks. It
 * has no idea anything else is on the page.
 */
export function TiffinApp() {
  const route = useTiffin((s) => s.route);
  const body = useRef<HTMLDivElement>(null);

  // A new screen starts at the top, the way a phone app does.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [route.name, route.name === 'restaurant' ? route.restaurantId : '']);

  return (
    <div className="tiffin">
      <Header />
      <main className="t-body" ref={body}>
        {route.name === 'search' && <SearchScreen />}
        {route.name === 'restaurant' && <RestaurantScreen restaurantId={route.restaurantId} />}
        {route.name === 'cart' && <CartScreen />}
        {route.name === 'checkout' && <CheckoutScreen />}
        {route.name === 'confirmed' && <ConfirmedScreen orderId={route.orderId} />}
      </main>
    </div>
  );
}
