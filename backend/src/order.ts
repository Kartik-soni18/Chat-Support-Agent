export const ORDER = {
  id: 'ORD-48213',
  restaurant: 'Spice Route Kitchen',
  placedAt: '2026-09-24T19:05:00+05:30',
  items: [
    { id: 'butter-chicken', name: 'Butter Chicken', qty: 1, price: 349 },
    { id: 'garlic-naan', name: 'Garlic Naan', qty: 2, price: 120 },
    { id: 'chicken-biryani', name: 'Chicken Biryani', qty: 1, price: 299 },
    { id: 'gulab-jamun', name: 'Gulab Jamun (2 pcs)', qty: 1, price: 99 },
  ],
};

export const ISSUES = {
  not_delivered: { label: 'Food not delivered', needsItems: false, needsImages: false },
  quality: { label: 'Spoiled food or foreign object', needsItems: true, needsImages: true },
  missing: { label: 'Items missing', needsItems: true, needsImages: false },
  wrong_order: { label: 'Wrong order', needsItems: false, needsImages: true },
};
export type IssueId = keyof typeof ISSUES;

const commons = (path: string) => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/${path}`,
  thumb: `https://thumb.wikimedia.org/wikipedia/commons/thumb/${path}/960px-${path.split('/').pop()}`,
});
export const IMAGES = [
  { id: 'img-1', ...commons('2/28/Butter_chicken_rice_bowl_-_chaiiwala_2024-02-10.jpg') },
  { id: 'img-2', ...commons('3/3c/Chicken_makhani.jpg') },
  { id: 'img-3', ...commons('c/c8/Biryani_1.jpg') },
  { id: 'img-4', ...commons('0/00/Naan_2.jpg') },
  { id: 'img-5', ...commons('b/bc/Two_pizza_slices.jpg') },
  { id: 'img-6', ...commons('8/83/Generative_AI_can_be_used_to_create_realistic_images_of_food_dishes.jpg') },
];
