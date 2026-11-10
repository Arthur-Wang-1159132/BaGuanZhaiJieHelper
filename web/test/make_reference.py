"""用 Python 版本（calendar_app）生成参考数据，供 compare.js 校验 JS 版本

用法（在仓库根目录）:
    .venv/Scripts/python web/test/make_reference.py > reference.json
"""
import json
import os
import sys
from datetime import date, timedelta, timezone

from lunardate import LunarDate

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'calendar_app'))

from recurring_sun_generator import AUCKLAND_BRITOMART, Place, RecurringSunEventGenerator  # noqa: E402

PLACES = [
    AUCKLAND_BRITOMART,
    Place("Shanghai", 31.2304, 121.4737, "Asia/Shanghai"),
    Place("London", 51.5072, -0.1276, "Europe/London"),
    Place("New York", 40.7128, -74.0060, "America/New_York"),
    Place("Honolulu", 21.3069, -157.8583, "Pacific/Honolulu"),
    Place("Sydney", -33.8688, 151.2093, "Australia/Sydney"),
]


def utc(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def key(d):
    return d.isoformat()


def sun_reference():
    result = []
    for place in PLACES:
        gen = RecurringSunEventGenerator(2000, 2000, place=place)
        day = date(1995, 1, 1)
        while day <= date(2035, 12, 31):
            t = gen.get_sun_times(day)
            result.append({
                "place": place.name, "date": key(day),
                **{k: utc(v) for k, v in t.items()},
            })
            day += timedelta(days=5)
    return result


def lunar_reference():
    """1901-2098 每一天的农历日、月、是否闰月"""
    result = {}
    day = date(1901, 1, 1)
    while day <= date(2098, 12, 31):
        lunar = LunarDate.from_solar_date(day.year, day.month, day.day)
        result[key(day)] = [lunar.month, lunar.day, bool(lunar.isLeapMonth)]
        day += timedelta(days=1)
    return result


def rules_reference():
    gen = RecurringSunEventGenerator(2024, 2032)
    return {
        "lunar_two": [key(d) for d in gen.dates_by_lunar_fast_days('two')],
        "lunar_six": [key(d) for d in gen.dates_by_lunar_fast_days('six')],
        "lunar_ten": [key(d) for d in gen.dates_by_lunar_fast_days('ten')],
        "monthly_31": [key(d) for d in gen.dates_by_monthly_day(31)],
        "quarter_first": [key(d) for d in gen.dates_by_quarter('first')],
        "quarter_last": [key(d) for d in gen.dates_by_quarter('last')],
        "weekday_6_6_last": [key(d) for d in gen.dates_by_weekday_rule(6, 6, 'last')],
        "weekday_2_0_second": [key(d) for d in gen.dates_by_weekday_rule(2, 0, 'second')],
    }


if __name__ == '__main__':
    json.dump({"sun": sun_reference(), "lunar": lunar_reference(), "rules": rules_reference()}, sys.stdout)
