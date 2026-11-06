import { createHash } from 'node:crypto';

/** Lexicon version. This is a maintainable term list, not a trained model. */
export const LEXICON_VERSION = 'lexicon-1.0.0';

export type TopicHit = {
  key: string;
  confidence: number;
  parent: string | null;
};

export type TextUnderstanding = {
  language: 'ar' | 'en' | 'mixed' | 'unknown';
  topics: TopicHit[];
  keywords: string[];
  quality: 'ok' | 'low';
  modelVersion: string;
};

type TopicDef = {
  key: string;
  parent: string | null;
  related: string[];
  terms: string[];
};

const TOPICS: TopicDef[] = [
  { key: 'technology', parent: null, related: [], terms: ['technology', 'tech', 'software', 'برمجة', 'تكنولوجيا', 'تقنية', 'تقنيه', 'تكنلوجيا'] },
  { key: 'cars', parent: null, related: [], terms: ['car', 'cars', 'vehicle', 'سيارة', 'سياره', 'سيارات'] },
  { key: 'electric_cars', parent: 'cars', related: ['technology'], terms: ['electric car', 'electric vehicle', 'ev', 'سيارة كهربائية', 'سياره كهربائيه', 'سيارات كهربائية'] },
  { key: 'sports', parent: null, related: [], terms: ['sport', 'sports', 'رياضة', 'رياضه'] },
  { key: 'football', parent: 'sports', related: [], terms: ['football', 'soccer', 'كرة', 'كره', 'كورة', 'كرة القدم'] },
  { key: 'medicine', parent: null, related: ['health'], terms: ['medicine', 'medical', 'طب', 'طبيب'] },
  { key: 'health', parent: null, related: ['medicine'], terms: ['health', 'صحة', 'صحه'] },
  { key: 'beauty', parent: null, related: ['fashion'], terms: ['beauty', 'makeup', 'جمال', 'مكياج'] },
  { key: 'fashion', parent: null, related: ['beauty'], terms: ['fashion', 'أزياء', 'ازياء', 'موضة', 'موضه'] },
  { key: 'food', parent: null, related: [], terms: ['food', 'recipe', 'طبخ', 'طعام', 'أكل', 'اكل'] },
  { key: 'travel', parent: null, related: [], terms: ['travel', 'trip', 'سفر', 'سياحة', 'سياحه'] },
  { key: 'business', parent: null, related: ['finance'], terms: ['business', 'startup', 'أعمال', 'اعمال', 'تجارة', 'تجاره'] },
  { key: 'education', parent: null, related: [], terms: ['education', 'school', 'تعليم', 'دراسة', 'دراسه'] },
  { key: 'gaming', parent: null, related: ['entertainment'], terms: ['game', 'gaming', 'ألعاب', 'العاب', 'قيمنق'] },
  { key: 'entertainment', parent: null, related: [], terms: ['entertainment', 'ترفيه', 'فيلم'] },
  { key: 'news', parent: null, related: [], terms: ['news', 'أخبار', 'اخبار'] },
  { key: 'finance', parent: null, related: ['business'], terms: ['finance', 'مال', 'استثمار'] },
  { key: 'real_estate', parent: null, related: [], terms: ['real estate', 'عقار', 'عقارات'] },
  { key: 'animals', parent: null, related: [], terms: ['animal', 'animals', 'حيوانات', 'قطط'] },
  { key: 'science', parent: null, related: [], terms: ['science', 'علوم', 'علم'] },
  {
    key: 'iraq_local',
    parent: null,
    related: [],
    terms: ['بغداد', 'البصرة', 'البصره', 'الموصل', 'أربيل', 'اربيل', 'كربلاء', 'النجف', 'سليمانية', 'دهوك', 'شلونك', 'اكو', 'ماكو', 'هسة', 'هسه', 'كباب', 'مسگوف', 'مسكوف']
  }
];

const BY_KEY = new Map(TOPICS.map((topic) => [topic.key, topic]));

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentHash(text: string, hashtags: string[]): string {
  const body = `${normalizeText(text)}\n${hashtags.map((tag) => normalizeText(tag)).sort().join(',')}`;
  return createHash('sha256').update(body).digest('hex');
}

export function analyzeText(text: string, hashtags: string[] = []): TextUnderstanding {
  const normalized = normalizeText(`${text} ${hashtags.join(' ')}`);
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
      topics.push({ key: related, confidence: Math.round(confidence * 0.55 * 100) / 100, parent: BY_KEY.get(related)?.parent ?? null });
    }
  }
  const best = new Map<string, TopicHit>();
  for (const topic of topics) {
    const current = best.get(topic.key);
    if (!current || topic.confidence > current.confidence) best.set(topic.key, topic);
  }
  return {
    language,
    topics: [...best.values()].filter((topic) => topic.confidence >= 0.4).sort((a, b) => b.confidence - a.confidence),
    keywords,
    quality,
    modelVersion: LEXICON_VERSION
  };
}

export function taxonomyKeys(): string[] {
  return TOPICS.map((topic) => topic.key);
}
