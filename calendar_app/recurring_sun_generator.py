import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pytz
from astral import LocationInfo
from astral.sun import sun
from ics import Calendar, DisplayAlarm, Event
from lunardate import LunarDate


@dataclass(frozen=True)
class Place:
    """计算太阳时间所用的地点"""
    name: str
    latitude: float
    longitude: float
    timezone: str = 'Pacific/Auckland'


# 默认地点：Auckland Britomart Train Station
AUCKLAND_BRITOMART = Place("Auckland Britomart Train Station", -36.8440526109716, 174.7675260738167)

# 每月的第几个星期几，"last" 表示最后一个
WEEK_ORDINALS = {'first': 0, 'second': 1, 'third': 2, 'fourth': 3, 'last': -1}

LUNAR_FAST_TYPES = ('two', 'six', 'ten')

LUNAR_MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']
LUNAR_DAY_NAMES = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
]


def lunar_label(lunar: LunarDate):
    """农历日期的中文写法，例如 "正月初八"、"闰六月初一" """
    leap = "闰" if lunar.isLeapMonth else ""
    return f"{leap}{LUNAR_MONTH_NAMES[lunar.month - 1]}{LUNAR_DAY_NAMES[lunar.day - 1]}"


def to_dms(value, positive, negative):
    """十进制度数转为度分秒字符串，例如 -36.844 -> 36°50'38.6"S"""
    hemisphere = positive if value >= 0 else negative
    value = abs(value)
    degrees = int(value)
    minutes_float = (value - degrees) * 60
    minutes = int(minutes_float)
    seconds = (minutes_float - minutes) * 60
    return f"{degrees}°{minutes:02d}'{seconds:04.1f}\"{hemisphere}"


def lunar_month_length(lunar: LunarDate):
    """返回农历月的天数（29 或 30）"""
    try:
        LunarDate(lunar.year, lunar.month, 30, lunar.isLeapMonth).to_solar_date()
        return 30
    except ValueError:
        return 29


def lunar_fast_days(fast_type, month_length):
    """返回某个农历月中的斋日

    朔望斋：初一、十五
    六斋日：初八、十四、十五、廿三、廿九、三十（小月为廿八、廿九）
    十斋日：初一、初八、十四、十五、十八、廿三、廿四、廿八、廿九、三十（小月为廿七、廿八、廿九）
    """
    last = month_length
    if fast_type == 'two':
        return {1, 15}
    if fast_type == 'six':
        return {8, 14, 15, 23, last - 1, last}
    if fast_type == 'ten':
        return {1, 8, 14, 15, 18, 23, 24, last - 2, last - 1, last}
    raise ValueError(f"fast_type 只支持 {LUNAR_FAST_TYPES}")


