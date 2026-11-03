// 用法: node --test web/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const B = require(path.join(__dirname, '..', 'js', 'core.js'));

const keys = (dates) => dates.map(B.dateKey);
const place = B.AUCKLAND_BRITOMART;

test('每月的第几天跳过不存在的日期', () => {
  const dates = keys(B.datesByMonthlyDay(2026, 2026, 31));
  assert.equal(dates.length, 7);
  assert.ok(!dates.includes('2026-02-28'));
});

test('季度第一天和最后一天', () => {
  assert.deepEqual(keys(B.datesByQuarter(2026, 2026, 'first')), ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
  assert.deepEqual(keys(B.datesByQuarter(2026, 2026, 'last')), ['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31']);
});

test('某月的第几个星期几', () => {
  assert.deepEqual(keys(B.datesByWeekdayRule(2026, 2026, 6, 6, 'last')), ['2026-06-28']);
  assert.deepEqual(keys(B.datesByWeekdayRule(2026, 2026, 6, 6, 'first')), ['2026-06-07']);
  assert.deepEqual(keys(B.datesByWeekdayRule(2026, 2026, 6, 6, 'second')), ['2026-06-14']);
});

test('斋日规则（大月与小月）', () => {
  assert.deepEqual([...B.lunarFastDays('six', 30)].sort((a, b) => a - b), [8, 14, 15, 23, 29, 30]);
  assert.deepEqual([...B.lunarFastDays('six', 29)].sort((a, b) => a - b), [8, 14, 15, 23, 28, 29]);
  assert.deepEqual([...B.lunarFastDays('ten', 29)].sort((a, b) => a - b), [1, 8, 14, 15, 18, 23, 24, 27, 28, 29]);
});

test('农历换算', () => {
  // 春节
  assert.equal(B.lunarLabel(B.lunarOf(B.ymd(2026, 2, 17))), '正月初一');
  assert.equal(B.lunarLabel(B.lunarOf(B.ymd(2027, 2, 6))), '正月初一');
  assert.equal(B.lunarLabel(B.lunarOf(B.ymd(2030, 2, 3))), '正月初一');
  // 闰月
  assert.equal(B.lunarLabel(B.lunarOf(B.ymd(2025, 7, 25))), '闰六月初一');
  assert.throws(() => B.lunarOf(B.ymd(1900, 1, 30)));
});

test('六斋日包含正月初八，且十斋日包含所有六斋日', () => {
  const six = keys(B.datesByLunarFastDays(2026, 2026, 'six'));
  const ten = new Set(keys(B.datesByLunarFastDays(2026, 2026, 'ten')));
  assert.ok(six.includes('2026-02-24'));
  assert.ok(six.length >= 70 && six.length <= 80);
  assert.ok(six.every((d) => ten.has(d)));
});

test('藏历新年（Losar）与已公布日期一致', () => {
  const losar = { 2024: '2024-02-10', 2025: '2025-02-28', 2026: '2026-02-18', 2027: '2027-02-07', 2028: '2028-02-26', 2029: '2029-02-14', 2030: '2030-03-05' };
  for (const [year, expected] of Object.entries(losar)) {
    const t = B.tibetanOf(B.parseDateKey(expected));
    assert.deepEqual([t.month, t.isLeapMonth, t.day, t.year], [1, false, 1, Number(year)], expected);
    const before = B.tibetanOf(B.addDays(B.parseDateKey(expected), -1));
    assert.equal(before.month, 12, `${expected} 前一天应为十二月`);
  }
});

test('藏历四大节日与已公布日期一致', () => {
  const dates = keys(B.tibetanObservances(2025, 2027, { festivals: true }).map((x) => x.date));
  for (const d of ['2025-06-11', '2025-11-11', '2026-05-31', '2027-06-18']) assert.ok(dates.includes(d), d);
  assert.equal(dates.length, 12);
});

test('藏历重日取第二天', () => {
  // 2025-11-19 与 2025-11-20 都是九月三十
  assert.equal(B.tibetanLabel(B.tibetanOf(B.ymd(2025, 11, 19))), '九月三十（重日第一天）');
  const obs = B.tibetanObservances(2025, 2025, { monthlyDays: ['d30'] });
  const days = keys(obs.map((x) => x.date));
  assert.ok(!days.includes('2025-11-19'));
  assert.ok(days.includes('2025-11-20'));
  assert.match(obs.find((x) => B.dateKey(x.date) === '2025-11-20').reasons[0], /重日，取第二天/);
});

test('藏历缺日提前一天', () => {
  // 2025 年十二月没有三十（2025-02-27 为十二月廿九，次日即正月初一），三十并入廿九
  assert.equal(B.tibetanLabel(B.tibetanOf(B.ymd(2025, 2, 27))), '十二月廿九');
  assert.equal(B.tibetanLabel(B.tibetanOf(B.ymd(2025, 2, 28))), '正月初一');
  const obs = B.tibetanObservances(2025, 2025, { monthlyDays: ['d30'] });
  const feb27 = obs.find((x) => B.dateKey(x.date) === '2025-02-27');
  assert.ok(feb27);
  assert.match(feb27.reasons[0], /十二月三十.*提前一天/);
  // 每个藏历月都恰好有一天负责三十
  assert.equal(obs.length, 12);
});

test('萨嘎达瓦月整月', () => {
  const obs = B.tibetanObservances(2026, 2026, { sagaDawaMonth: true });
  assert.equal(B.dateKey(obs[0].date), '2026-05-17');
  assert.ok(obs.length >= 29 && obs.length <= 31);
  assert.ok(obs.every((x) => B.tibetanOf(x.date).month === 4));
});

test('藏历斋日至少选一种', () => {
  assert.throws(() => B.tibetanObservances(2026, 2026, {}), /至少选择/);
});

test('藏历事件描述', () => {
  const obs = B.tibetanObservances(2026, 2026, { festivals: true });
  const notes = new Map(obs.map((x) => [B.dateKey(x.date), x.reasons]));
  const e = B.buildEvent(B.ymd(2026, 5, 31), { place, notes, showTibetan: true });
  assert.ok(e.description.startsWith('藏历四月十五 萨嘎达瓦节\n农历: '));
  assert.ok(e.description.includes('藏历: 四月十五\n'));
});

test('太阳时间为本地日期且顺序正确', () => {
  const t = B.getSunTimes(place, B.ymd(2026, 6, 21));
  assert.equal(B.formatLocalTime(t.sunrise, place.timezone), '07:33');
  assert.ok(t.sunrise < t.noon && t.noon < t.sunset && t.sunset < t.nextSunrise);
});

test('极昼极夜时给出明确的错误', () => {
  const arctic = { name: 'Longyearbyen', latitude: 78.22, longitude: 15.65, timezone: 'Arctic/Longyearbyen' };
  assert.throws(() => B.getSunTimes(arctic, B.ymd(2026, 6, 21)), /极昼或极夜/);
});

test('去重并排序', () => {
  const dates = B.uniqueSortedDates([...B.datesByMonthlyDay(2026, 2026, 1), ...B.datesByQuarter(2026, 2026, 'first')]);
  assert.equal(dates.length, 12);
  assert.equal(B.dateKey(dates[0]), '2026-01-01');
});

test('生成 .ics', () => {
  const events = [B.ymd(2026, 1, 1), B.ymd(2026, 2, 24)].map((d) => B.buildEvent(d, { place }));
  const ics = B.eventsToIcs(events, '八关斋戒', Date.UTC(2026, 0, 1));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('UID:bgzj-20260101@baguanzhaijie'));
  assert.ok(ics.includes('TRIGGER:-PT24H'));
  assert.equal(ics.split('BEGIN:VALARM').length - 1, 8);
  // 每行不超过 75 字节，且没有裸露的 LF
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.ok(!/[^\r]\n/.test(ics));
  // 折行还原后包含完整描述
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('DESCRIPTION:农历: 正月初八\\n日出: 07:00\\n'));
  assert.ok(unfolded.includes('过午不食'));
});

test('不提醒日中', () => {
  const e = B.buildEvent(B.ymd(2026, 1, 1), { place, noonReminderMinutes: null, reminderHours: [1] });
  assert.equal(e.alarms.length, 1);
});

test('度分秒', () => {
  assert.equal(B.toDms(-36.8440526109716, 'N', 'S'), '36°50\'38.6"S');
  assert.equal(B.toDms(174.7675260738167, 'E', 'W'), '174°46\'03.1"E');
});

test('非法输入', () => {
  assert.throws(() => B.datesByQuarter(2027, 2026));
  assert.throws(() => B.datesByMonthlyDay(2026, 2026, 32));
  assert.throws(() => B.datesByLunarFastDays(2026, 2026, 'seven'));
  assert.equal(B.isValidTimezone('Mars/Base'), false);
  assert.equal(B.isValidTimezone('Asia/Shanghai'), true);
});
