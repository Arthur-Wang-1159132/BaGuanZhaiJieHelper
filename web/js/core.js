/*
 * 八关斋戒日历核心逻辑：太阳时间、农历斋日、日期规则、生成 .ics
 *
 * 太阳时间算法移植自 Python astral 3.2（NOAA 算法），与 calendar_app 中的 Python 版本结果一致。
 * 农历数据表移植自 Python lunardate，支持 1900-2099 年（农历）。
 * 藏历（Phugpa 派）使用 vendor/date-tibetan.js（@hnw/date-tibetan），需在本文件之前加载。
 *
 * 日期统一用 {y, m, d} 表示（m 为 1-12），时刻统一用 UTC 毫秒数表示。
 * 在浏览器中作为全局变量 BGZJ 使用，在 Node 中通过 require 使用。
 */
const BGZJ = (() => {
  'use strict';

  const DAY_MS = 86400000;

  const AUCKLAND_BRITOMART = {
    name: 'Auckland Britomart Train Station',
    latitude: -36.8440526109716,
    longitude: 174.7675260738167,
    timezone: 'Pacific/Auckland',
  };

  // 每月的第几个星期几，-1 表示最后一个
  const WEEK_ORDINALS = { first: 0, second: 1, third: 2, fourth: 3, last: -1 };
  const LUNAR_FAST_TYPES = ['six', 'ten'];
  const WEEKDAY_NAMES = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

  // ---------- 日期工具 ----------

  const ymd = (y, m, d) => ({ y, m, d });
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const dateKey = (date) => `${date.y}-${pad(date.m)}-${pad(date.d)}`;
  const dateUtcMs = (date) => Date.UTC(date.y, date.m - 1, date.d);

  function fromUtcMs(ms) {
    const t = new Date(ms);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  const addDays = (date, days) => fromUtcMs(dateUtcMs(date) + days * DAY_MS);
  const compareDates = (a, b) => dateUtcMs(a) - dateUtcMs(b);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  // 0=星期一 ... 6=星期日，与 Python calendar 一致
  const weekdayOf = (date) => (new Date(dateUtcMs(date)).getUTCDay() + 6) % 7;

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return ymd(y, m, d);
  }

  // ---------- 时区 ----------

  const formatterCache = new Map();

  function zonedFormatter(timezone) {
    if (!formatterCache.has(timezone)) {
      formatterCache.set(timezone, new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    }
    return formatterCache.get(timezone);
  }

  function isValidTimezone(timezone) {
    try {
      zonedFormatter(timezone);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 某一时刻在指定时区的本地日期和时间 */
  function zonedParts(ms, timezone) {
    const parts = {};
    for (const p of zonedFormatter(timezone).formatToParts(new Date(ms))) parts[p.type] = p.value;
    return {
      date: ymd(Number(parts.year), Number(parts.month), Number(parts.day)),
      hour: Number(parts.hour), minute: Number(parts.minute),
    };
  }

  function formatLocalTime(ms, timezone) {
    const { hour, minute } = zonedParts(ms, timezone);
    return `${pad(hour)}:${pad(minute)}`;
  }

  // ---------- 太阳时间（移植自 astral.sun） ----------

  const radians = (deg) => deg * Math.PI / 180;
  const degrees = (rad) => rad * 180 / Math.PI;
  const SUN_APPARENT_RADIUS = 32.0 / (60.0 * 2.0);
  const RISING = 1;
  const SETTING = -1;

  function julianDay(date) {
    let { y: year, m: month } = date;
    if (month <= 2) {
      year -= 1;
      month += 12;
    }
    const a = Math.trunc(year / 100);
    const b = 2 - a + Math.trunc(a / 4);
    return Math.trunc(365.25 * (year + 4716)) + Math.trunc(30.6001 * (month + 1)) + date.d + b - 1524.5;
  }

  const julianCentury = (jd) => (jd - 2451545.0) / 36525.0;
  const geomMeanLongSun = (jc) => (((280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360) + 360) % 360;
  const geomMeanAnomalySun = (jc) => 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccentricLocationEarthOrbit = (jc) => 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

  function sunEqOfCenter(jc) {
    const mrad = radians(geomMeanAnomalySun(jc));
    return Math.sin(mrad) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
      + Math.sin(2 * mrad) * (0.019993 - 0.000101 * jc)
      + Math.sin(3 * mrad) * 0.000289;
  }

  const sunTrueLong = (jc) => geomMeanLongSun(jc) + sunEqOfCenter(jc);

  function sunApparentLong(jc) {
    const omega = 125.04 - 1934.136 * jc;
    return sunTrueLong(jc) - 0.00569 - 0.00478 * Math.sin(radians(omega));
  }

  function meanObliquityOfEcliptic(jc) {
    const seconds = 21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813));
    return 23.0 + (26.0 + seconds / 60.0) / 60.0;
  }

  function obliquityCorrection(jc) {
    const omega = 125.04 - 1934.136 * jc;
    return meanObliquityOfEcliptic(jc) + 0.00256 * Math.cos(radians(omega));
  }

  function sunDeclination(jc) {
    return degrees(Math.asin(Math.sin(radians(obliquityCorrection(jc))) * Math.sin(radians(sunApparentLong(jc)))));
  }

  function eqOfTime(jc) {
    const l0 = geomMeanLongSun(jc);
    const e = eccentricLocationEarthOrbit(jc);
    const m = geomMeanAnomalySun(jc);
    const y = Math.tan(radians(obliquityCorrection(jc)) / 2) ** 2;
    const sinm = Math.sin(radians(m));
    const etime = y * Math.sin(2 * radians(l0))
      - 2 * e * sinm
      + 4 * e * y * sinm * Math.cos(2 * radians(l0))
      - 0.5 * y * y * Math.sin(4 * radians(l0))
      - 1.25 * e * e * Math.sin(2 * radians(m));
    return degrees(etime) * 4.0;
  }

  function hourAngle(latitude, declination, zenith, direction) {
    const lat = radians(latitude);
    const dec = radians(declination);
    const h = (Math.cos(radians(zenith)) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
    if (h < -1 || h > 1) throw new RangeError('math domain error');
    const angle = Math.acos(h);
    return direction === SETTING ? -angle : angle;
  }

  function refractionAtZenith(zenith) {
    const elevation = 90 - zenith;
    if (elevation >= 85.0) return 0;
    const te = Math.tan(radians(elevation));
    let correction;
    if (elevation > 5.0) {
      correction = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    } else if (elevation > -0.575) {
      correction = 1735.0 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
    } else {
      correction = -20.774 / te;
    }
    return correction / 3600.0;
  }

  function minutesToMs(minutes) {
    const d = Math.trunc(minutes / 1440);
    const seconds = (minutes - d * 1440) * 60;
    const s = Math.trunc(seconds);
    const us = Math.trunc((seconds - s) * 1e6);
    return d * DAY_MS + s * 1000 + Math.trunc(us / 1000);
  }

  /** 太阳经过指定天顶角的 UTC 时刻（astral.sun.time_of_transit） */
  function timeOfTransit(place, date, zenith, direction) {
    const latitude = Math.max(-89.8, Math.min(89.8, place.latitude));
    const refraction = refractionAtZenith(zenith);
    const jd = julianDay(date);
    let adjustment = 0;
    let timeUtc = 0;
    for (let i = 0; i < 2; i++) {
      const jc = julianCentury(jd + adjustment);
      const angle = hourAngle(latitude, sunDeclination(jc), zenith + refraction, direction);
      const delta = -place.longitude - degrees(angle);
      let offset = delta * 4.0 - eqOfTime(jc);
      if (offset < -720.0) offset += 1440;
      timeUtc = 720.0 + offset;
      adjustment = timeUtc / 1440.0;
    }
    return dateUtcMs(date) + minutesToMs(timeUtc);
  }

  /** 本地日期 date 的日出或日落（astral.sun.sunrise / sunset） */
  function sunTransitOnLocalDate(place, date, direction) {
    const zenith = 90.0 + SUN_APPARENT_RADIUS;
    const label = direction === RISING ? '日出' : '日落';
    try {
      let t = timeOfTransit(place, date, zenith, direction);
      let localDate = zonedParts(t, place.timezone).date;
      if (compareDates(localDate, date) !== 0) {
        t = timeOfTransit(place, addDays(date, compareDates(localDate, date) < 0 ? 1 : -1), zenith, direction);
        localDate = zonedParts(t, place.timezone).date;
        if (compareDates(localDate, date) !== 0) throw new Error(`${dateKey(date)} 找不到${label}时间`);
      }
      return t;
    } catch (e) {
      // 极地附近可能出现极昼或极夜
      if (e instanceof RangeError) throw new Error(`${dateKey(date)} 在 ${place.name} 无法计算${label}（极昼或极夜）`);
      throw e;
    }
  }

  /** 太阳正午（astral.sun.noon） */
  function solarNoon(place, date) {
    const timeUtc = (720.0 - 4 * place.longitude - eqOfTime(julianCentury(julianDay(date)))) / 60.0;
    let hour = Math.trunc(timeUtc);
    let minute = Math.trunc((timeUtc - hour) * 60);
    let second = Math.trunc(((timeUtc - hour) * 60 - minute) * 60);
    let day = date;
    if (second > 59) { second -= 60; minute += 1; } else if (second < 0) { second += 60; minute -= 1; }
    if (minute > 59) { minute -= 60; hour += 1; } else if (minute < 0) { minute += 60; hour -= 1; }
    if (hour > 23) { hour -= 24; day = addDays(day, 1); } else if (hour < 0) { hour += 24; day = addDays(day, -1); }
    return dateUtcMs(day) + ((hour * 60 + minute) * 60 + second) * 1000;
  }

  /** 某天的日出、日中、日落以及次日日出（UTC 毫秒） */
  function getSunTimes(place, date) {
    return {
      sunrise: sunTransitOnLocalDate(place, date, RISING),
      noon: solarNoon(place, date),
      sunset: sunTransitOnLocalDate(place, date, SETTING),
      nextSunrise: sunTransitOnLocalDate(place, addDays(date, 1), RISING),
    };
  }

  // ---------- 农历 ----------
  //
  // 数据表与换算方法移植自 Python lunardate 0.3.0（源自 lunar 项目，Fung F. Lee & Ricky Yeung），
  // 与 Python 版本结果一致。没有使用浏览器内置的 Intl 中国历，因为 ICU 在部分年份有误，
  // 例如把 2027 年春节算成 2月7日（应为 2月6日）、2030 年春节算成 2月2日（应为 2月3日）。
  //
  // 每年一个整数：bit 15..4 为正月到十二月是否为大月（30 天），
  // bit 3..0 为闰几月（0 表示无闰月），bit 16 为闰月是否为大月。
  const LUNAR_YEAR_INFOS = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6, // 1970
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06aa0, 0x1a6c4, 0x0aae0, // 2050
    0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090
  ];
  const LUNAR_FIRST_YEAR = 1900;
  const LUNAR_EPOCH = ymd(1900, 1, 31); // 农历 1900 年正月初一

  /** 某个农历年的各月：[{month, isLeapMonth, days}] */
  function lunarMonthsOfYear(info) {
    const months = [];
    for (let m = 1; m <= 12; m++) months.push({ month: m, isLeapMonth: false, days: ((info >> (16 - m)) & 1) + 29 });
    const leap = info & 0xf;
    if (leap) months.splice(leap, 0, { month: leap, isLeapMonth: true, days: ((info >> 16) & 1) + 29 });
    return months;
  }

  const LUNAR_YEARS = LUNAR_YEAR_INFOS.map(lunarMonthsOfYear);
  const LUNAR_YEAR_DAYS = LUNAR_YEARS.map((months) => months.reduce((sum, x) => sum + x.days, 0));

  // 公历可换算的范围
  const LUNAR_MIN_DATE = LUNAR_EPOCH;
  const LUNAR_MAX_DATE = addDays(LUNAR_EPOCH, LUNAR_YEAR_DAYS.reduce((a, b) => a + b, 0) - 1);

  const LUNAR_MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  const LUNAR_DAY_NAMES = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
  ];

  /** 公历日期对应的农历：{year, month, day, isLeapMonth, monthLength} */
  function lunarOf(date) {
    let offset = Math.round((dateUtcMs(date) - dateUtcMs(LUNAR_EPOCH)) / DAY_MS);
    if (offset < 0 || compareDates(date, LUNAR_MAX_DATE) > 0) {
      throw new Error(`农历仅支持 ${dateKey(LUNAR_MIN_DATE)} 至 ${dateKey(LUNAR_MAX_DATE)}`);
    }
    let idx = 0;
    while (offset >= LUNAR_YEAR_DAYS[idx]) offset -= LUNAR_YEAR_DAYS[idx++];
    for (const m of LUNAR_YEARS[idx]) {
      if (offset < m.days) {
        return { year: LUNAR_FIRST_YEAR + idx, month: m.month, day: offset + 1, isLeapMonth: m.isLeapMonth, monthLength: m.days };
      }
      offset -= m.days;
    }
    throw new Error('农历数据错误');
  }

  const lunarLabel = (lunar) =>
    `${lunar.isLeapMonth ? '闰' : ''}${LUNAR_MONTH_NAMES[lunar.month - 1]}${LUNAR_DAY_NAMES[lunar.day - 1]}`;

  /**
   * 某个农历月中的斋日
   * 六斋日：初八、十四、十五、廿三、廿九、三十（小月为廿八、廿九）
   * 十斋日：初一、初八、十四、十五、十八、廿三、廿四、廿八、廿九、三十（小月为廿七、廿八、廿九）
   */
  function lunarFastDays(fastType, monthLength) {
    const last = monthLength;
    if (fastType === 'six') return new Set([8, 14, 15, 23, last - 1, last]);
    if (fastType === 'ten') return new Set([1, 8, 14, 15, 18, 23, 24, last - 2, last - 1, last]);
    throw new Error(`斋日类型只支持 ${LUNAR_FAST_TYPES.join(', ')}`);
  }

  // ---------- 藏历（时轮历 Phugpa 派，计算使用 vendor/date-tibetan.js） ----------
  //
  // 藏历的一个民用日以当天黎明时所处的太阴日（tithi）命名，因此会出现：
  //   - 重日：同一个日子出现两天，第一天为闰日。斋戒放在第二天。
  //   - 缺日：某个日子在当月不出现，它的太阴日在前一天之内开始并结束。斋戒放在前一天。
  // 两条规则可以统一为：每个民用日负责从「当天的日子」到「次日的日子」之前的所有太阴日。

  const Tibetan = typeof DateTibetan !== 'undefined' ? DateTibetan : require('./vendor/date-tibetan.js');
  const tibetanCalendar = new Tibetan.CalendarTibetan();
  const TIBETAN_MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  /** 藏历每月固定的斋日，key 用于界面勾选 */
  const TIBETAN_MONTHLY_DAYS = {
    d8: { day: 8, name: '药师佛日' },
    d10: { day: 10, name: '莲师荟供日' },
    d15: { day: 15, name: '阿弥陀佛日（满月）' },
    d25: { day: 25, name: '空行母荟供日' },
    d30: { day: 30, name: '释迦牟尼佛日（新月）' },
  };

  /** 四大节日（均在非闰月） */
  const TIBETAN_FESTIVALS = [
    { month: 1, day: 15, name: '神变节', short: '神变节' },
    { month: 4, day: 15, name: '萨嘎达瓦节', short: '萨嘎达瓦' },
    { month: 6, day: 4, name: '转法轮节', short: '转法轮节' },
    { month: 9, day: 22, name: '天降节', short: '天降节' },
  ];

  const tibetanMonthCache = new Map();

  /** 月序号（true month count）对应的藏历月 */
  function tibetanMonthOfCount(n) {
    if (!tibetanMonthCache.has(n)) {
      const { month, leapMonth } = tibetanCalendar._getTibetanMonthFromTrueMonthCount(n);
      tibetanMonthCache.set(n, { month, isLeapMonth: leapMonth });
    }
    return tibetanMonthCache.get(n);
  }

  /**
   * 公历日期对应的藏历：{year, month, isLeapMonth, day, isLeapDay, tithi}
   * year 为藏历年开始时的公历年份；tithi 为太阴日的连续编号，用于判断重日和缺日
   */
  function tibetanOf(date) {
    const c = new Tibetan.CalendarTibetan().fromGregorian(date.y, date.m, date.d);
    return {
      year: c._getGregorianYear(), month: c.month, isLeapMonth: c.leapMonth,
      day: c.day, isLeapDay: c.leapDay, tithi: c._getTrueMonthCount() * 30 + c.day,
    };
  }

  const tibetanDayLabel = (month, isLeapMonth, day) =>
    `${isLeapMonth ? '闰' : ''}${TIBETAN_MONTH_NAMES[month - 1]}${LUNAR_DAY_NAMES[day - 1]}`;

  const tibetanLabel = (t) => `${tibetanDayLabel(t.month, t.isLeapMonth, t.day)}${t.isLeapDay ? '（重日第一天）' : ''}`;

  /** 日历格子里的短标签：初一显示月份，其余显示日 */
  const lunarShortLabel = (lunar) =>
    (lunar.day === 1 ? `${lunar.isLeapMonth ? '闰' : ''}${LUNAR_MONTH_NAMES[lunar.month - 1]}` : LUNAR_DAY_NAMES[lunar.day - 1]);
  const tibetanShortLabel = (t) =>
    (t.day === 1 ? `${t.isLeapMonth ? '闰' : ''}${TIBETAN_MONTH_NAMES[t.month - 1]}` : LUNAR_DAY_NAMES[t.day - 1]);

  /** 藏历新年，不属于斋日选项，只用于殊胜日提示 */
  const TIBETAN_NEW_YEAR = { month: 1, day: 1, name: '藏历新年（洛萨）', short: '洛萨' };

  const ADJUST_NOTES = { skipped: '（当月无此日，提前一天）', doubled: '（重日，取第二天）' };

  /**
   * [start, end] 内每天的藏历殊胜日条目
   * @param {object} selection {monthlyDays: [{day, name}], festivals: bool, sagaDawaMonth: bool, newYear: bool}
   * @returns {{date, entries: {label, items: {name, kind}[], adjust}[], sagaDawaMonth: bool}[]}
   *   label 为负责的藏历日子（缺日时与当天的日子不同），adjust 为 'skipped' / 'doubled' / null
   */
  function tibetanDaysInRange(start, end, selection) {
    const result = [];
    let prev = tibetanOf(addDays(start, -1));
    let current = tibetanOf(start);
    for (let date = start; compareDates(date, end) <= 0; date = addDays(date, 1)) {
      const next = tibetanOf(addDays(date, 1));
      const entries = [];

      // 当天负责的太阴日：从当天的日子到次日的日子之前（重日的第一天为空，缺日并入前一天）
      for (let tithi = current.tithi; tithi < next.tithi; tithi++) {
        const n = Math.floor((tithi - 1) / 30);
        const day = tithi - n * 30;
        const { month, isLeapMonth } = tibetanMonthOfCount(n);
        const items = selection.monthlyDays.filter((x) => x.day === day).map((x) => ({ name: x.name, kind: 'practice', day }));
        if (!isLeapMonth) {
          const festivals = [
            ...(selection.newYear ? [TIBETAN_NEW_YEAR] : []),
            ...(selection.festivals ? TIBETAN_FESTIVALS : []),
          ];
          items.push(...festivals.filter((x) => x.month === month && x.day === day)
            .map((x) => ({ name: x.name, short: x.short, kind: 'festival' })));
        }
        if (!items.length) continue;
        const adjust = tithi !== current.tithi ? 'skipped' : prev.tithi === current.tithi ? 'doubled' : null;
        entries.push({ label: tibetanDayLabel(month, isLeapMonth, day), items, adjust });
      }
      // 萨嘎达瓦月按民用日计算，整月每天都算
      const sagaDawaMonth = Boolean(selection.sagaDawaMonth && current.month === 4 && !current.isLeapMonth);

      if (entries.length || sagaDawaMonth) result.push({ date, entries, sagaDawaMonth });
      prev = current;
      current = next;
    }
    return result;
  }

  /**
   * 藏历斋日
   * @param {object} selection {monthlyDays: ['d8', ...], festivals: bool, sagaDawaMonth: bool}
   * @returns {{date, reasons: string[]}[]}
   */
  function tibetanObservances(startYear, endYear, selection = {}) {
    const monthlyDays = (selection.monthlyDays || []).map((key) => {
      if (!(key in TIBETAN_MONTHLY_DAYS)) throw new Error(`未知的藏历斋日: ${key}`);
      return TIBETAN_MONTHLY_DAYS[key];
    });
    if (!monthlyDays.length && !selection.festivals && !selection.sagaDawaMonth) throw new Error('请至少选择一种藏历斋日');

    const end = ymd(years(startYear, endYear).at(-1), 12, 31);
    const days = tibetanDaysInRange(ymd(startYear, 1, 1), end, { ...selection, monthlyDays });
    return days.map(({ date, entries, sagaDawaMonth }) => ({
      date,
      reasons: [
        ...entries.map((e) => `藏历${e.label} ${e.items.map((x) => x.name).join('、')}${e.adjust ? ADJUST_NOTES[e.adjust] : ''}`),
        ...(sagaDawaMonth ? ['萨嘎达瓦月'] : []),
      ],
    }));
  }

  // ---------- 佛教殊胜日（用于日历提示） ----------

  /** 汉传佛教常见的佛菩萨纪念日（农历，非闰月）；day 为 30 时小月取廿九 */
  const HAN_FESTIVALS = [
    { month: 1, day: 1, name: '弥勒菩萨圣诞', short: '弥勒圣诞' },
    { month: 2, day: 8, name: '释迦牟尼佛出家日', short: '佛出家日' },
    { month: 2, day: 15, name: '释迦牟尼佛涅槃日', short: '佛涅槃日' },
    { month: 2, day: 19, name: '观世音菩萨圣诞', short: '观音圣诞' },
    { month: 2, day: 21, name: '普贤菩萨圣诞', short: '普贤圣诞' },
    { month: 3, day: 16, name: '准提菩萨圣诞', short: '准提圣诞' },
    { month: 4, day: 4, name: '文殊菩萨圣诞', short: '文殊圣诞' },
    { month: 4, day: 8, name: '释迦牟尼佛圣诞（浴佛节）', short: '浴佛节' },
    { month: 4, day: 28, name: '药王菩萨圣诞', short: '药王圣诞' },
    { month: 5, day: 13, name: '伽蓝菩萨圣诞', short: '伽蓝圣诞' },
    { month: 6, day: 3, name: '韦驮菩萨圣诞', short: '韦驮圣诞' },
    { month: 6, day: 19, name: '观世音菩萨成道日', short: '观音成道' },
    { month: 7, day: 13, name: '大势至菩萨圣诞', short: '势至圣诞' },
    { month: 7, day: 15, name: '盂兰盆节（佛欢喜日）', short: '盂兰盆节' },
    { month: 7, day: 30, name: '地藏菩萨圣诞', short: '地藏圣诞' },
    { month: 8, day: 22, name: '燃灯古佛圣诞', short: '燃灯圣诞' },
    { month: 9, day: 19, name: '观世音菩萨出家日', short: '观音出家' },
    { month: 9, day: 30, name: '药师佛圣诞', short: '药师圣诞' },
    { month: 10, day: 5, name: '达摩祖师圣诞', short: '达摩圣诞' },
    { month: 11, day: 17, name: '阿弥陀佛圣诞', short: '弥陀圣诞' },
    { month: 12, day: 8, name: '释迦牟尼佛成道日（腊八）', short: '腊八' },
  ];

  const TIBETAN_PRACTICE_SUGGESTIONS = {
    8: '宜修药师佛法门；藏传佛教常于此日受持八关斋戒',
    10: '宜修莲师法、荟供',
    15: '满月，藏传佛教常于此日受持八关斋戒（布萨）',
    25: '宜修空行母法、荟供',
    30: '新月，藏传佛教常于此日受持八关斋戒（布萨）',
  };

  /**
   * [start, end] 内每天的佛教殊胜日
   * @returns {Map<string, {tradition: 'han'|'tibetan', kind: 'fast'|'festival'|'practice'|'month', name, text, suggestion}[]>}
   *   text 为写入日历描述的一行文字，suggestion 为给用户的建议
   */
  function holyDaysInRange(start, end) {
    const map = new Map();
    const push = (date, item) => {
      const key = dateKey(date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    };

    for (let date = start; compareDates(date, end) <= 0; date = addDays(date, 1)) {
      if (compareDates(date, LUNAR_MIN_DATE) < 0 || compareDates(date, LUNAR_MAX_DATE) > 0) continue;
      const lunar = lunarOf(date);
      const label = `农历${lunarLabel(lunar)}`;
      if (!lunar.isLeapMonth) {
        for (const f of HAN_FESTIVALS) {
          const day = f.day === 30 ? lunar.monthLength : f.day;
          if (f.month === lunar.month && day === lunar.day) {
            push(date, { tradition: 'han', kind: 'festival', name: f.name, short: f.short, text: `${label} ${f.name}`, suggestion: '佛菩萨纪念日，宜礼佛、诵经、供养' });
          }
        }
      }
      if (lunarFastDays('six', lunar.monthLength).has(lunar.day)) {
        push(date, { tradition: 'han', kind: 'fast', name: '六斋日', text: `${label} 六斋日`, suggestion: '六斋日，传统受持八关斋戒之日' });
      } else if (lunarFastDays('ten', lunar.monthLength).has(lunar.day)) {
        push(date, { tradition: 'han', kind: 'fast', name: '十斋日', text: `${label} 十斋日`, suggestion: '十斋日，宜持斋念佛' });
      }
    }

    const selection = { monthlyDays: Object.values(TIBETAN_MONTHLY_DAYS), festivals: true, sagaDawaMonth: true, newYear: true };
    for (const { date, entries, sagaDawaMonth } of tibetanDaysInRange(start, end, selection)) {
      for (const e of entries) {
        const adjust = e.adjust ? ADJUST_NOTES[e.adjust] : '';
        for (const x of e.items) {
          const suggestion = x.kind === 'practice' ? TIBETAN_PRACTICE_SUGGESTIONS[x.day]
            : x.name === TIBETAN_NEW_YEAR.name ? '藏历新年' : '四大节日之一，藏传佛教认为此日行善功德倍增';
          push(date, { tradition: 'tibetan', kind: x.kind, name: x.name, short: x.short, day: x.day, text: `藏历${e.label} ${x.name}${adjust}`, suggestion });
        }
      }
      if (sagaDawaMonth) {
        push(date, { tradition: 'tibetan', kind: 'month', name: '萨嘎达瓦月', text: '萨嘎达瓦月', suggestion: '萨嘎达瓦月，藏传佛教认为整月行善功德倍增' });
      }
    }
    return map;
  }

  /** 某天是否适合受持八关斋戒：汉传六斋日/十斋日，或藏传初八、十五、三十、四大节日 */
  function isFastDay(items) {
    return items.some((x) => x.kind === 'fast' || (x.tradition === 'tibetan' && x.kind === 'festival' && x.name !== TIBETAN_NEW_YEAR.name)
      || (x.kind === 'practice' && [8, 15, 30].includes(x.day)));
  }

  // ---------- 日期规则 ----------

  function years(startYear, endYear) {
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) throw new Error('年份必须是整数');
    if (startYear > endYear) throw new Error('开始年份不能晚于结束年份');
    const list = [];
    for (let y = startYear; y <= endYear; y++) list.push(y);
    return list;
  }

  /** 每月的第几天，不存在的日期（如 2月30日）会被跳过 */
  function datesByMonthlyDay(startYear, endYear, day, months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('日期必须在 1-31 之间');
    const result = [];
    for (const y of years(startYear, endYear)) {
      for (const m of months) if (day <= daysInMonth(y, m)) result.push(ymd(y, m, day));
    }
    return result;
  }

  /** 每季度的第一天或最后一天 */
  function datesByQuarter(startYear, endYear, which = 'first') {
    if (which !== 'first' && which !== 'last') throw new Error("which 只支持 'first' 或 'last'");
    const result = [];
    for (const y of years(startYear, endYear)) {
      for (const m of [1, 4, 7, 10]) result.push(which === 'first' ? ymd(y, m, 1) : ymd(y, m + 2, daysInMonth(y, m + 2)));
    }
    return result;
  }

  /** 某月的第几个星期几，weekday: 0=星期一 ... 6=星期日 */
  function datesByWeekdayRule(startYear, endYear, month, weekday, which = 'last') {
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('月份必须在 1-12 之间');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('星期必须在 0-6 之间');
    if (!(which in WEEK_ORDINALS)) throw new Error(`which 只支持 ${Object.keys(WEEK_ORDINALS).join(', ')}`);
    const result = [];
    for (const y of years(startYear, endYear)) {
      const days = [];
      for (let d = 1; d <= daysInMonth(y, month); d++) if (weekdayOf(ymd(y, month, d)) === weekday) days.push(d);
      result.push(ymd(y, month, days.at(WEEK_ORDINALS[which])));
    }
    return result;
  }

  /** 农历六斋日或十斋日（闰月同样计算） */
  function datesByLunarFastDays(startYear, endYear, fastType = 'six') {
    if (!LUNAR_FAST_TYPES.includes(fastType)) throw new Error(`斋日类型只支持 ${LUNAR_FAST_TYPES.join(', ')}`);
    const result = [];
    const end = ymd(years(startYear, endYear).at(-1), 12, 31);
    for (let date = ymd(startYear, 1, 1); compareDates(date, end) <= 0; date = addDays(date, 1)) {
      const lunar = lunarOf(date);
      if (lunarFastDays(fastType, lunar.monthLength).has(lunar.day)) result.push(date);
    }
    return result;
  }

  /** 去重并排序 */
  function uniqueSortedDates(dates) {
    return [...new Set(dates.map(dateKey))].sort().map(parseDateKey);
  }

  // ---------- 事件与 .ics ----------

  function toDms(value, positive, negative) {
    const hemisphere = value >= 0 ? positive : negative;
    const abs = Math.abs(value);
    const deg = Math.trunc(abs);
    const minutesFloat = (abs - deg) * 60;
    const minutes = Math.trunc(minutesFloat);
    const seconds = ((minutesFloat - minutes) * 60).toFixed(1).padStart(4, '0');
    return `${deg}°${pad(minutes)}'${seconds}"${hemisphere}`;
  }

  /**
   * 生成某天的事件数据
   * options.showTibetan: 描述中加入藏历日期
   * options.notes: Map(dateKey -> string[])，写在描述开头（如藏历斋日名称）
   */
  function buildEvent(date, options) {
    const { place, reminderHours = [24, 12, 1], noonReminderMinutes = 30, showTibetan = false, notes } = options;
    const times = getSunTimes(place, date);
    const fmt = (ms) => formatLocalTime(ms, place.timezone);
    const totalMinutes = Math.trunc((times.nextSunrise - times.sunrise) / 60000);
    const summary = '太阳时间提醒';
    const description = [
      ...(notes?.get(dateKey(date)) || []),
      `农历: ${lunarLabel(lunarOf(date))}`,
      ...(showTibetan ? [`藏历: ${tibetanLabel(tibetanOf(date))}`] : []),
      `日出: ${fmt(times.sunrise)}`,
      `日中: ${fmt(times.noon)}`,
      `日落: ${fmt(times.sunset)}`,
      `明日日出: ${fmt(times.nextSunrise)}`,
      `总时长: ${pad(Math.trunc(totalMinutes / 60))}:${pad(totalMinutes % 60)}`,
      '注：由于不同经纬度以及海拔会导致时间有略微差异, 但几乎都在+-1分钟之内',
      `本次时间使用的是${place.name}（${toDms(place.latitude, 'N', 'S')} ${toDms(place.longitude, 'E', 'W')}）的时间`,
    ].join('\n') + '\n';

    const alarms = reminderHours.map((hours) => ({ hoursBefore: hours, text: summary }));
    if (noonReminderMinutes !== null && noonReminderMinutes !== undefined) {
      alarms.push({ at: times.noon - noonReminderMinutes * 60000, text: `日中 ${fmt(times.noon)}，过午不食` });
    }
    return {
      uid: `bgzj-${date.y}${pad(date.m)}${pad(date.d)}@baguanzhaijie`,
      date, summary, description, alarms,
      begin: times.sunrise, end: times.nextSunrise, times,
    };
  }

  const icsDateTime = (ms) => new Date(Math.trunc(ms / 1000) * 1000).toISOString().replace(/[-:]/g, '').replace('.000', '');

  function icsEscape(text) {
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  /** 按 RFC 5545 每行不超过 75 字节折行，不拆分多字节字符 */
  function foldLine(line) {
    const encoder = new TextEncoder();
    const out = [];
    let current = '';
    let bytes = 0;
    for (const ch of line) {
      const size = encoder.encode(ch).length;
      const limit = out.length === 0 ? 75 : 74; // 续行开头的空格占 1 字节
      if (bytes + size > limit) {
        out.push(current);
        current = '';
        bytes = 0;
      }
      current += ch;
      bytes += size;
    }
    out.push(current);
    return out.join('\r\n ');
  }

  function eventsToIcs(events, calendarName = '八关斋戒', now = Date.now()) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BaGuanZhaiJieHelper//BGZJ Calendar//ZH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(calendarName)}`,
    ];
    for (const e of events) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `DTSTAMP:${icsDateTime(now)}`,
        `DTSTART:${icsDateTime(e.begin)}`,
        `DTEND:${icsDateTime(e.end)}`,
        `SUMMARY:${icsEscape(e.summary)}`,
        `DESCRIPTION:${icsEscape(e.description)}`,
      );
      for (const a of e.alarms) {
        lines.push(
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${icsEscape(a.text)}`,
          a.at !== undefined ? `TRIGGER;VALUE=DATE-TIME:${icsDateTime(a.at)}` : `TRIGGER:-PT${a.hoursBefore}H`,
          'END:VALARM',
        );
      }
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  return {
    AUCKLAND_BRITOMART, WEEK_ORDINALS, LUNAR_FAST_TYPES, WEEKDAY_NAMES,
    ymd, dateKey, parseDateKey, addDays, weekdayOf, daysInMonth,
    isValidTimezone, formatLocalTime, getSunTimes,
    LUNAR_MIN_DATE, LUNAR_MAX_DATE, lunarOf, lunarLabel, lunarFastDays,
    TIBETAN_MONTHLY_DAYS, TIBETAN_FESTIVALS, tibetanOf, tibetanLabel, tibetanObservances,
    HAN_FESTIVALS, holyDaysInRange, isFastDay, lunarShortLabel, tibetanShortLabel, compareDates,
    datesByMonthlyDay, datesByQuarter, datesByWeekdayRule, datesByLunarFastDays, uniqueSortedDates,
    toDms, buildEvent, eventsToIcs, foldLine,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BGZJ;
