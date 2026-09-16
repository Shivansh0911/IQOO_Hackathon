/**
 * Tiffin's catalogue.
 *
 * Every brand here is invented. Any resemblance to a real delivery platform's
 * partners is unintended — we imitate nobody's name, mark or trade dress.
 * Places, cuisines and price points are Hyderabad-plausible so the app reads as
 * real to anyone who has ordered food in the city.
 */

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly price: number;
  readonly veg: boolean;
  readonly bestseller?: boolean;
  readonly soldOut?: boolean;
}

export interface Restaurant {
  readonly id: string;
  readonly name: string;
  readonly cuisines: readonly string[];
  readonly area: string;
  readonly rating: number;
  readonly deliveryMins: number;
  readonly priceForTwo: number;
  readonly pureVeg: boolean;
  readonly offer?: string;
  /** Two-letter monogram used instead of a photo. No logos, ours or anyone's. */
  readonly monogram: string;
  readonly tint: string;
  readonly items: readonly MenuItem[];
}

const item = (
  id: string,
  name: string,
  desc: string,
  price: number,
  veg: boolean,
  extra: Partial<MenuItem> = {},
): MenuItem => ({ id, name, desc, price, veg, ...extra });

export const RESTAURANTS: readonly Restaurant[] = [
  {
    id: 'r1',
    name: 'Deccan Dastarkhwan',
    cuisines: ['Biryani', 'Hyderabadi', 'Mughlai'],
    area: 'Banjara Hills',
    rating: 4.5,
    deliveryMins: 32,
    priceForTwo: 500,
    pureVeg: false,
    offer: '20% off up to ₹100',
    monogram: 'DD',
    tint: '#C0462B',
    items: [
      item('r1i1', 'Hyderabadi Chicken Dum Biryani', 'Long-grain rice sealed and slow-cooked with bone-in chicken', 329, false, { bestseller: true }),
      item('r1i2', 'Mutton Dum Biryani', 'Aged basmati, hand-pounded spices, served with mirchi ka salan', 449, false),
      item('r1i3', 'Veg Dum Biryani', 'Seasonal vegetables, saffron, fried onion', 249, true),
      item('r1i4', 'Double Ka Meetha', 'Fried bread pudding, cardamom, dry fruit', 129, true),
      item('r1i5', 'Mirchi Ka Salan', 'Long chillies in a peanut and sesame gravy', 99, true),
      item('r1i6', 'Chicken 65', 'Fried, curry-leaf tempered, tossed with yoghurt chilli', 269, false),
    ],
  },
  {
    id: 'r2',
    name: 'Charminar Chulha',
    cuisines: ['Biryani', 'Kebabs', 'North Indian'],
    area: 'Old City',
    rating: 4.3,
    deliveryMins: 41,
    priceForTwo: 450,
    pureVeg: false,
    monogram: 'CC',
    tint: '#8F2F1B',
    items: [
      item('r2i1', 'Chicken Biryani', 'Family recipe, cooked over coal', 299, false, { bestseller: true }),
      item('r2i2', 'Seekh Kebab', 'Minced mutton, charcoal grilled, six pieces', 289, false),
      item('r2i3', 'Paneer Tikka', 'Char-marked cottage cheese, mint chutney', 259, true),
      item('r2i4', 'Butter Naan', 'Tandoor baked, brushed with butter', 69, true),
      item('r2i5', 'Haleem', 'Seasonal. Wheat, lentils and slow-cooked meat', 199, false, { soldOut: true }),
    ],
  },
  {
    id: 'r3',
    name: 'Golconda Grill House',
    cuisines: ['Kebabs', 'Mughlai', 'Rolls'],
    area: 'Tolichowki',
    rating: 4.1,
    deliveryMins: 28,
    priceForTwo: 400,
    pureVeg: false,
    offer: 'Free delivery over ₹299',
    monogram: 'GG',
    tint: '#A0522D',
    items: [
      item('r3i1', 'Chicken Malai Tikka', 'Cream and cheese marinade, mildly spiced', 279, false, { bestseller: true }),
      item('r3i2', 'Mutton Boti Kebab', 'Boneless, twice-marinated', 349, false),
      item('r3i3', 'Veg Seekh Roll', 'Spiced vegetable seekh in a flaky paratha', 169, true),
      item('r3i4', 'Chicken Tikka Roll', 'Onion, mint, lime', 199, false),
    ],
  },
  {
    id: 'r4',
    name: 'Jubilee Tiffins',
    cuisines: ['South Indian', 'Breakfast'],
    area: 'Jubilee Hills',
    rating: 4.6,
    deliveryMins: 22,
    priceForTwo: 250,
    pureVeg: true,
    offer: '₹75 off on first order',
    monogram: 'JT',
    tint: '#2F7D32',
    items: [
      item('r4i1', 'Ghee Podi Idli', 'Steamed idli tossed in gunpowder and ghee', 139, true, { bestseller: true }),
      item('r4i2', 'Masala Dosa', 'Crisp dosa, potato masala, two chutneys', 149, true),
      item('r4i3', 'Pesarattu Upma', 'Green gram crepe with semolina upma', 159, true),
      item('r4i4', 'Filter Coffee', 'Chicory blend, served in a tumbler', 59, true),
      item('r4i5', 'Rava Kesari', 'Semolina, ghee, saffron, cashew', 89, true),
    ],
  },
  {
    id: 'r5',
    name: 'Banjara Bowl Co.',
    cuisines: ['Healthy', 'Salads', 'Continental'],
    area: 'Banjara Hills',
    rating: 4.2,
    deliveryMins: 26,
    priceForTwo: 550,
    pureVeg: false,
    monogram: 'BB',
    tint: '#4C7C3F',
    items: [
      item('r5i1', 'Grilled Chicken Quinoa Bowl', 'Quinoa, greens, lemon herb dressing', 349, false, { bestseller: true }),
      item('r5i2', 'Paneer Buddha Bowl', 'Millets, roast vegetables, tahini', 299, true),
      item('r5i3', 'Caesar Salad', 'Romaine, parmesan, garlic croutons', 279, true),
      item('r5i4', 'Cold Pressed Orange', '250ml, no added sugar', 129, true),
    ],
  },
  {
    id: 'r6',
    name: 'Secunderabad Spice Room',
    cuisines: ['Andhra', 'Biryani', 'Seafood'],
    area: 'Secunderabad',
    rating: 4.0,
    deliveryMins: 38,
    priceForTwo: 420,
    pureVeg: false,
    monogram: 'SS',
    tint: '#B03A2E',
    items: [
      item('r6i1', 'Andhra Chicken Biryani', 'Guntur chilli, generously spiced', 289, false, { bestseller: true }),
      item('r6i2', 'Gongura Mutton', 'Sorrel leaf gravy, a Telugu classic', 399, false),
      item('r6i3', 'Chepala Pulusu', 'Tamarind fish curry', 359, false),
      item('r6i4', 'Gutti Vankaya', 'Stuffed baby aubergine in peanut masala', 229, true),
    ],
  },
  {
    id: 'r7',
    name: 'Hitech Hunger Station',
    cuisines: ['Fast Food', 'Burgers', 'Beverages'],
    area: 'Madhapur',
    rating: 3.9,
    deliveryMins: 19,
    priceForTwo: 300,
    pureVeg: false,
    offer: 'Buy 1 Get 1 on shakes',
    monogram: 'HH',
    tint: '#D4791F',
    items: [
      item('r7i1', 'Crispy Chicken Burger', 'Buttermilk fried fillet, slaw', 219, false, { bestseller: true }),
      item('r7i2', 'Paneer Zinger Burger', 'Spiced paneer, jalapeno mayo', 199, true),
      item('r7i3', 'Peri Peri Fries', 'Tossed in house peri masala', 129, true),
      item('r7i4', 'Thick Chocolate Shake', '400ml, with chocolate chips', 179, true),
    ],
  },
  {
    id: 'r8',
    name: 'Kondapur Kitchen',
    cuisines: ['North Indian', 'Thali', 'Home Style'],
    area: 'Kondapur',
    rating: 4.4,
    deliveryMins: 34,
    priceForTwo: 350,
    pureVeg: true,
    monogram: 'KK',
    tint: '#2E7D6B',
    items: [
      item('r8i1', 'Deluxe Veg Thali', 'Two sabzi, dal, rice, four rotis, sweet', 289, true, { bestseller: true }),
      item('r8i2', 'Dal Makhani', 'Slow-simmered overnight, finished with cream', 229, true),
      item('r8i3', 'Paneer Butter Masala', 'Tomato and cashew gravy', 269, true),
      item('r8i4', 'Jeera Rice', 'Basmati tempered with cumin', 149, true),
      item('r8i5', 'Gulab Jamun', 'Two pieces, warm syrup', 99, true),
    ],
  },
  {
    id: 'r9',
    name: 'Nampally Nashta',
    cuisines: ['Irani', 'Bakery', 'Breakfast'],
    area: 'Nampally',
    rating: 4.2,
    deliveryMins: 24,
    priceForTwo: 200,
    pureVeg: false,
    monogram: 'NN',
    tint: '#8C6239',
    items: [
      item('r9i1', 'Irani Chai and Osmania', 'Two cups of chai, four biscuits', 99, true, { bestseller: true }),
      item('r9i2', 'Keema Puff', 'Flaky pastry, spiced mince', 89, false),
      item('r9i3', 'Dil Pasand', 'Sweet bun with tutti frutti and coconut', 79, true),
      item('r9i4', 'Malai Bun', 'Soft bun, sweetened cream', 109, true),
    ],
  },
  {
    id: 'r10',
    name: 'Gachibowli Greens',
    cuisines: ['Salads', 'Healthy', 'Juices'],
    area: 'Gachibowli',
    rating: 4.0,
    deliveryMins: 21,
    priceForTwo: 380,
    pureVeg: true,
    offer: '15% off above ₹400',
    monogram: 'GR',
    tint: '#3E7B3E',
    items: [
      item('r10i1', 'Sprout Chaat Bowl', 'Moong, pomegranate, chaat masala', 189, true),
      item('r10i2', 'Millet Khichdi', 'Foxtail millet, seasonal vegetables', 219, true, { bestseller: true }),
      item('r10i3', 'Watermelon Mint Cooler', '300ml, freshly pressed', 119, true),
    ],
  },
  {
    id: 'r11',
    name: 'Warangal Wok',
    cuisines: ['Chinese', 'Indo-Chinese', 'Noodles'],
    area: 'Kukatpally',
    rating: 3.8,
    deliveryMins: 36,
    priceForTwo: 320,
    pureVeg: false,
    monogram: 'WW',
    tint: '#9C4221',
    items: [
      item('r11i1', 'Chicken Hakka Noodles', 'Wok-tossed with spring onion', 239, false, { bestseller: true }),
      item('r11i2', 'Veg Manchurian Dry', 'Eight pieces, garlic and chilli', 199, true),
      item('r11i3', 'Chilli Paneer', 'Capsicum, onion, soy chilli glaze', 249, true),
      item('r11i4', 'Schezwan Fried Rice', 'House schezwan paste', 219, true),
    ],
  },
  {
    id: 'r12',
    name: 'Falaknuma Feast',
    cuisines: ['Mughlai', 'Biryani', 'Desserts'],
    area: 'Charminar',
    rating: 4.7,
    deliveryMins: 44,
    priceForTwo: 700,
    pureVeg: false,
    offer: 'Flat ₹150 off above ₹699',
    monogram: 'FF',
    tint: '#7B341E',
    items: [
      item('r12i1', 'Royal Mutton Biryani', 'Whole spices, kewra, served in a handi', 549, false, { bestseller: true }),
      item('r12i2', 'Murgh Zafrani Korma', 'Saffron and almond gravy', 429, false),
      item('r12i3', 'Shahi Tukda', 'Saffron milk soaked bread, silver leaf', 179, true),
      item('r12i4', 'Qubani Ka Meetha', 'Stewed apricot with cream', 169, true),
    ],
  },
  {
    id: 'r13',
    name: 'Musi Riverside Mess',
    cuisines: ['Andhra', 'Meals', 'Home Style'],
    area: 'Dilsukhnagar',
    rating: 4.1,
    deliveryMins: 29,
    priceForTwo: 260,
    pureVeg: false,
    monogram: 'MR',
    tint: '#A45A2A',
    items: [
      item('r13i1', 'Andhra Meals Unlimited', 'Rice, three curries, rasam, curd, pickle', 199, true, { bestseller: true }),
      item('r13i2', 'Chicken Fry Piece Meals', 'Meals with two pieces of fry', 279, false),
      item('r13i3', 'Ulavacharu', 'Horse gram broth, a Telugu speciality', 149, true),
    ],
  },
  {
    id: 'r14',
    name: 'Qutb Shahi Kebab Co.',
    cuisines: ['Kebabs', 'Rolls', 'Hyderabadi'],
    area: 'Mehdipatnam',
    rating: 4.3,
    deliveryMins: 31,
    priceForTwo: 480,
    pureVeg: false,
    monogram: 'QS',
    tint: '#6B2737',
    items: [
      item('r14i1', 'Galouti Kebab', 'Melt-in-mouth mince, six pieces with ulte tawe ka paratha', 379, false, { bestseller: true }),
      item('r14i2', 'Tangdi Kebab', 'Two chicken drumsticks, charcoal grilled', 299, false),
      item('r14i3', 'Dahi Ke Kebab', 'Hung curd, cashew, pan-seared', 259, true),
      item('r14i4', 'Sheermal', 'Saffron flatbread, two pieces', 89, true),
    ],
  },
  {
    id: 'r15',
    name: 'Shamirpet Sweet House',
    cuisines: ['Desserts', 'Sweets', 'Bakery'],
    area: 'Alwal',
    rating: 4.5,
    deliveryMins: 47,
    priceForTwo: 220,
    pureVeg: true,
    monogram: 'SH',
    tint: '#B8860B',
    items: [
      item('r15i1', 'Kaju Katli 250g', 'Cashew, silver leaf, no added flour', 289, true, { bestseller: true }),
      item('r15i2', 'Motichoor Ladoo', 'Box of six', 219, true),
      item('r15i3', 'Badam Milk', '200ml, served chilled', 99, true),
    ],
  },
];

export const DELIVERY_FEE = 29;
export const TAX_RATE = 0.05;

export function findRestaurant(id: string): Restaurant | undefined {
  return RESTAURANTS.find((r) => r.id === id);
}

export function findItem(restaurantId: string, itemId: string): MenuItem | undefined {
  return findRestaurant(restaurantId)?.items.find((i) => i.id === itemId);
}

export function formatRupees(paise: number): string {
  return `₹${paise.toLocaleString('en-IN')}`;
}
