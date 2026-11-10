// 用精确分数运算（BigInt）独立实现 Janson 的 Phugpa 藏历，逐日对比 vendor/date-tibetan.js（浮点运算）
// 用法: node --test web/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const B = require(path.join(__dirname, '..', 'js', 'core.js'));

// ---- 分数 [p, q] ----
const gcd = (a, b) => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
function F(p, q = 1n) {
  p = BigInt(p); q = BigInt(q);
  if (q < 0n) { p = -p; q = -q; }
  const k = gcd(p, q) || 1n;
  return [p / k, q / k];
}
const add = (a, b) => F(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a, b) => add(a, [-b[0], b[1]]);
const mul = (a, b) => F(a[0] * b[0], a[1] * b[1]);
const lt = (a, b) => a[0] * b[1] < b[0] * a[1];
const floor = (a) => (a[0] % a[1] !== 0n && a[0] < 0n ? a[0] / a[1] - 1n : a[0] / a[1]);
const frac = (a) => sub(a, F(floor(a)));

// 分段线性插值的对称表（Janson 7.17-7.21）
function tab(x, values, half) {
  const sym = F(half * 2);
  let sign = 1n;
  if (!lt(x, sym)) { sign = -1n; x = sub(x, sym); }
  if (lt(F(half), x)) x = sub(sym, x);
  const i = Number(floor(x));
  const f = sub(x, F(i));
  const v = i >= values.length - 1 ? F(values.at(-1)) : add(mul(F(values[i]), sub(F(1), f)), mul(F(values[i + 1]), f));
  return mul(v, F(sign));
}

/** 第 n 月第 d 日（1-30）结束时的 true date */
function trueDate(n, d) {
  n = BigInt(n); d = BigInt(d);
  const mean = add(add(mul(F(n), F(167025, 5656)), mul(F(d), F(11135, 11312))), F(2015501n * 5656n + 4783n, 5656));
  const sun = frac(add(add(mul(F(n), F(65, 804)), mul(F(d), F(13, 4824))), F(743, 804)));
  const anomaly = frac(add(add(mul(F(n), F(253, 3528)), mul(F(d), F(1, 28))), F(475, 3528)));
  const moonEq = tab(mul(F(28), anomaly), [0, 5, 10, 15, 19, 22, 24, 25], 7);
  const sunEq = tab(mul(F(12), frac(sub(sun, F(1, 4)))), [0, 6, 10, 11], 3);
  return add(mean, mul(sub(moonEq, sunEq), F(1, 60)));
}

const tithiOf = (n, d) => n * 30 + d;
const fromTithi = (t) => { const n = Math.floor((t - 1) / 30); return [n, t - n * 30]; };

test('藏历：浮点实现与精确分数实现 1900-2100 逐日一致', () => {
  const jdnOf = (date) => Date.UTC(date.y, date.m - 1, date.d) / 86400000 + 2440588;
  const start = B.ymd(1900, 1, 1);
  const days = Math.round((Date.UTC(2100, 11, 31) - Date.UTC(1900, 0, 1)) / 86400000) + 1;

  // 精确实现：某天以当天开始时所处的太阴日命名；该太阴日在次日之后才结束则为重日的第一天
  let t = B.tibetanOf(start).tithi - 3;
  const mismatches = [];
  for (let i = 0; i < days; i++) {
    const date = B.addDays(start, i);
    const jdn = BigInt(jdnOf(date));
    while (!lt(F(jdn), trueDate(...fromTithi(t)))) t++;
    const isLeapDay = !lt(trueDate(...fromTithi(t)), F(jdn + 1n));
    const js = B.tibetanOf(date);
    if (js.tithi !== t || js.isLeapDay !== isLeapDay) {
      mismatches.push(`${B.dateKey(date)} exact=${t}${isLeapDay ? 'L' : ''} js=${js.tithi}${js.isLeapDay ? 'L' : ''}`);
    }
  }
  assert.deepEqual(mismatches.slice(0, 10), []);
});

test('藏历：连续两天的太阴日编号只会 +1（正常）、+0（重日）或 +2（缺日）', () => {
  let prev = B.tibetanOf(B.ymd(1900, 1, 1));
  for (let i = 1; i < 73414; i++) {
    const cur = B.tibetanOf(B.addDays(B.ymd(1900, 1, 1), i));
    const diff = cur.tithi - prev.tithi;
    assert.ok(diff >= 0 && diff <= 2);
    assert.equal(diff === 0, prev.isLeapDay);
    prev = cur;
  }
});

// 确保 tithiOf/fromTithi 互逆
test('tithi 编号互逆', () => {
  for (const t of [1, 29, 30, 31, 60, 61, 471751]) assert.equal(tithiOf(...fromTithi(t)), t);
});
