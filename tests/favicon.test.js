/**
 * favicon / 网页标题抓取测试（shared/favicon.js）
 *
 * 该模块同时运行在 newtab 页与 background service worker 中，
 * 不依赖 DOMParser，因此在 node 环境即可测试。
 * 重点覆盖：空图检测、apple-touch-icon 收集、同源限制、标题提取。
 */
import { describe, it, expect } from 'vitest';
import {
  isBlankIcon,
  conventionalCandidates,
  collectIconLinksFromHtml,
  extractOriginFromTemplate,
  extractTitle,
} from '../extension/shared/favicon.js';

describe('isBlankIcon - 空图 / 占位图检测', () => {
  it('1×1 像素图判为空白（即使字节数不小）', () => {
    expect(isBlankIcon({ width: 1, height: 1 }, 5000)).toBe(true);
  });

  it('2×2 及以下判为空白', () => {
    expect(isBlankIcon({ width: 2, height: 2 }, 5000)).toBe(true);
  });

  it('体积过小判为空白（1×1 GIF 约 35 字节）', () => {
    expect(isBlankIcon({ width: 32, height: 32 }, 100)).toBe(true);
  });

  it('正常的 32×32 图标不算空白', () => {
    expect(isBlankIcon({ width: 32, height: 32 }, 1500)).toBe(false);
  });

  it('正常的 180×180 apple-touch-icon 不算空白', () => {
    expect(isBlankIcon({ width: 180, height: 180 }, 15000)).toBe(false);
  });

  it('尺寸为 0（解码失败）判为空白', () => {
    expect(isBlankIcon({ width: 0, height: 0 }, 5000)).toBe(true);
  });
});

describe('conventionalCandidates - 约定式同源候选', () => {
  it('包含 apple-touch-icon.png（约定优于配置）', () => {
    const list = conventionalCandidates('https://example.com');
    expect(list).toContain('https://example.com/apple-touch-icon.png');
  });

  it('favicon.ico 排在最前（成本最低、命中率最高）', () => {
    const list = conventionalCandidates('https://example.com');
    expect(list[0]).toBe('https://example.com/favicon.ico');
  });

  it('全部为同源地址，不引入第三方', () => {
    const list = conventionalCandidates('https://example.com');
    for (const u of list) {
      expect(new URL(u).origin).toBe('https://example.com');
    }
  });

  it('保留 origin 的端口', () => {
    const list = conventionalCandidates('http://localhost:3000');
    expect(list[0]).toBe('http://localhost:3000/favicon.ico');
  });
});

describe('collectIconLinksFromHtml - <link> 解析', () => {
  const origin = 'https://example.com';

  it('抓得到 apple-touch-icon（CSS rel~="icon" 抓不到的那个）', () => {
    const html = `<html><head>
      <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
    </head></html>`;
    const out = collectIconLinksFromHtml(html, origin);
    expect(out).toContain('https://example.com/apple.png');
  });

  it('普通 icon 优先于 apple-touch-icon', () => {
    const html = `<html><head>
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" href="/fav.ico">
    </head></html>`;
    const out = collectIconLinksFromHtml(html, origin);
    expect(out[0]).toBe('https://example.com/fav.ico');
    expect(out).toContain('https://example.com/apple.png');
  });

  it('同优先级按文档顺序保留（尊重页面作者的声明顺序）', () => {
    const html = `<html><head>
      <link rel="icon" href="/icon.png">
      <link rel="shortcut icon" href="/short.ico">
    </head></html>`;
    const out = collectIconLinksFromHtml(html, origin);
    // icon 与 shortcut icon 同级，排序稳定 → 保持文档顺序
    expect(out).toEqual(['https://example.com/icon.png', 'https://example.com/short.ico']);
  });

  it('低优先级项排在后面', () => {
    const html = `<html><head>
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" href="/fav.ico">
    </head></html>`;
    const out = collectIconLinksFromHtml(html, origin);
    expect(out[out.length - 1]).toBe('https://example.com/apple.png');
  });

  it('支持 mask-icon', () => {
    const html = `<html><head><link rel="mask-icon" href="/m.svg"></head></html>`;
    expect(collectIconLinksFromHtml(html, origin)).toContain('https://example.com/m.svg');
  });

  it('相对路径解析为绝对地址', () => {
    const html = `<html><head><link rel="icon" href="/sub/dir/f.png"></head></html>`;
    expect(collectIconLinksFromHtml(html, origin)).toContain('https://example.com/sub/dir/f.png');
  });

  it('拒绝跨域地址（隐私：不把书签列表泄露给第三方）', () => {
    const html = `<html><head>
      <link rel="icon" href="https://cdn.other.com/f.png">
      <link rel="icon" href="/local.png">
    </head></html>`;
    const out = collectIconLinksFromHtml(html, origin);
    expect(out).toEqual(['https://example.com/local.png']);
  });

  it('去重', () => {
    const html = `<html><head>
      <link rel="icon" href="/f.png">
      <link rel="shortcut icon" href="/f.png">
    </head></html>`;
    expect(collectIconLinksFromHtml(html, origin)).toHaveLength(1);
  });

  it('忽略非图标 rel（stylesheet / manifest 等）', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/a.css">
      <link rel="manifest" href="/m.json">
      <link rel="icon" href="/f.png">
    </head></html>`;
    expect(collectIconLinksFromHtml(html, origin)).toEqual(['https://example.com/f.png']);
  });

  it('无 link 时返回空数组', () => {
    expect(collectIconLinksFromHtml('<html><head></head></html>', origin)).toEqual([]);
  });

  it('非法 HTML 不抛异常', () => {
    expect(() => collectIconLinksFromHtml('<<<>>>not html', origin)).not.toThrow();
  });
});

describe('extractOriginFromTemplate - 搜索引擎模板', () => {
  it('从含 %s 的模板提取 origin', () => {
    expect(extractOriginFromTemplate('https://www.baidu.com/s?wd=%s')).toBe('https://www.baidu.com');
  });

  it('无 %s 也能提取', () => {
    expect(extractOriginFromTemplate('https://example.com/')).toBe('https://example.com');
  });

  it('非法模板返回 null', () => {
    expect(extractOriginFromTemplate('not a url')).toBeNull();
  });
});

describe('collectIconLinksFromHtml - 属性写法兼容', () => {
  it('支持单引号、无引号与属性顺序变化', () => {
    const html = `<link href='/a.png' rel='icon'><link rel=icon href=/b.png>`;
    expect(collectIconLinksFromHtml(html, 'https://example.com')).toEqual([
      'https://example.com/a.png',
      'https://example.com/b.png',
    ]);
  });
});

describe('extractTitle - 网页标题', () => {
  it('提取并解码 HTML 实体、压缩空白', () => {
    expect(extractTitle('<title>\n  A &amp; B &#20013;&#x6587;\n</title>')).toBe('A & B 中文');
  });

  it('没有 <title> 时返回空串', () => {
    expect(extractTitle('<html></html>')).toBe('');
    expect(extractTitle('')).toBe('');
  });
});
