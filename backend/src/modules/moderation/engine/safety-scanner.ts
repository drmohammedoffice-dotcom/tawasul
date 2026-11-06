import { createHash } from 'node:crypto';
import { normalizeForSafetyAdvanced } from './text-normalize';

export type SafetyHit = {
  category: string;
  confidence: number;
  severity: number;
  source: 'text' | 'ocr' | 'audio' | 'hashtag' | 'rule' | 'fingerprint' | 'image';
  indicators: string[];
  needsHuman: boolean;
  critical: boolean;
};

export type SafetyScanResult = {
  hits: SafetyHit[];
  top: SafetyHit | null;
  contextualSafe: boolean;
  normalizedText: string;
  contentHash: string;
};

type Pattern = {
  category: string;
  severity: number;
  confidence: number;
  critical?: boolean;
  /** Match after normalize */
  re: RegExp;
  /** If any of these also match, treat as condemning / educational context → dampen */
  contextSafe?: RegExp[];
  /** Sexual content is never excused by contextSafe */
  noContextExcuse?: boolean;
};

/** @deprecated prefer normalizeForSafetyAdvanced — kept for call sites */
export function normalizeForSafety(input: string): string {
  return normalizeForSafetyAdvanced(input).normalized;
}

const PATTERNS: Pattern[] = [
  // Sexual — no context excuse for explicit solicitation / porn promotion
  {
    category: 'sexual',
    severity: 95,
    confidence: 0.92,
    critical: true,
    noContextExcuse: true,
    re: /(porn|xxx|onlyfans|sex\s*work|nude\s*pic|nudes?|explicit\s*sex|hardcore|blowjob|handjob|cum\s*shot|إباحي|اباحي|سكس|نيك|قحاب|دعارة|عري\s*كامل|مقاطع\s*جنسي|محتوى\s*جنسي|جنسيات|زبي|كسي|طيزي|شرموط|قحب|مص\s*زب)/i
  },
  {
    category: 'sexual',
    severity: 92,
    confidence: 0.88,
    critical: true,
    noContextExcuse: true,
    // Iraqi / Levant dialect + arabizi sexual slang (public posts only)
    re: /(اكعد\s*اركب|اركبني|نيج|نياك|منايك|شرموطة|قحبة|زب[يى]?|كس[يى]?|طيز[يى]?|صور\s*سحاق|سحاق|xnxx|xvideos|pornhub|سكسي|سكسية|hot\s*nudes?|send\s*nudes?|dick\s*pic|pussy|boobs?\s*pic)/i
  },
  {
    category: 'sexual',
    severity: 90,
    confidence: 0.85,
    critical: true,
    noContextExcuse: true,
    re: /(بيع\s*صور\s*خاصة|صور\s*حميمة(?:\s*للبيع)?|خدمات\s*جنسية|جنس\s*مقابل|صور\s*خاصة\s*ساخنة|محتوى\s*للكبار|للكبار\s*فقط|18\+|للبالغين)/i
  },
  // CSAM indicators — escalate; never generate or store CSAM fixtures
  {
    category: 'csam',
    severity: 100,
    confidence: 0.95,
    critical: true,
    noContextExcuse: true,
    re: /(child\s*porn|underage\s*sex|قاصر\s*جنس|اطفال\s*جنس|طفل\s*عاري\s*جنس)/i
  },
  // Violence / kill incitement
  {
    category: 'violence',
    severity: 92,
    confidence: 0.88,
    critical: true,
    re: /(اقتلوه|اقتلها|اقتله|اقتلك|اقتلكم|لازم\s*نقتل|go\s*kill\s+him|go\s*kill\s+her|i\s*will\s*kill\s+you|راح\s*اقتلك|هدد\s*بالقتل)/i,
    contextSafe: [
      /(أدين|ادين|نرفض|يرفض|جريمة|مجرم|ضد\s*القتل|condemn|denounce|murder\s*is\s*wrong)/i
    ]
  },
  {
    category: 'violence',
    severity: 90,
    confidence: 0.86,
    critical: true,
    re: /(كيفية\s*صنع\s*قنبلة|how\s*to\s*make\s*a\s*bomb|تعليمات\s*اعتداء|نفذ\s*هجوم)/i
  },
  // Hate
  {
    category: 'hate',
    severity: 85,
    confidence: 0.82,
    re: /(ابادة\s*جماعية|إبادة|يجب\s*تهجيرهم|قتل\s*كل\s*ال|exterminate\s*all|gas\s*the)/i,
    contextSafe: [/(توثيق|تقرير|ضد\s*الكراهية|history\s*of\s*genocide|ندين\s*خطاب)/i]
  },
  // Harassment / blackmail
  {
    category: 'harassment',
    severity: 80,
    confidence: 0.8,
    re: /(بنتزك|ابتزازك|انشر\s*صورك|blackmail\s*you|doox|دوكس)/i
  },
  // Self-harm promotion (not help-seeking)
  {
    category: 'self_harm',
    severity: 90,
    confidence: 0.84,
    critical: true,
    re: /(انتحر\s*الآن|طريقة\s*الانتحار|how\s*to\s*kill\s*yourself|تمجيد\s*الانتحار)/i,
    contextSafe: [
      /(اطلب\s*مساعدة|خط\s*المساعدة|recover|prevention|توعية|إذا\s*تمر\s*بأزمة|988|help\s*line)/i
    ]
  },
  // Crime / drugs facilitation
  {
    category: 'crime',
    severity: 85,
    confidence: 0.8,
    re: /(بيع\s*حشيش|بيع\s*كوكايين|selling\s*cocaine|how\s*to\s*launder|تبييض\s*اموال|تجنيد\s*لتنظيم\s*مسلح)/i
  },
  // Spam / fraud
  {
    category: 'spam',
    severity: 45,
    confidence: 0.75,
    re: /(اربح\s*مليون|whatsapp\s*\+?\d{8,}|click\s*here\s*free\s*money|تحويل\s*فوري\s*مضمون)/i
  },
  // Arabizi / mixed evasion (matched on arabiziFold + normalized)
  {
    category: 'sexual',
    severity: 90,
    confidence: 0.84,
    critical: true,
    noContextExcuse: true,
    re: /(s+e+x|p+o+r+n|n+u+d+e|only\s*fans|nikak|nya[kc]|sharmota|qa[hḥ]ba|kosy|ziby|teesy|sxy|sx+y)/i
  },
  {
    category: 'violence',
    severity: 88,
    confidence: 0.82,
    critical: true,
    re: /(a?qtulak|aqtuluk|ra7\s*aqtul|rah\s*aqtul)/i,
    contextSafe: [/(adeen|adeeno|refuse|condemn)/i]
  },
  {
    category: 'harassment',
    severity: 78,
    confidence: 0.78,
    re: /(bantzik|bantzək|black\s*mail|nshr\s*swrk)/i
  }
];

