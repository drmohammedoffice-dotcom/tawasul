import { createHash } from 'node:crypto';

export const LEXICON_VERSION = 'lexicon-1.0.0';

export type TopicHit = { key: string; confidence: number; parent: string | null };

export type TextUnderstanding = {
  language: 'ar' | 'en' | 'mixed' | 'unknown';
  topics: TopicHit[];
  keywords: string[];
  hashtags: string[];
  postType: 'organic' | 'promotional' | 'news' | 'unknown';
  quality: 'ok' | 'low';
  modelVersion: string;
  provider: 'lexicon';
  summary: string | null;
};

type TopicDef = { key: string; parent: string | null; related: string[]; terms: string[] };

const TOPICS: TopicDef[] = [
  { key: 'technology', parent: null, related: [], terms: ['technology', 'tech', 'software', 'برمجة', 'تكنولوجيا', 'تقنية', 'تقنيه', 'تكنلوجيا'] },
  { key: 'cars', parent: null, related: [], terms: ['car', 'cars', 'vehicle', 'سيارة', 'سياره', 'سيارات'] },
  {
    key: 'electric_cars',
    parent: 'cars',
    related: ['technology'],
    terms: ['electric car', 'electric vehicle', 'ev', 'سيارة كهربائية', 'سياره كهربائيه', 'سيارات كهربائية']
  },
  { key: 'sports', parent: null, related: [], terms: ['sport', 'sports', 'رياضة', 'رياضه'] },
  { key: 'football', parent: 'sports', related: [], terms: ['football', 'soccer', 'كرة', 'كره', 'كورة', 'كرة القدم'] },
  { key: 'medicine', parent: null, related: ['health'], terms: ['medicine', 'medical', 'طب', 'طبيب'] },
  { key: 'health', parent: null, related: ['medicine'], terms: ['health', 'صحة', 'صحه'] },
  { key: 'beauty', parent: null, related: ['fashion'], terms: ['beauty', 'makeup', 'جمال', 'مكياج'] },
  { key: 'fashion', parent: null, related: ['beauty'], terms: ['fashion', 'أزياء', 'ازياء', 'موضة', 'موضه'] },
  { key: 'food', parent: null, related: [], terms: ['food', 'recipe', 'طبخ', 'طعام', 'أكل', 'اكل', 'كباب', 'دولمة', 'مسگوف', 'مسكوف'] },
  { key: 'travel', parent: null, related: [], terms: ['travel', 'trip', 'سفر', 'سياحة', 'سياحه'] },
  { key: 'business', parent: null, related: ['finance'], terms: ['business', 'startup', 'أعمال', 'اعمال', 'تجارة', 'تجاره'] },
  { key: 'education', parent: null, related: [], terms: ['education', 'school', 'تعليم', 'دراسة', 'دراسه'] },
  { key: 'gaming', parent: null, related: ['entertainment'], terms: ['game', 'gaming', 'ألعاب', 'العاب', 'قيمنق'] },
  { key: 'entertainment', parent: null, related: [], terms: ['entertainment', 'ترفيه', 'فيلم'] },
  { key: 'news', parent: null, related: [], terms: ['news', 'أخبار', 'اخبار'] },
  { key: 'finance', parent: null, related: ['business'], terms: ['finance', 'مال', 'استثمار', 'دينار'] },
  { key: 'real_estate', parent: null, related: [], terms: ['real estate', 'عقار', 'عقارات'] },
  { key: 'animals', parent: null, related: [], terms: ['animal', 'animals', 'حيوانات', 'قطط'] },
  { key: 'science', parent: null, related: [], terms: ['science', 'علوم', 'علم'] },
  {
    key: 'iraq_local',
    parent: null,
    related: [],
    terms: ['بغداد', 'البصرة', 'البصره', 'الموصل', 'أربيل', 'اربيل', 'كربلاء', 'النجف', 'سليمانية', 'دهوك', 'ديالى', 'الأنبار', 'الانبار', 'شلونك', 'شلونچ', 'اكو', 'ماكو', 'هسة', 'هسه', 'زين', 'خوش']
  }
];

const BY_KEY = new Map(TOPICS.map((topic) => [topic.key, topic]));

const PROMO = ['اشتر', 'خصم', 'عرض', 'توصيل', 'سعر', 'sale', 'discount', 'order now', 'اشتري', 'توصيل مجاني'];

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentHash(text: string, hashtags: string[] = []): string {
  const body = `${normalizeText(text)}\n${hashtags.map((tag) => normalizeText(tag)).sort().join(',')}`;
  return createHash('sha256').update(body).digest('hex');
}

export function extractHashtags(text: string): string[] {
  const found = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return [...new Set(found.map((tag) => tag.slice(1).toLowerCase()))];
}

export function analyzeText(text: string, hashtags: string[] = []): TextUnderstanding {
  const extracted = extractHashtags(text);
  const allTags = [...new Set([...hashtags.map((t) => t.toLowerCase()), ...extracted])];
  const normalized = normalizeText(`${text} ${allTags.join(' ')}`);
  const arabic = (normalized.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (normalized.match(/[a-z]/g) || []).length;
  const language: TextUnderstanding['language'] =
    arabic > 0 && latin > 0 ? 'mixed' : arabic > 0 ? 'ar' : latin > 0 ? 'en' : 'unknown';
  const quality: TextUnderstanding['quality'] = normalized.length < 2 || /(.)\1{7,}/.test(text) ? 'low' : 'ok';
  const scores = new Map<string, number>();
  const keywords: string[] = [];
  for (const topic of TOPICS) {
    for (const term of topic.terms) {
      const needle = normalizeText(term);
      if (!needle || !normalized.includes(needle)) continue;
      scores.set(topic.key, (scores.get(topic.key) || 0) + needle.split(' ').length);
      if (!keywords.includes(needle)) keywords.push(needle);
    }
  }
  const topics: TopicHit[] = [];
  for (const [key, hits] of scores) {
    const topic = BY_KEY.get(key);
    if (!topic) continue;
    const confidence = Math.round(Math.min(0.95, hits / (hits + 1)) * (quality === 'low' ? 0.5 : 1) * 100) / 100;
    if (confidence < 0.4) continue;
    topics.push({ key, confidence, parent: topic.parent });
    if (topic.parent && !scores.has(topic.parent)) {
      topics.push({ key: topic.parent, confidence: Math.round(confidence * 0.85 * 100) / 100, parent: null });
    }
    for (const related of topic.related) {
      topics.push({
        key: related,
        confidence: Math.round(confidence * 0.55 * 100) / 100,
        parent: BY_KEY.get(related)?.parent ?? null
      });
    }
  }
  const best = new Map<string, TopicHit>();
  for (const topic of topics) {
    const current = best.get(topic.key);
    if (!current || topic.confidence > current.confidence) best.set(topic.key, topic);
  }
  const ranked = [...best.values()].filter((topic) => topic.confidence >= 0.4).sort((a, b) => b.confidence - a.confidence);
  const promoHits = PROMO.filter((word) => normalized.includes(normalizeText(word))).length;
  const postType: TextUnderstanding['postType'] =
    promoHits >= 2 ? 'promotional' : ranked.some((t) => t.key === 'news') ? 'news' : ranked.length ? 'organic' : 'unknown';
  return {
    language,
    topics: ranked,
    keywords,
    hashtags: allTags,
    postType,
    quality,
    modelVersion: LEXICON_VERSION,
    provider: 'lexicon',
    summary: ranked[0] ? `${ranked[0].key}:${ranked[0].confidence}` : null
  };
}