class RecurringSunEventGenerator:
    """
    根据重复规则生成日历信息，可以存储到手机，提前提醒。

    每个事件从当日日出开始，到次日日出结束，描述中包含日出、日中、日落时间。
    dates_by_* 方法只返回日期，generate_by_* 方法把这些日期加入日历。
    """

    def __init__(self, start_year, end_year, place=AUCKLAND_BRITOMART,
                 reminder_hours=(24, 12, 1), noon_reminder_minutes=30):
        """
        Args:
            start_year (int): 开始年份
            end_year (int): 结束年份（包含）
            place (Place): 计算太阳时间的地点
            reminder_hours (iterable): 在日出前多少小时提醒
            noon_reminder_minutes (int | None): 在日中前多少分钟提醒（过午不食），None 表示不提醒
        """
        if start_year > end_year:
            raise ValueError("开始年份不能晚于结束年份")
        self.start_year = start_year
        self.end_year = end_year
        self.place = place
        self.timezone = pytz.timezone(place.timezone)
        self.location = LocationInfo(place.name, "", place.timezone, place.latitude, place.longitude)
        self.reminder_hours = tuple(reminder_hours)
        self.noon_reminder_minutes = noon_reminder_minutes
        self.dates = set()

    def _years(self):
        return range(self.start_year, self.end_year + 1)

    def get_sun_times(self, day: date):
        """返回某天的日出、日中、日落以及次日日出时间（本地时区）"""
        try:
            s = sun(self.location.observer, date=day, tzinfo=self.timezone)
            s2 = sun(self.location.observer, date=day + timedelta(days=1), tzinfo=self.timezone)
        except ValueError as e:
            # 极地附近可能出现极昼或极夜
            raise ValueError(f"{day} 在 {self.place.name} 无法计算日出日落: {e}") from e
        return {
            "sunrise": s["sunrise"],
            "noon": s["noon"],
            "sunset": s["sunset"],
            "next_sunrise": s2["sunrise"],
        }

    def _build_event(self, day: date):
        times = self.get_sun_times(day)
        duration = times["next_sunrise"] - times["sunrise"]
        hours, remainder = divmod(int(duration.total_seconds()) // 60, 60)
        lat = to_dms(self.place.latitude, "N", "S")
        lon = to_dms(self.place.longitude, "E", "W")
        lunar = LunarDate.from_solar_date(day.year, day.month, day.day)

        e = Event()
        e.uid = f"bgzj-{day:%Y%m%d}@baguanzhaijie"
        e.name = "太阳时间提醒"
        e.begin = times["sunrise"]
        e.end = times["next_sunrise"]
        e.description = (
            f"农历: {lunar_label(lunar)}\n"
            f"日出: {times['sunrise']:%H:%M}\n"
            f"日中: {times['noon']:%H:%M}\n"
            f"日落: {times['sunset']:%H:%M}\n"
            f"明日日出: {times['next_sunrise']:%H:%M}\n"
            f"总时长: {hours:02d}:{remainder:02d}\n"
            f"注：由于不同经纬度以及海拔会导致时间有略微差异, 但几乎都在+-1分钟之内\n"
            f"本次时间使用的是{self.place.name}（{lat} {lon}）的时间\n"
        )

        for hours_before in self.reminder_hours:
            e.alarms.append(DisplayAlarm(trigger=timedelta(hours=-hours_before), display_text=e.name))
        if self.noon_reminder_minutes is not None:
            noon_alarm = times["noon"] - timedelta(minutes=self.noon_reminder_minutes)
            e.alarms.append(DisplayAlarm(trigger=noon_alarm, display_text=f"日中 {times['noon']:%H:%M}，过午不食"))
        return e

    # ---------- 日期规则 ----------

    def dates_by_monthly_day(self, day=1, months=range(1, 13)):
        """每月的第几天，不存在的日期（如 2月30日）会被跳过"""
        if not 1 <= day <= 31:
            raise ValueError("日期必须在 1-31 之间")
        result = []
        for year in self._years():
            for month in months:
                if day <= calendar.monthrange(year, month)[1]:
                    result.append(date(year, month, day))
        return result

    def dates_by_quarter(self, which='first'):
        """每季度的第一天或最后一天"""
        if which not in ('first', 'last'):
            raise ValueError("which 只支持 'first' 或 'last'")
        result = []
        for year in self._years():
            for start_month in (1, 4, 7, 10):
                if which == 'first':
                    result.append(date(year, start_month, 1))
                else:
                    end_month = start_month + 2
                    result.append(date(year, end_month, calendar.monthrange(year, end_month)[1]))
        return result

    def dates_by_weekday_rule(self, month, weekday, which='last'):
        """某月的第几个星期几

        Args:
            month (int): 月份 1-12
            weekday (int): 星期几，0=星期一 ... 6=星期日
            which (str): first/second/third/fourth/last
        """
        if not 1 <= month <= 12:
            raise ValueError("月份必须在 1-12 之间")
        if not 0 <= weekday <= 6:
            raise ValueError("星期必须在 0-6 之间")
        if which not in WEEK_ORDINALS:
            raise ValueError(f"which 只支持 {list(WEEK_ORDINALS)}")
        result = []
        for year in self._years():
            days = [week[weekday] for week in calendar.monthcalendar(year, month) if week[weekday] != 0]
            result.append(date(year, month, days[WEEK_ORDINALS[which]]))
        return result

    def dates_by_lunar_fast_days(self, fast_type='six'):
        """农历六斋日或十斋日（闰月同样计算）"""
        if fast_type not in LUNAR_FAST_TYPES:
            raise ValueError(f"fast_type 只支持 {LUNAR_FAST_TYPES}")
        result = []
        day = date(self.start_year, 1, 1)
        end = date(self.end_year, 12, 31)
        while day <= end:
            lunar = LunarDate.from_solar_date(day.year, day.month, day.day)
            if lunar.day in lunar_fast_days(fast_type, lunar_month_length(lunar)):
                result.append(day)
            day += timedelta(days=1)
        return result

    # ---------- 加入日历 ----------

    def add_dates(self, dates):
        self.dates.update(dates)

    def generate_by_monthly_day(self, day=1, months=range(1, 13)):
        self.add_dates(self.dates_by_monthly_day(day, months))

    def generate_by_quarter(self, which='first'):
        self.add_dates(self.dates_by_quarter(which))

    def generate_by_weekday_rule(self, month, weekday, which='last'):
        self.add_dates(self.dates_by_weekday_rule(month, weekday, which))

    def generate_by_lunar_fast_days(self, fast_type='six'):
        self.add_dates(self.dates_by_lunar_fast_days(fast_type))

    def build_calendar(self):
        return Calendar(events=[self._build_event(d) for d in sorted(self.dates)])

    def save_to_ics(self, filename):
        cal = self.build_calendar()
        with open(filename, 'w', encoding='utf-8') as f:
            f.writelines(cal.serialize_iter())
        return len(cal.events)
