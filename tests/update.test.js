import { describe, it, expect } from 'vitest';
import { compareVersions, parseGithubRelease, parseGiteeRelease, mergeFound } from '../extension/src/core/utils/update';

describe('compareVersions - 版本号比较', () => {
  it.each([
    ['1.2.0', '1.1.0', 1],
    ['v1.1.0', '1.1.0', 0],
    ['1.1', '1.1.0', 0],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '10.0.0', -1],
  ])('%s 与 %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b) ?? NaN)).toBe(sign);
  });

  it('无法解析的版本号返回 null（不误报更新）', () => {
    expect(compareVersions('GCE启动器v1.2.0', '1.1.0')).toBeNull();
    expect(compareVersions('1.2.0-beta', '1.1.0')).toBeNull();
    expect(compareVersions('', '1.1.0')).toBeNull();
  });
});

describe('parseGithubRelease - GitHub 返回格式', () => {
  it('取 tag_name 与 Release 页面地址', () => {
    expect(
      parseGithubRelease({ tag_name: 'v1.1.0', html_url: 'https://github.com/powerglq/gce/releases/tag/v1.1.0' })
    ).toEqual({ version: '1.1.0', url: 'https://github.com/powerglq/gce/releases/tag/v1.1.0' });
  });

  it('地址不在 github.com 或版本号无法识别时返回 null', () => {
    expect(parseGithubRelease({ tag_name: 'v1.1.0', html_url: 'https://evil.example/x' })).toBeNull();
    expect(parseGithubRelease({ tag_name: 'latest', html_url: 'https://github.com/a/b' })).toBeNull();
  });
});

describe('parseGiteeRelease - Gitee 返回格式', () => {
  // 字段与附件取自 2026-11-25 对 coolteam/gce 的实际请求结果
  const sample = {
    id: 1366647,
    tag_name: 'v1.1.0',
    name: 'GCE启动器V1.1.0',
    assets: [
      { browser_download_url: 'https://gitee.com/coolteam/gce/releases/download/v1.1.0/gce-v1.1.0.rar', name: 'gce-v1.1.0.rar' },
      { browser_download_url: 'https://gitee.com/coolteam/gce/archive/refs/tags/v1.1.0.zip', name: 'v1.1.0.zip' },
      { browser_download_url: 'https://gitee.com/coolteam/gce/archive/refs/tags/v1.1.0.tar.gz', name: 'v1.1.0.tar.gz' },
    ],
  };

  it('取上传的附件，跳过 Gitee 自动生成的源码包', () => {
    expect(parseGiteeRelease(sample)).toEqual({
      version: '1.1.0',
      url: 'https://gitee.com/coolteam/gce/releases/download/v1.1.0/gce-v1.1.0.rar',
    });
  });

  it('只有源码包、没有上传附件时返回 null', () => {
    expect(parseGiteeRelease({ ...sample, assets: sample.assets.slice(1) })).toBeNull();
  });
});

describe('mergeFound - 合并两个来源', () => {
  const gh = { version: '1.2.0', url: 'https://github.com/a/b/releases/tag/v1.2.0' };
  const ge = { version: '1.2.0', url: 'https://gitee.com/coolteam/gce/releases/download/v1.2.0/x.rar' };

  it('版本相同：两个下载地址都保留', () => {
    expect(mergeFound(mergeFound(null, 'github', gh), 'gitee', ge)).toEqual({
      version: '1.2.0',
      downloads: { github: gh.url, gitee: ge.url },
    });
  });

  it('版本不同：取高的，丢弃低版本的地址', () => {
    const old = { ...ge, version: '1.1.0' };
    expect(mergeFound(mergeFound(null, 'gitee', old), 'github', gh)).toEqual({
      version: '1.2.0',
      downloads: { github: gh.url },
    });
    expect(mergeFound(mergeFound(null, 'github', gh), 'gitee', old).downloads).toEqual({ github: gh.url });
  });
});
