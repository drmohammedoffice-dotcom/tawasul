export type PolicyCategory = {
  key: string;
  enabled: boolean;
  severity: number;
  /** hide | flag | restrict | remove | human */
  autoAction: 'approve' | 'flag' | 'restrict' | 'hide' | 'remove' | 'human';
  humanReview: boolean;
  confidenceThreshold: number;
  critical: boolean;
  labelAr: string;
  userReason: string;
};

export const POLICY_KEY = 'tawasul-community';
export const POLICY_VERSION = '1.0.0';

export const DEFAULT_CATEGORIES: PolicyCategory[] = [
  {
    key: 'sexual',
    enabled: true,
    severity: 95,
    autoAction: 'hide',
    humanReview: false,
    confidenceThreshold: 0.72,
    critical: true,
    labelAr: 'محتوى جنسي',
    userReason: 'يخالف سياسة المحتوى الجنسي في تواصل.'
  },
  {
    key: 'csam',
    enabled: true,
    severity: 100,
    autoAction: 'remove',
    humanReview: true,
    confidenceThreshold: 0.4,
    critical: true,
    labelAr: 'استغلال قاصرين',
    userReason: 'محتوى محظور بشكل صارم ويُعزل فوراً.'
  },
  {
    key: 'violence',
    enabled: true,
    severity: 90,
    autoAction: 'hide',
    humanReview: true,
    confidenceThreshold: 0.75,
    critical: true,
    labelAr: 'عنف أو تحريض',
    userReason: 'يتضمن تحريضاً أو تهديداً عنيفاً.'
  },
  {
    key: 'hate',
    enabled: true,
    severity: 85,
    autoAction: 'hide',
    humanReview: true,
    confidenceThreshold: 0.75,
    critical: false,
    labelAr: 'كراهية أو تمييز',
    userReason: 'يتضمن خطاب كراهية أو تحريضاً ضد جماعة.'
  },
  {
    key: 'harassment',
    enabled: true,
    severity: 80,
    autoAction: 'restrict',
    humanReview: true,
    confidenceThreshold: 0.78,
    critical: false,
    labelAr: 'تحرش أو تنمر',
    userReason: 'يتضمن تحرشاً أو تهديداً أو ابتزازاً.'
  },
  {
    key: 'self_harm',
    enabled: true,
    severity: 88,
    autoAction: 'hide',
    humanReview: true,
    confidenceThreshold: 0.7,
    critical: true,
    labelAr: 'إيذاء النفس',
    userReason: 'يشجع على إيذاء النفس أو الانتحار.'
  },
  {
    key: 'crime',
    enabled: true,
    severity: 85,
    autoAction: 'hide',
    humanReview: true,
    confidenceThreshold: 0.78,
    critical: false,
    labelAr: 'نشاط غير قانوني',
    userReason: 'يروّج لأنشطة غير قانونية أو خطرة.'
  },
  {
    key: 'spam',
    enabled: true,
    severity: 40,
    autoAction: 'flag',
    humanReview: true,
    confidenceThreshold: 0.85,
    critical: false,
    labelAr: 'بريد عشوائي أو احتيال',
    userReason: 'يشبه البريد العشوائي أو الاحتيال.'
  },
  {
    key: 'impersonation',
    enabled: true,
    severity: 60,
    autoAction: 'flag',
    humanReview: true,
    confidenceThreshold: 0.8,
    critical: false,
    labelAr: 'انتحال شخصية',
    userReason: 'قد ينتحل شخصية شخص أو جهة.'
  },
  {
    key: 'privacy',
    enabled: true,
    severity: 70,
    autoAction: 'restrict',
    humanReview: true,
    confidenceThreshold: 0.8,
    critical: false,
    labelAr: 'انتهاك خصوصية',
    userReason: 'ينشر بيانات شخصية دون إذن.'
  }
];