const MEDICAL_SAFE =
  /(تشريح|عضو\s*تناسلي\s*طبي|reproductive\s*health|breast\s*cancer|فحص\s*طبي|أمراض\s*نسائية|urolog)/i;

export function scanTextSafety(input: {
  text: string;
  hashtags?: string[];
  source?: SafetyHit['source'];
}): SafetyScanResult {
  const raw = [input.text || '', ...(input.hashtags || []).map((h) => `#${h}`)].join('\n');
  const bundle = normalizeForSafetyAdvanced(raw);
  const normalized = bundle.normalized;
  const arabizi = bundle.arabiziFold;
  const contentHash = createHash('sha256').update(normalized).digest('hex');
  const hits: SafetyHit[] = [];
  const source = input.source || 'text';

  for (const pattern of PATTERNS) {
    const matched =
      pattern.re.test(normalized) || pattern.re.test(raw) || pattern.re.test(arabizi);
    if (!matched) continue;
    let confidence = pattern.confidence;
    let dampened = false;
    if (
      !pattern.noContextExcuse &&
      pattern.contextSafe?.some(
        (re) => re.test(raw) || re.test(normalized) || re.test(arabizi)
      )
    ) {
      confidence *= 0.25;
      dampened = true;
    }
    if (pattern.category === 'sexual' && MEDICAL_SAFE.test(raw)) {
      confidence *= 0.2;
      dampened = true;
    }
    if (confidence < 0.35) continue;
    const indicators: string[] = [];
    const m = raw.match(pattern.re) || normalized.match(pattern.re) || arabizi.match(pattern.re);
    if (m?.[0]) indicators.push(m[0].slice(0, 40));
    if (dampened) indicators.push('context_dampened');
    if (pattern.re.test(arabizi) && !pattern.re.test(raw)) indicators.push('arabizi_fold');
    hits.push({
      category: pattern.category,
      confidence: Math.min(0.99, confidence),
      severity: pattern.severity,
      source,
      indicators,
      needsHuman: dampened || confidence < 0.85,
      critical: Boolean(pattern.critical) && confidence >= 0.7
    });
  }

  hits.sort((a, b) => b.confidence * b.severity - a.confidence * a.severity);
  return {
    hits,
    top: hits[0] || null,
    contextualSafe: hits.length === 0 || hits.every((h) => h.indicators.includes('context_dampened')),
    normalizedText: normalized.slice(0, 500),
    contentHash
  };
}

export function mergeHits(parts: SafetyScanResult[]): SafetyScanResult {
  const hits = parts.flatMap((p) => p.hits);
  hits.sort((a, b) => b.confidence * b.severity - a.confidence * a.severity);
  const byCat = new Map<string, SafetyHit>();
  for (const hit of hits) {
    const prev = byCat.get(hit.category);
    if (!prev || hit.confidence > prev.confidence) byCat.set(hit.category, hit);
  }
  const merged = [...byCat.values()].sort(
    (a, b) => b.confidence * b.severity - a.confidence * a.severity
  );
  const hashBase = parts.map((p) => p.contentHash).join('|');
  return {
    hits: merged,
    top: merged[0] || null,
    contextualSafe: merged.length === 0,
    normalizedText: parts.map((p) => p.normalizedText).join(' ').slice(0, 500),
    contentHash: createHash('sha256').update(hashBase || 'empty').digest('hex')
  };
}
