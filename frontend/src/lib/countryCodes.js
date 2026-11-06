/** Common dial codes — Iraq first as app default. */
export const COUNTRY_DIAL_CODES = [
    { code: 'IQ', dial: '+964', nameAr: 'العراق', nameEn: 'Iraq' },
    { code: 'SA', dial: '+966', nameAr: 'السعودية', nameEn: 'Saudi Arabia' },
    { code: 'AE', dial: '+971', nameAr: 'الإمارات', nameEn: 'United Arab Emirates' },
    { code: 'KW', dial: '+965', nameAr: 'الكويت', nameEn: 'Kuwait' },
    { code: 'BH', dial: '+973', nameAr: 'البحرين', nameEn: 'Bahrain' },
    { code: 'QA', dial: '+974', nameAr: 'قطر', nameEn: 'Qatar' },
    { code: 'OM', dial: '+968', nameAr: 'عُمان', nameEn: 'Oman' },
    { code: 'JO', dial: '+962', nameAr: 'الأردن', nameEn: 'Jordan' },
    { code: 'SY', dial: '+963', nameAr: 'سوريا', nameEn: 'Syria' },
    { code: 'LB', dial: '+961', nameAr: 'لبنان', nameEn: 'Lebanon' },
    { code: 'EG', dial: '+20', nameAr: 'مصر', nameEn: 'Egypt' },
    { code: 'TR', dial: '+90', nameAr: 'تركيا', nameEn: 'Turkey' },
    { code: 'IR', dial: '+98', nameAr: 'إيران', nameEn: 'Iran' },
    { code: 'US', dial: '+1', nameAr: 'الولايات المتحدة', nameEn: 'United States' },
    { code: 'GB', dial: '+44', nameAr: 'المملكة المتحدة', nameEn: 'United Kingdom' },
    { code: 'DE', dial: '+49', nameAr: 'ألمانيا', nameEn: 'Germany' },
    { code: 'FR', dial: '+33', nameAr: 'فرنسا', nameEn: 'France' },
    { code: 'CA', dial: '+1', nameAr: 'كندا', nameEn: 'Canada' },
    { code: 'AU', dial: '+61', nameAr: 'أستراليا', nameEn: 'Australia' },
    { code: 'IN', dial: '+91', nameAr: 'الهند', nameEn: 'India' },
    { code: 'PK', dial: '+92', nameAr: 'باكستان', nameEn: 'Pakistan' },
    { code: 'CN', dial: '+86', nameAr: 'الصين', nameEn: 'China' },
    { code: 'RU', dial: '+7', nameAr: 'روسيا', nameEn: 'Russia' },
    { code: 'SE', dial: '+46', nameAr: 'السويد', nameEn: 'Sweden' },
    { code: 'NL', dial: '+31', nameAr: 'هولندا', nameEn: 'Netherlands' }
];
export function filterCountries(q, locale = 'ar') {
    const s = q.trim().toLowerCase();
    if (!s)
        return COUNTRY_DIAL_CODES;
    return COUNTRY_DIAL_CODES.filter((c) => {
        const name = locale === 'ar' ? c.nameAr : c.nameEn;
        return (c.code.toLowerCase().includes(s) ||
            c.dial.includes(s) ||
            c.dial.replace('+', '').includes(s.replace('+', '')) ||
            name.toLowerCase().includes(s) ||
            c.nameAr.includes(q.trim()) ||
            c.nameEn.toLowerCase().includes(s));
    });
}
