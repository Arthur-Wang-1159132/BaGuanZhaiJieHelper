// 页面交互：读取表单、月历选择、预览、下载 .ics
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
    'tibetanFestivals', 'tibetanSagaDawa', 'includeRule', 'includeManual',
    'startYear', 'endYear', 'placeName', 'latitude', 'longitude', 'timezone', 'noonReminder', 'noonMinutes'];
  // 多选框组：保存为选中值的数组
  const checkboxGroups = ['reminder', 'tibetanDay'];
  const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => x.value);

  /** 在月历上手动选择的日期（dateKey） */
  const picked = new Set();
  /** 当前规则生成的日期，用于在月历上标出 */
  let ruleDateKeys = new Set();

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
    data.picked = [...picked];
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
    if (Array.isArray(data.picked)) {
      for (const key of data.picked) if (/^\d{4}-\d{2}-\d{2}$/.test(key)) picked.add(key);
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

  function readYears() {
    const startYear = intValue('startYear', '开始年份');
    const endYear = intValue('endYear', '结束年份');
    if (startYear < 1901 || endYear > 2099) throw new Error('年份必须在 1901-2099 之间');
    if (startYear > endYear) throw new Error('开始年份不能晚于结束年份');
    if (endYear - startYear + 1 > MAX_YEARS) throw new Error(`一次最多生成 ${MAX_YEARS} 年`);
    return { startYear, endYear };
  }

  function readPlace() {
    const place = {
      name: $('placeName').value.trim() || '自定义地点',
      latitude: numberValue('latitude', '纬度'),
      longitude: numberValue('longitude', '经度'),
      timezone: $('timezone').value.trim(),
    };
    if (place.latitude < -90 || place.latitude > 90) throw new Error('纬度必须在 -90 到 90 之间');
    if (place.longitude < -180 || place.longitude > 180) throw new Error('经度必须在 -180 到 180 之间');
    if (!B.isValidTimezone(place.timezone)) throw new Error(`时区无效：${place.timezone || '(空)'}`);
    return place;
  }

  function readReminders() {
    let noonReminderMinutes = null;
    if ($('noonReminder').checked) {
      noonReminderMinutes = intValue('noonMinutes', '日中提醒分钟数');
      if (noonReminderMinutes < 0) throw new Error('日中提醒分钟数不能为负数');
    }
    return { reminderHours: checkedValues('reminder').map(Number), noonReminderMinutes };
  }

  /** 按下拉框所选规则计算日期 */
  function computeRuleDates() {
    const { startYear, endYear } = readYears();
    switch ($('rule').value) {
      case 'lunar':
        return B.datesByLunarFastDays(startYear, endYear, $('lunarType').value);
      case 'tibetan':
        return B.tibetanObservances(startYear, endYear, {
          monthlyDays: checkedValues('tibetanDay'),
          festivals: $('tibetanFestivals').checked,
          sagaDawaMonth: $('tibetanSagaDawa').checked,
        }).map((x) => x.date);
      case 'monthly':
        return B.datesByMonthlyDay(startYear, endYear, intValue('monthDay', '日期'));
      case 'quarter':
        return B.datesByQuarter(startYear, endYear, $('quarterWhich').value);
      case 'weekday':
        return B.datesByWeekdayRule(startYear, endYear, Number($('weekdayMonth').value),
          Number($('weekdayDay').value), $('weekdayWhich').value);
      default:
        throw new Error('未知的规则');
    }
  }

  /** 合并规则日期与手动选择的日期，每个日期附上殊胜日说明 */
  function buildEvents() {
    const includeRule = $('includeRule').checked;
    const includeManual = $('includeManual').checked;
    if (!includeRule && !includeManual) throw new Error('请在「生成内容」中至少勾选一项');

    const dates = [
      ...(includeRule ? computeRuleDates() : []),
      ...(includeManual ? [...picked].map(B.parseDateKey) : []),
    ];
    const sorted = B.uniqueSortedDates(dates);
    if (sorted.length === 0) throw new Error(includeManual && !includeRule ? '还没有在日历上选择日期' : '没有符合规则的日期');

    const holyDays = B.holyDaysInRange(sorted[0], sorted.at(-1));
    const notes = new Map(sorted.map((d) => [B.dateKey(d), (holyDays.get(B.dateKey(d)) || []).map((x) => x.text)]));
    const options = { place: readPlace(), ...readReminders(), notes, showTibetan: true };
    return { options, events: sorted.map((date) => B.buildEvent(date, options)) };
  }

  // ---------- 月历与已选列表 ----------

  function currentPlaceOrNull() {
    try {
      return readPlace();
    } catch (e) {
      return null;
    }
  }

  const calendarView = new CalendarView({
    root: $('calendar'),
    detail: $('dayDetail'),
    isSelected: (key) => picked.has(key),
    isRuleDate: (key) => ruleDateKeys.has(key),
    onToggle: (key) => {
      if (picked.has(key)) picked.delete(key);
      else picked.add(key);
      renderPicked();
      saveSettings();
    },
    getPlace: currentPlaceOrNull,
  });

  function renderPicked() {
    const keys = [...picked].sort();
    $('pickedCount').textContent = String(keys.length);
    $('pickedEmpty').hidden = keys.length > 0;
    $('clearPicked').hidden = keys.length === 0;
    if (keys.length === 0) {
      $('pickedList').replaceChildren();
      return;
    }
    const holyDays = B.holyDaysInRange(B.parseDateKey(keys[0]), B.parseDateKey(keys.at(-1)));
    $('pickedList').replaceChildren(...keys.map((key) => {
      const date = B.parseDateKey(key);
      const li = document.createElement('li');

      const label = document.createElement('span');
      label.className = 'picked-date';
      label.textContent = `${key} ${B.WEEKDAY_NAMES[B.weekdayOf(date)]}`;
      label.title = '在日历中查看';
      label.addEventListener('click', () => {
        calendarView.show(date.y, date.m);
        calendarView.focus(date);
      });

      const info = document.createElement('span');
      info.className = 'picked-info';
      const names = (holyDays.get(key) || []).filter((x) => x.kind !== 'month').map((x) => x.short || x.name);
      info.textContent = [`农历${B.lunarLabel(B.lunarOf(date))}`, `藏历${B.tibetanLabel(B.tibetanOf(date))}`, ...names].join(' · ');

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `移除 ${key}`);
      remove.addEventListener('click', () => {
        picked.delete(key);
        renderPicked();
        calendarView.refresh();
        saveSettings();
      });

      li.append(label, info, remove);
      return li;
    }));
  }

  /** 规则变化后重新计算规则日期并在月历上标出；输入不完整时不标 */
  function refreshRuleDates() {
    try {
      ruleDateKeys = $('includeRule').checked ? new Set(computeRuleDates().map(B.dateKey)) : new Set();
    } catch (e) {
      ruleDateKeys = new Set();
    }
    calendarView.refresh();
  }

  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshRuleDates, 200);
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
    const body = $('previewBody');
    const rows = events.map((e) => {
      const tr = document.createElement('tr');
      const key = B.dateKey(e.date);
      const cells = [
        key, B.WEEKDAY_NAMES[B.weekdayOf(e.date)],
        B.lunarLabel(B.lunarOf(e.date)), B.tibetanLabel(B.tibetanOf(e.date)),
        B.formatLocalTime(e.times.sunrise, tz), B.formatLocalTime(e.times.noon, tz), B.formatLocalTime(e.times.sunset, tz),
        (options.notes.get(key) || []).join('；'),
      ];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === cells.length - 1) td.className = 'notes';
        tr.append(td);
      });
      return tr;
    });
    body.replaceChildren(...rows);
    $('summary').textContent = `共 ${events.length} 天 · ${options.place.name}（${tz}）`;
    $('results').hidden = false;
  }

  function download({ events }) {
    const ics = B.eventsToIcs(events);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bgzj_${B.dateKey(events[0].date)}_${B.dateKey(events.at(-1).date)}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- 事件绑定 ----------

  $('rule').addEventListener('change', updateRuleInputs);
  $('lunarType').addEventListener('change', updateRuleInputs);
  $('noonReminder').addEventListener('change', updateRuleInputs);

  // 规则或年份变化时更新月历上的规则日期；地点变化时更新详情中的太阳时间
  $('form').addEventListener('change', (event) => {
    if (event.target.closest('#calendar')) return;
    scheduleRefresh();
    saveSettings();
  });
  $('form').addEventListener('input', (event) => {
    if (['startYear', 'endYear', 'monthDay'].includes(event.target.id)) scheduleRefresh();
  });

  $('clearPicked').addEventListener('click', () => {
    if (picked.size > 1 && !window.confirm(`确定清空已选的 ${picked.size} 个日期吗？`)) return;
    picked.clear();
    renderPicked();
    calendarView.refresh();
    saveSettings();
  });

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
    calendarView.refresh();
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
        calendarView.refresh();
      },
      (err) => showError(`无法获取位置：${err.message}`),
      { enableHighAccuracy: false, timeout: 15000 },
    );
  });

  restoreSettings();
  updateRuleInputs();
  renderPicked();
  refreshRuleDates();
})();
