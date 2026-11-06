/** Expandable business category taxonomy for professional accounts. */
export const BUSINESS_CATEGORIES = [
  {
    key: 'health',
    label: { en: 'Doctors, clinics & medical centers', ar: 'الأطباء والعيادات والمراكز الطبية' },
    requiresLicense: true
  },
  {
    key: 'company',
    label: { en: 'Companies & organizations', ar: 'الشركات والمؤسسات' },
    requiresLicense: true
  },
  {
    key: 'retail',
    label: { en: 'Shops & stores', ar: 'المحلات والمتاجر' },
    requiresLicense: false
  },
  {
    key: 'products',
    label: { en: 'Selling products & goods', ar: 'بيع المنتجات والسلع' },
    requiresLicense: false
  },
  {
    key: 'professional',
    label: { en: 'Professional services', ar: 'الخدمات المهنية' },
    requiresLicense: false
  },
  {
    key: 'food',
    label: { en: 'Restaurants & local services', ar: 'المطاعم والخدمات المحلية' },
    requiresLicense: false
  },
  {
    key: 'other',
    label: { en: 'Other', ar: 'أخرى' },
    requiresLicense: false
  }
] as const;

export type BusinessCategoryKey = (typeof BUSINESS_CATEGORIES)[number]['key'];

export function categoryRequiresLicense(key: string): boolean {
  return BUSINESS_CATEGORIES.some((c) => c.key === key && c.requiresLicense);
}

export const INTEREST_KEYS = [
  'medicine',
  'sports',
  'science',
  'technology',
  'education',
  'business',
  'news',
  'arts',
  'travel',
  'food',
  'fashion',
  'other'
] as const;
