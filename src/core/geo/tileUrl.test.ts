import { describe, expect, it } from 'vitest';
import { checkTileUrl, isSecretParamName, stripTileKeys, VALUELESS_PARAM } from './tileUrl';

const T = 'https://tiles.example.org/{z}/{x}/{y}.png';

describe('checkTileUrl（D-51、FR-MP-01）', () => {
  it('FR-MP-01: https で {z}{x}{y} をすべて含めば通る（スキームの大小は問わない）', () => {
    expect(checkTileUrl(T)).toEqual({ ok: true });
    expect(checkTileUrl('HTTPS://t.example/{z}/{x}/{y}?style=a')).toEqual({ ok: true });
    expect(checkTileUrl('https://t.example/{x}/{y}/{z}.jpg')).toEqual({ ok: true });
  });
  it('FR-MP-01: https 以外は not-https', () => {
    for (const u of [
      'http://t.example/{z}/{x}/{y}.png',
      '//t.example/{z}/{x}/{y}',
      '/{z}/{x}/{y}',
      '',
      'ftp://t/{z}/{x}/{y}',
    ])
      expect(checkTileUrl(u)).toEqual({ ok: false, problem: 'not-https' });
  });
  it('FR-MP-01: 雛形が欠けていれば missing-placeholder', () => {
    for (const u of [
      'https://t.example/{z}/{x}.png',
      'https://t.example/tiles.png',
      'https://t.example/{Z}/{x}/{y}',
    ])
      expect(checkTileUrl(u)).toEqual({ ok: false, problem: 'missing-placeholder' });
  });
  it('FR-MP-01: {s}（サブドメインの雛形）は subdomain-placeholder に分ける', () => {
    for (const u of [
      'https://{s}.tile.example/{z}/{x}/{y}.png',
      'https://t.example/{s}/{z}/{x}/{y}',
    ])
      expect(checkTileUrl(u)).toEqual({ ok: false, problem: 'subdomain-placeholder' });
  });
  it('FR-MP-01: ホストが無い、空白や制御文字、資格情報、ホスト内の雛形は invalid', () => {
    for (const u of [
      'https:///{z}/{x}/{y}',
      'https://{z}/{x}/{y}',
      'https://t.example/{z}/{x}/{y} .png',
      'https://t.example/{z}/{x}/{y}\n',
      'https://user:pw@t.example/{z}/{x}/{y}',
      'https://t.example\u0000/{z}/{x}/{y}',
    ])
      expect(checkTileUrl(u)).toEqual({ ok: false, problem: 'invalid' });
  });
});

describe('stripTileKeys（D-52、NFR-02）', () => {
  const none = { removed: [], droppedFragment: false };
  it('NFR-02: 鍵らしい項目を、名前の大小を問わず除き、除いた名前を返す', () => {
    for (const name of [
      'key',
      'apikey',
      'api_key',
      'api-key',
      'access_token',
      'accessToken',
      'access-token',
      'token',
      'TOKEN',
      'API_KEY',
      'client_secret',
      'X-Amz-Signature',
      'X-Amz-Credential',
      'sig',
      'app_code',
      'password',
      'passwd',
    ]) {
      expect(stripTileKeys(`${T}?${name}=SECRET`)).toEqual({
        url: T,
        removed: [name],
        droppedFragment: false,
      });
    }
  });
  it('NFR-02: 他の項目は順序と表記を保つ。雛形は符号化しない', () => {
    const r = stripTileKeys(
      'https://t.example/{z}/{x}/{y}.png?style=a&key=K1&lang=ar&access_token=K2',
    );
    expect(r).toEqual({
      url: 'https://t.example/{z}/{x}/{y}.png?style=a&lang=ar',
      removed: ['key', 'access_token'],
      droppedFragment: false,
    });
  });
  it('NFR-02: フラグメント（#以降）は丸ごと落とす（#access_token=… など）', () => {
    expect(stripTileKeys(`${T}#access_token=K`)).toEqual({
      url: T,
      removed: [],
      droppedFragment: true,
    });
    expect(stripTileKeys(`${T}?style=a&key=K#frag`)).toEqual({
      url: `${T}?style=a`,
      removed: ['key'],
      droppedFragment: true,
    });
  });
  it('NFR-02: 名前の前後の空白と末尾の [] を除いて判定する', () => {
    expect(stripTileKeys(`${T}?key[]=1&s=2`)).toEqual({
      url: `${T}?s=2`,
      removed: ['key[]'],
      droppedFragment: false,
    });
    expect(stripTileKeys(`${T}?%20key%20=1&s=2`)).toEqual({
      url: `${T}?s=2`,
      removed: ['%20key%20'],
      droppedFragment: false,
    });
  });
  it('NFR-02: ; 区切りも区切りとして扱い、残る項目は元の区切りの文字でつなぎ直す', () => {
    expect(stripTileKeys(`${T}?style=a;key=K;lang=ar`)).toEqual({
      url: `${T}?style=a;lang=ar`,
      removed: ['key'],
      droppedFragment: false,
    });
    // 正当な値の中の ; を壊さない
    expect(stripTileKeys(`${T}?layers=a;b&key=X`)).toEqual({
      url: `${T}?layers=a;b`,
      removed: ['key'],
      droppedFragment: false,
    });
  });
  it('NFR-02: = の無い項目（値そのものの鍵）は、名前を残さず固定の印にする', () => {
    expect(stripTileKeys(`${T}?pk.eyJ1secretkey&s=2`)).toEqual({
      url: `${T}?s=2`,
      removed: [VALUELESS_PARAM],
      droppedFragment: false,
    });
  });
  it('NFR-02: 符号化された名前（%6Bey）や値の無い項目も除く。壊れた % はそのまま判定する', () => {
    expect(stripTileKeys(`${T}?%6Bey=1&s=2`)).toEqual({
      url: `${T}?s=2`,
      removed: ['%6Bey'],
      droppedFragment: false,
    });
    expect(stripTileKeys(`${T}?token&s=2`)).toEqual({
      url: `${T}?s=2`,
      removed: [VALUELESS_PARAM],
      droppedFragment: false,
    });
    expect(stripTileKeys(`${T}?%E0%A4=1&s=2`)).toEqual({ url: `${T}?%E0%A4=1&s=2`, ...none });
  });
  it('NFR-02: 鍵が無ければ入力と同じ。同じ名前が重なっても名前は 1 回', () => {
    expect(stripTileKeys(T)).toEqual({ url: T, ...none });
    expect(stripTileKeys(`${T}?style=a`)).toEqual({ url: `${T}?style=a`, ...none });
    expect(stripTileKeys(`${T}?key=1&key=2`)).toEqual({
      url: T,
      removed: ['key'],
      droppedFragment: false,
    });
  });
  it('NFR-02: 値に鍵らしい語があっても、項目名でなければ除かない（`?style=key`）', () => {
    expect(stripTileKeys(`${T}?style=key`).removed).toEqual([]);
  });
  it('NFR-02: isSecretParamName は、鍵らしくない名前を残す', () => {
    for (const n of ['style', 'lang', 'size', 'layer', 'scale', 'signal'])
      expect(isSecretParamName(n)).toBe(false);
  });
});
