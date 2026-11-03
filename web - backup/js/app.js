// 页面交互：读取表单、预览、下载 .ics
(() => {
  'use strict';

  const B = BGZJ;
  const STORAGE_KEY = 'bgzj-settings-v1';
  const MAX_YEARS = 30;
  const $ = (id) => document.getElementById(id);

  const LUNAR_HINTS = {
    six: '初八、十四、十五、廿三、廿九、三十（小月为廿八、廿九），闰月同样计算。',
    ten: '初一、初八、十四、十五、十八、廿三、廿四、廿八、廿九、三十（小月为廿七、廿八、廿九），闰月同样计算。',
  };

  const fields = ['rule', 'lunarType', 'monthDay', 'quarterWhich', 'weekdayMonth', 'weekdayWhich', 'weekdayDay',
    'tibetanFestivals', 'tibetanSagaDawa',
    'startYear', 'endYear', 'placeName', 'latitude', 'longitude', 'timezone', 'noonReminder', 'noonMinutes'];
  // 多选框组：保存为选中值的数组
  const checkboxGroups = ['reminder', 'tibetanDay'];
  const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => x.value);

  // ---------- 初始化 ----------

  function fillSelect(select, labels, firstValue, selected) {
    labels.forEach((label, i) => select.add(new Option(label, String(firstValue + i))));
    select.value = String(selected);
  }

  fillSelect($('weekdayMonth'), Array.from({ length: 12 }, (_, i) => `${i + 1} 月`), 1, 6);
  fillSelect($('weekdayDay'), B.WEEKDAY_NAMES, 0, 6);

  if (typeof Intl.supportedValuesOf === 'function') {
    const list = $('timezones');
    for (const tz of Intl.supportedValuesOf('timeZone')) list.append(new Option(tz));
  }

  function setPlace(place) {
    $('placeName').value = place.name;
    $('latitude').value = place.latitude;
    $('longitude').value = place.longitude;
    $('timezone').value = place.timezone;
  }

  function applyDefaults() {
    const year = new Date().getFullYear();
    $('startYear').value = year;
    $('endYear').value = Math.min(year + 4, 2099);
    setPlace(B.AUCKLAND_BRITOMART);
  }

  function readStorage() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function saveSettings() {
    const data = {};
    for (const id of fields) data[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
    for (const name of checkboxGroups) data[name] = checkedValues(name);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // 隐私模式等情况下无法保存，忽略
    }
  }

  function restoreSettings() {
    applyDefaults();
    const data = readStorage();
    if (!data) return;
    for (const id of fields) {
      if (!(id in data)) continue;
      if ($(id).type === 'checkbox') $(id).checked = Boolean(data[id]);
      else $(id).value = data[id];
    }
    for (const name of checkboxGroups) {
      if (!Array.isArray(data[name])) continue;
      for (const box of document.querySelectorAll(`input[name="${name}"]`)) box.checked = data[name].includes(box.value);
    }
  }

  function updateRuleInputs() {
    const rule = $('rule').value;
    for (const el of document.querySelectorAll('[data-rule]')) el.hidden = el.dataset.rule !== rule;
    $('lunarHint').textContent = LUNAR_HINTS[$('lunarType').value];
    $('noonMinutes').disabled = !$('noonReminder').checked;
  }

  // ---------- 读取输入 ----------

  function intValue(id, label) {
    const raw = $(id).value.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isInteger(value)) throw new Error(`请输入有效的${label}`);
    return value;
  }

  function numberValue(id, label) {
    const raw = $(id).value.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) throw new Error(`请输入有效的${label}`);
    return value;
  }

  function readOptions() {
    const startYear = intValue('startYear', '开始年份');
    const endYear = intValue('endYear', '结束年份');
    if (startYear < 1901 || endYear > 2099) throw new Error('年份必须在 1901-2099 之间');
    if (startYear > endYear) throw new Error('开始年份不能晚于结束年份');
    if (endYear - startYear + 1 > MAX_YEARS) throw new Error(`一次最多生成 ${MAX_YEARS} 年`);

    const place = {
      name: $('placeName').value.trim() || '自定义地点',
      latitude: numberValue('latitude', '纬度'),
      longitude: numberValue('longitude', '经度'),
      timezone: $('timezone').value.trim(),
    };
    if (place.latitude < -90 || place.latitude > 90) throw new Error('纬度必须在 -90 到 90 之间');
    if (place.longitude < -180 || place.longitude > 180) throw new Error('经度必须在 -180 到 180 之间');
    if (!B.isValidTimezone(place.timezone)) throw new Error(`时区无效：${place.timezone || '(空)'}`);

    let noonReminderMinutes = null;
    if ($('noonReminder').checked) {
      noonReminderMinutes = intValue('noonMinutes', '日中提醒分钟数');
      if (noonReminderMinutes < 0) throw new Error('日中提醒分钟数不能为负数');
    }
    const reminderHours = checkedValues('reminder').map(Number);

    return { startYear, endYear, place, reminderHours, noonReminderMinutes };
  }

  /** 按所选规则计算日期；藏历规则还返回每天的斋日说明 */
  function computeRule({ startYear, endYear }) {
    switch ($('rule').value) {
      case 'lunar':
        return { dates: B.datesByLunarFastDays(startYear, endYear, $('lunarType').value) };
      case 'tibetan': {
        const observances = B.tibetanObservances(startYear, endYear, {
          monthlyDays: checkedValues('tibetanDay'),
          festivals: $('tibetanFestivals').checked,
          sagaDawaMonth: $('tibetanSagaDawa').checked,
        });
        return {
          dates: observances.map((x) => x.date),
          notes: new Map(observances.map((x) => [B.dateKey(x.date), x.reasons])),
          showTibetan: true,
        };
      }
      case 'monthly':
        return { dates: B.datesByMonthlyDay(startYear, endYear, intValue('monthDay', '日期')) };
      case 'quarter':
        return { dates: B.datesByQuarter(startYear, endYear, $('quarterWhich').value) };
      case 'weekday':
        return {
          dates: B.datesByWeekdayRule(startYear, endYear, Number($('weekdayMonth').value),
            Number($('weekdayDay').value), $('weekdayWhich').value),
        };
      default:
        throw new Error('未知的规则');
    }
  }

  function buildEvents() {
    const base = readOptions();
    const { dates, notes, showTibetan = false } = computeRule(base);
    const options = { ...base, notes, showTibetan };
    return { options, events: B.uniqueSortedDates(dates).map((date) => B.buildEvent(date, options)) };
  }

  // ---------- 输出 ----------

  function showError(message) {
    $('error').textContent = message;
    $('error').hidden = !message;
  }

  function run(action) {
    showError('');
    try {
      action();
      saveSettings();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  function renderPreview({ options, events }) {
    const tz = options.place.timezone;
    const tibetan = options.showTibetan;
    $('calendarHeader').textContent = tibetan ? '藏历' : '农历';
    $('notesHeader').hidden = !tibetan;
    const body = $('previewBody');
    const rows = events.map((e) => {
      const tr = document.createElement('tr');
      const cells = [
        B.dateKey(e.date), B.WEEKDAY_NAMES[B.weekdayOf(e.date)],
        tibetan ? B.tibetanLabel(B.tibetanOf(e.date)) : B.lunarLabel(B.lunarOf(e.date)),
        B.formatLocalTime(e.times.sunrise, tz), B.formatLocalTime(e.times.noon, tz), B.formatLocalTime(e.times.sunset, tz),
      ];
      if (tibetan) cells.push((options.notes.get(B.dateKey(e.date)) || []).join('；'));
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === 6) td.className = 'notes';
        tr.append(td);
      });
      return tr;
    });
    body.replaceChildren(...rows);
    $('summary').textContent = `共 ${events.length} 天 · ${options.place.name}（${tz}）`;
    $('results').hidden = false;
  }

  function download({ options, events }) {
    if (events.length === 0) throw new Error('没有符合规则的日期');
    const ics = B.eventsToIcs(events);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bgzj_${options.startYear}-${options.endYear}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- 事件绑定 ----------

  $('rule').addEventListener('change', updateRuleInputs);
  $('lunarType').addEventListener('change', updateRuleInputs);
  $('noonReminder').addEventListener('change', updateRuleInputs);

  $('previewButton').addEventListener('click', () => run(() => renderPreview(buildEvents())));

  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    run(() => {
      const result = buildEvents();
      renderPreview(result);
      download(result);
    });
  });

  $('resetLocation').addEventListener('click', () => {
    setPlace(B.AUCKLAND_BRITOMART);
    saveSettings();
  });

  $('useLocation').addEventListener('click', () => {
    showError('');
    if (!navigator.geolocation) {
      showError('当前浏览器不支持定位');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace({
          name: '当前位置',
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        saveSettings();
      },
      (err) => showError(`无法获取位置：${err.message}`),
      { enableHighAccuracy: false, timeout: 15000 },
    );
  });

  restoreSettings();
  updateRuleInputs();
})();
