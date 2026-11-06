type Props = {
  onInsert: (ch: string) => void;
  onBackspace: () => void;
  onSpace: () => void;
  onClose?: () => void;
};

const ROWS = [
  ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'],
  ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
  ['ئ', 'ء', 'ؤ', 'ر', 'لا', 'ى', 'ة', 'و', 'ز', 'ظ', 'د'],
  ['ذ', 'إ', 'أ', 'آ', '،', '؟', '!', '.', 'ـ']
];

/** On-screen Arabic keyboard for emulators / devices without Arabic IME. */
export function ArabicKeyboard({ onInsert, onBackspace, onSpace, onClose }: Props) {
  return (
    <div className="ar-keyboard" dir="rtl" lang="ar">
      <div className="ar-keyboard-top">
        <span className="muted tiny">لوحة عربية</span>
        {onClose ? (
          <button type="button" className="button button-ghost button-compact" onClick={onClose}>
            إغلاق
          </button>
        ) : null}
      </div>
      {ROWS.map((row, i) => (
        <div key={i} className="ar-keyboard-row">
          {row.map((ch) => (
            <button key={`${i}-${ch}`} type="button" className="ar-key" onClick={() => onInsert(ch)}>
              {ch}
            </button>
          ))}
        </div>
      ))}
      <div className="ar-keyboard-row ar-keyboard-actions">
        <button type="button" className="ar-key ar-key-wide" onClick={onBackspace}>
          ⌫
        </button>
        <button type="button" className="ar-key ar-key-space" onClick={onSpace}>
          مسافة
        </button>
        <button type="button" className="ar-key" onClick={() => onInsert('\n')}>
          ↵
        </button>
      </div>
    </div>
  );
}
