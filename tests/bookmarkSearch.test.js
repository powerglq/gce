/**
 * 搜索框书签联想的匹配与排序（src/core/utils/bookmarkSearch.ts）
 */
import { describe, it, expect } from 'vitest';
import { searchBookmarks } from '../extension/src/core/utils/bookmarkSearch.ts';

const bm = (id, title, url) => ({ id, title, url, groupId: 'default', order: 10, createdAt: 0, updatedAt: 0 });

const LIST = [
  bm('gh', 'GitHub', 'https://github.com/'),
  bm('gitee', 'Gitee 码云', 'https://gitee.com/'),
  bm('mdn', 'MDN Web Docs', 'https://developer.mozilla.org/zh-CN/'),
  bm('bili', '哔哩哔哩', 'https://www.bilibili.com/'),
  bm('ghdocs', 'GitHub Docs', 'https://docs.github.com/'),
];

const ids = (q, list = LIST) => searchBookmarks(list, q).map((m) => m.bookmark.id);

describe('searchBookmarks - 匹配', () => {
  it('空输入不返回结果', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('不区分大小写，匹配标题', () => {
    expect(ids('mdn')).toEqual(['mdn']);
  });

  it('匹配域名（去掉 www.）与网址', () => {
    expect(ids('bilibili')).toEqual(['bili']);
    expect(ids('mozilla')).toEqual(['mdn']);
    expect(ids('zh-cn')).toEqual(['mdn']);
  });

  it('中文标题', () => {
    expect(ids('哔哩')).toEqual(['bili']);
  });

  it('多个词必须全部命中', () => {
    expect(ids('github docs')).toEqual(['ghdocs']);
    expect(ids('github 不存在')).toEqual([]);
  });

  it('最多返回 limit 条', () => {
    const many = Array.from({ length: 20 }, (_, i) => bm(`b${i}`, `Site ${i}`, `https://s${i}.example/`));
    expect(searchBookmarks(many, 'site', 6)).toHaveLength(6);
  });
});

describe('searchBookmarks - 排序', () => {
  it('标题完全相同优先于标题开头', () => {
    expect(ids('github')).toEqual(['gh', 'ghdocs']);
  });

  it('标题开头优先于标题中间', () => {
    const list = [bm('a', 'My Git Tools', 'https://a.example/'), bm('b', 'Git Cheatsheet', 'https://b.example/')];
    expect(ids('git', list)).toEqual(['b', 'a']);
  });

  it('得分相同时，标题短的在前', () => {
    const list = [bm('long', 'Vue Router Guide', 'https://x.example/'), bm('short', 'Vue Docs', 'https://y.example/')];
    expect(ids('vue', list)).toEqual(['short', 'long']);
  });
});

describe('searchBookmarks - 高亮片段', () => {
  it('标记命中部分并保留原始大小写', () => {
    const [m] = searchBookmarks(LIST, 'web');
    expect(m.titleParts).toEqual([
      { text: 'MDN ', hit: false },
      { text: 'Web', hit: true },
      { text: ' Docs', hit: false },
    ]);
  });

  it('多个词各自高亮，重叠时合并', () => {
    const [m] = searchBookmarks([bm('x', 'GitHub Docs', 'https://docs.github.com/')], 'git github');
    expect(m.titleParts.filter((p) => p.hit).map((p) => p.text)).toEqual(['GitHub']);
  });

  it('只命中网址时整个标题不高亮', () => {
    const [m] = searchBookmarks(LIST, 'mozilla');
    expect(m.titleParts).toEqual([{ text: 'MDN Web Docs', hit: false }]);
    expect(m.host).toBe('developer.mozilla.org');
  });
});
