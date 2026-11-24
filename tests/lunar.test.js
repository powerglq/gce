import { describe, it, expect } from 'vitest';
import { lunarDayName, formatLunar } from '../extension/src/core/utils/lunar';

describe('lunarDayName - 农历日写法', () => {
  it.each([
    [1, '初一'],
    [5, '初五'],
    [10, '初十'],
    [11, '十一'],
    [19, '十九'],
    [20, '二十'],
    [21, '廿一'],
    [29, '廿九'],
    [30, '三十'],
  ])('%i → %s', (d, name) => {
    expect(lunarDayName(d)).toBe(name);
  });

  it('非法值返回空串', () => {
    expect(lunarDayName(0)).toBe('');
    expect(lunarDayName(31)).toBe('');
    expect(lunarDayName(1.5)).toBe('');
  });
});

describe('formatLunar - 浏览器内置中国历', () => {
  it('2026 年春节（2 月 17 日）是正月初一', () => {
    const text = formatLunar(new Date(2026, 1, 17, 12));
    expect(text).toMatch(/马年/);
    expect(text).toMatch(/初一$/);
  });

  it('春节前一天是腊月廿九或三十', () => {
    expect(formatLunar(new Date(2026, 1, 16, 12))).toMatch(/(廿九|三十)$/);
  });
});
