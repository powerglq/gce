/**
 * 农历：使用浏览器内置的中国历（Intl，ICU 数据），不引入农历算法库。
 * 浏览器给出年名（干支，如「丙午」）、月名（如「十月」「闰六月」）和数字日，这里只负责把日转换成「初五」这类写法。
 */

const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const TENS = ['初', '十', '廿', '三'];
const ZODIAC: Record<string, string> = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
  午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};

/** 农历日：1 → 初一，10 → 初十，20 → 二十，21 → 廿一，30 → 三十 */
export function lunarDayName(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 30) return '';
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  return TENS[Math.floor(day / 10)] + NUM[day % 10];
}

let fmt: Intl.DateTimeFormat | null = null;

/** 例：丙午马年 十月初五；浏览器不支持中国历时返回 '' */
export function formatLunar(date: Date): string {
  try {
    fmt ??= new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'long', day: 'numeric' });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const month = get('month');
    const rawDay = get('day');
    // 个别实现可能直接给出中文日，原样使用
    const day = /^\d+$/.test(rawDay) ? lunarDayName(Number(rawDay)) : rawDay;
    if (!month || !day || /^\d/.test(month)) return '';
    const yearName = get('yearName');
    const year = yearName ? `${yearName}${ZODIAC[yearName.slice(-1)] ?? ''}年 ` : '';
    return `${year}${month}${day}`;
  } catch {
    return '';
  }
}
