export type GiftCatalogItem = {
  key: string;
  title: string;
  costCoins: number;
  animationKey?: string;
};

export const GIFT_CATALOG: GiftCatalogItem[] = [
  {
    key: 'rose',
    title: 'Rose',
    costCoins: 15,
    animationKey: 'gift-rose-bloom'
  },
  {
    key: 'coffee',
    title: 'Coffee',
    costCoins: 30,
    animationKey: 'gift-coffee-steam'
  },
  {
    key: 'rocket',
    title: 'Rocket',
    costCoins: 75,
    animationKey: 'gift-rocket-launch'
  },
  {
    key: 'crown',
    title: 'Crown',
    costCoins: 150,
    animationKey: 'gift-crown-sparkle'
  }
];
