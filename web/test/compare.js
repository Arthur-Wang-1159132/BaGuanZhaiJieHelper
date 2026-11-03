// 对比 JS 版本与 Python 版本（make_reference.py 生成的参考数据）
// 用法: node web/test/compare.js reference.json
const fs = require('fs');
const path = require('path');
const BGZJ = require(path.join(__dirname, '..', 'js', 'core.js'));

const ref = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let failures = 0;

function report(name, mismatches, total) {
  console.log(`${mismatches.length === 0 ? 'OK  ' : 'FAIL'} ${name}: ${total - mismatches.length}/${total} 一致`);
  mismatches.slice(0, 10).forEach((m) => console.log('     ', m));
  if (mismatches.length) failures++;
}

// 太阳时间：允许 1 秒误差（Python 用微秒、JS 用毫秒截断）
{
  const places = {};
  const mismatches = [];
  for (const r of ref.sun) {
    const place = places[r.place] ??= require('./places.json').find((p) => p.name === r.place);
    const t = BGZJ.getSunTimes(place, BGZJ.parseDateKey(r.date));
    for (const [k, js] of [['sunrise', t.sunrise], ['noon', t.noon], ['sunset', t.sunset], ['next_sunrise', t.nextSunrise]]) {
      const diff = Math.abs(js - Date.parse(r[k])) / 1000;
      if (diff > 1) mismatches.push(`${r.place} ${r.date} ${k}: python ${r[k]} js ${new Date(js).toISOString()}`);
    }
  }
  report('太阳时间', mismatches, ref.sun.length * 4);
}

// 农历：逐日对比月份、日、闰月
{
  const mismatches = [];
  const keys = Object.keys(ref.lunar);
  for (const key of keys) {
    const [month, day, leap] = ref.lunar[key];
    const l = BGZJ.lunarOf(BGZJ.parseDateKey(key));
    if (l.month !== month || l.day !== day || l.isLeapMonth !== leap) {
      mismatches.push(`${key}: python ${leap ? '闰' : ''}${month}月${day} js ${BGZJ.lunarLabel(l)}`);
    }
  }
  report('农历 1901-2098', mismatches, keys.length);
}

// 日期规则
{
  const keys = (dates) => dates.map(BGZJ.dateKey);
  const js = {
    lunar_six: keys(BGZJ.datesByLunarFastDays(2024, 2032, 'six')),
    lunar_ten: keys(BGZJ.datesByLunarFastDays(2024, 2032, 'ten')),
    monthly_31: keys(BGZJ.datesByMonthlyDay(2024, 2032, 31)),
    quarter_first: keys(BGZJ.datesByQuarter(2024, 2032, 'first')),
    quarter_last: keys(BGZJ.datesByQuarter(2024, 2032, 'last')),
    weekday_6_6_last: keys(BGZJ.datesByWeekdayRule(2024, 2032, 6, 6, 'last')),
    weekday_2_0_second: keys(BGZJ.datesByWeekdayRule(2024, 2032, 2, 0, 'second')),
  };
  for (const [name, expected] of Object.entries(ref.rules)) {
    const a = new Set(expected);
    const b = new Set(js[name]);
    const mismatches = [
      ...expected.filter((d) => !b.has(d)).map((d) => `仅 python: ${d}`),
      ...js[name].filter((d) => !a.has(d)).map((d) => `仅 js: ${d}`),
    ];
    report(`规则 ${name}`, mismatches, Math.max(a.size, b.size));
  }
}

process.exit(failures ? 1 : 0);
