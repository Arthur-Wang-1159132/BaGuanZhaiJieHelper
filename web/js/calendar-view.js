// 月历控件：每个格子显示公历、农历、藏历和殊胜日标记，点击加入/移出手动选择列表，并显示当天详情
const CalendarView = (() => {
  'use strict';

  const B = BGZJ;
  const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
  const MIN_YEAR = 1901;
  const MAX_YEAR = 2099;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function todayDate() {
    const now = new Date();
    return B.ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  class CalendarView {
    /**
     * @param {object} options
     * @param {HTMLElement} options.root 放日历的容器
     * @param {HTMLElement} options.detail 放当天详情的容器
     * @param {(key: string) => boolean} options.isSelected
     * @param {(key: string) => boolean} options.isRuleDate 下拉规则生成的日期，用虚线框标出
     * @param {(key: string) => void} options.onToggle 点击日期时调用
     * @param {() => object|null} options.getPlace 当前地点，无效时返回 null（不显示太阳时间）
     */
    constructor(options) {
      Object.assign(this, options);
      const today = todayDate();
      this.year = today.y;
      this.month = today.m;
      this.focused = null;
      this.build();
    }

    build() {
      const nav = el('div', 'cal-nav');
      this.prevButton = el('button', 'cal-step', '‹');
      this.prevButton.type = 'button';
      this.prevButton.setAttribute('aria-label', '上个月');
      this.nextButton = el('button', 'cal-step', '›');
      this.nextButton.type = 'button';
      this.nextButton.setAttribute('aria-label', '下个月');

      this.yearSelect = el('select', 'cal-year');
      this.yearSelect.setAttribute('aria-label', '年');
      for (let y = MIN_YEAR; y <= MAX_YEAR; y++) this.yearSelect.add(new Option(`${y} 年`, String(y)));
      this.monthSelect = el('select', 'cal-month');
      this.monthSelect.setAttribute('aria-label', '月');
      for (let m = 1; m <= 12; m++) this.monthSelect.add(new Option(`${m} 月`, String(m)));

      const todayButton = el('button', 'link', '今天');
      todayButton.type = 'button';

      const picker = el('div', 'cal-picker');
      picker.append(this.yearSelect, this.monthSelect);
      nav.append(this.prevButton, picker, this.nextButton, todayButton);

      const head = el('div', 'cal-grid cal-head');
      for (const name of WEEK_HEADERS) head.append(el('div', 'cal-weekday', name));
      this.grid = el('div', 'cal-grid');
      this.grid.setAttribute('role', 'grid');

      this.root.replaceChildren(nav, head, this.grid);

      this.prevButton.addEventListener('click', () => this.step(-1));
      this.nextButton.addEventListener('click', () => this.step(1));
      todayButton.addEventListener('click', () => {
        const today = todayDate();
        this.show(today.y, today.m);
        this.focus(today);
      });
      this.yearSelect.addEventListener('change', () => this.show(Number(this.yearSelect.value), this.month));
      this.monthSelect.addEventListener('change', () => this.show(this.year, Number(this.monthSelect.value)));
      this.grid.addEventListener('click', (event) => {
        const cell = event.target.closest('[data-date]');
        if (!cell) return;
        const date = B.parseDateKey(cell.dataset.date);
        this.onToggle(cell.dataset.date);
        this.focused = date;
        if (date.m !== this.month) this.show(date.y, date.m);
        else this.refresh();
        this.grid.querySelector(`[data-date="${cell.dataset.date}"]`)?.focus();
      });
    }

    step(delta) {
      let { year, month } = this;
      month += delta;
      if (month < 1) { month = 12; year -= 1; }
      if (month > 12) { month = 1; year += 1; }
      if (year >= MIN_YEAR && year <= MAX_YEAR) this.show(year, month);
    }

    show(year, month) {
      this.year = year;
      this.month = month;
      this.refresh();
    }

    /** 重新绘制当前月（选择或规则变化后调用） */
    refresh() {
      const { year, month } = this;
      this.yearSelect.value = String(year);
      this.monthSelect.value = String(month);
      this.prevButton.disabled = year === MIN_YEAR && month === 1;
      this.nextButton.disabled = year === MAX_YEAR && month === 12;

      // 6 周 42 天，从星期一开始
      const first = B.ymd(year, month, 1);
      const start = B.addDays(first, -B.weekdayOf(first));
      const end = B.addDays(start, 41);
      const holyDays = B.holyDaysInRange(start, end);
      const todayKey = B.dateKey(todayDate());

      const cells = [];
      for (let i = 0; i < 42; i++) {
        const date = B.addDays(start, i);
        const key = B.dateKey(date);
        cells.push(this.renderCell(date, key, holyDays.get(key) || [], key === todayKey));
      }
      this.grid.replaceChildren(...cells);
      if (this.focused) this.renderDetail(this.focused);
    }

    renderCell(date, key, items, isToday) {
      const cell = el('button', 'cal-day');
      cell.type = 'button';
      cell.dataset.date = key;
      const selected = this.isSelected(key);
      cell.setAttribute('aria-pressed', String(selected));
      cell.classList.toggle('other-month', date.m !== this.month);
      cell.classList.toggle('today', isToday);
      cell.classList.toggle('selected', selected);
      cell.classList.toggle('rule', this.isRuleDate(key));
      cell.classList.toggle('saga-dawa', items.some((x) => x.kind === 'month'));
      cell.classList.toggle('focused', this.focused !== null && B.dateKey(this.focused) === key);

      const lunar = B.lunarOf(date);
      const tibetan = B.tibetanOf(date);
      const hanFestival = items.find((x) => x.tradition === 'han' && x.kind === 'festival');
      const tibetanFestival = items.find((x) => x.tradition === 'tibetan' && x.kind === 'festival');
      const fast = B.isFastDay(items);

      const top = el('span', 'cal-top');
      top.append(el('span', 'cal-num', String(date.d)));
      if (fast) top.append(el('span', 'cal-fast', '斋'));
      const lunarLine = el('span', `cal-line${hanFestival ? ' festival' : ''}`, hanFestival ? hanFestival.short : B.lunarShortLabel(lunar));
      const tibetanLine = el('span', `cal-line tib${tibetanFestival ? ' festival' : ''}`,
        tibetanFestival ? tibetanFestival.short : `藏${B.tibetanShortLabel(tibetan)}`);
      cell.append(top, lunarLine, tibetanLine);

      const names = items.filter((x) => x.kind !== 'month' || items.length === 1).map((x) => x.name);
      cell.setAttribute('aria-label', [
        `${date.y}年${date.m}月${date.d}日`, `农历${B.lunarLabel(lunar)}`, `藏历${B.tibetanLabel(tibetan)}`,
        ...names, selected ? '已选' : '',
      ].filter(Boolean).join('，'));
      return cell;
    }

    focus(date) {
      this.focused = date;
      for (const cell of this.grid.querySelectorAll('.cal-day')) cell.classList.toggle('focused', cell.dataset.date === B.dateKey(date));
      this.renderDetail(date);
    }

    renderDetail(date) {
      const key = B.dateKey(date);
      const items = B.holyDaysInRange(date, date).get(key) || [];
      const selected = this.isSelected(key);

      const head = el('div', 'detail-head');
      const title = el('h3', null, `${date.y}年${date.m}月${date.d}日 ${B.WEEKDAY_NAMES[B.weekdayOf(date)]}`);
      const toggle = el('button', selected ? 'secondary small' : 'primary small', selected ? '移出列表' : '加入列表');
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        this.onToggle(key);
        this.refresh();
      });
      head.append(title, toggle);

      const facts = el('dl', 'detail-facts');
      const addFact = (label, value) => {
        facts.append(el('dt', null, label), el('dd', null, value));
      };
      addFact('农历', B.lunarLabel(B.lunarOf(date)));
      addFact('藏历', B.tibetanLabel(B.tibetanOf(date)));
      const place = this.getPlace();
      if (place) {
        try {
          const t = B.getSunTimes(place, date);
          const fmt = (ms) => B.formatLocalTime(ms, place.timezone);
          addFact('太阳', `日出 ${fmt(t.sunrise)} · 日中 ${fmt(t.noon)} · 日落 ${fmt(t.sunset)}`);
        } catch (e) {
          addFact('太阳', e.message);
        }
      }

      const nodes = [head, facts];
      if (items.length) {
        if (B.isFastDay(items)) nodes.push(el('p', 'detail-advice', '建议：此日适合受持八关斋戒'));
        const list = el('ul', 'detail-items');
        for (const x of items) {
          const li = el('li', `tradition-${x.tradition}`);
          li.append(el('span', 'tag', x.tradition === 'han' ? '汉传' : '藏传'), el('strong', null, x.text), el('span', 'hint', x.suggestion));
          list.append(li);
        }
        nodes.push(list);
      } else {
        nodes.push(el('p', 'hint', '此日不是常见的佛教殊胜日。'));
      }
      this.detail.replaceChildren(...nodes);
      this.detail.hidden = false;
    }
  }

  return CalendarView;
})();
