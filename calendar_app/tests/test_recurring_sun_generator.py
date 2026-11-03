import os
import sys
from datetime import date, datetime

import pytest
from lunardate import LunarDate

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from recurring_sun_generator import RecurringSunEventGenerator, lunar_fast_days, to_dms  # noqa: E402


def make(start=2026, end=2026, **kwargs):
    return RecurringSunEventGenerator(start, end, **kwargs)


def test_monthly_day_skips_missing_dates():
    dates = make().dates_by_monthly_day(31)
    assert len(dates) == 7
    assert date(2026, 2, 28) not in dates


def test_quarter_last_includes_every_quarter():
    assert make().dates_by_quarter('last') == [
        date(2026, 3, 31), date(2026, 6, 30), date(2026, 9, 30), date(2026, 12, 31)
    ]


def test_quarter_first():
    assert make().dates_by_quarter('first') == [
        date(2026, 1, 1), date(2026, 4, 1), date(2026, 7, 1), date(2026, 10, 1)
    ]


def test_weekday_rule():
    gen = make()
    assert gen.dates_by_weekday_rule(6, 6, 'last') == [date(2026, 6, 28)]
    assert gen.dates_by_weekday_rule(6, 6, 'first') == [date(2026, 6, 7)]
    assert gen.dates_by_weekday_rule(6, 6, 'second') == [date(2026, 6, 14)]


def test_lunar_fast_days_rule():
    assert lunar_fast_days('six', 30) == {8, 14, 15, 23, 29, 30}
    assert lunar_fast_days('six', 29) == {8, 14, 15, 23, 28, 29}
    assert lunar_fast_days('ten', 29) == {1, 8, 14, 15, 18, 23, 24, 27, 28, 29}


def test_lunar_six_fast_days():
    dates = make().dates_by_lunar_fast_days('six')
    assert len(dates) == len(set(dates))
    # 2026 年正月初八
    assert date(2026, 2, 24) in dates
    for d in dates:
        assert LunarDate.from_solar_date(d.year, d.month, d.day).day in {8, 14, 15, 23, 28, 29, 30}
    # 每个农历月 6 天，一年约 12-13 个月
    assert 70 <= len(dates) <= 80


def test_lunar_ten_fast_days_is_superset_of_six():
    gen = make()
    assert set(gen.dates_by_lunar_fast_days('six')) <= set(gen.dates_by_lunar_fast_days('ten'))


def test_sun_times_are_local_and_ordered():
    times = make().get_sun_times(date(2026, 6, 21))
    sunrise = times['sunrise']
    assert sunrise.date() == date(2026, 6, 21)
    assert sunrise.utcoffset().total_seconds() == 12 * 3600
    # 奥克兰冬至日出约 07:33
    assert datetime(2026, 6, 21, 7, 25) <= sunrise.replace(tzinfo=None) <= datetime(2026, 6, 21, 7, 40)
    assert times['sunrise'] < times['noon'] < times['sunset'] < times['next_sunrise']


def test_event_and_ics_output(tmp_path):
    gen = make()
    gen.generate_by_monthly_day(1)
    gen.generate_by_quarter('first')  # 与每月 1 号重复，应去重
    path = tmp_path / 'out.ics'
    assert gen.save_to_ics(path) == 12
    text = path.read_text(encoding='utf-8')
    assert 'UID:bgzj-20260101@baguanzhaijie' in text
    assert '过午不食' in text
    assert '农历: 冬月十三' in text
    assert text.count('BEGIN:VALARM') == 12 * 4


def test_no_noon_reminder():
    gen = make(noon_reminder_minutes=None)
    gen.add_dates([date(2026, 1, 1)])
    event = next(iter(gen.build_calendar().events))
    assert len(event.alarms) == 3


def test_to_dms():
    assert to_dms(-36.8440526109716, 'N', 'S') == '36°50\'38.6"S'
    assert to_dms(174.7675260738167, 'E', 'W') == '174°46\'03.1"E'


def test_invalid_input():
    with pytest.raises(ValueError):
        make(2027, 2026)
    with pytest.raises(ValueError):
        make().dates_by_monthly_day(32)
    with pytest.raises(ValueError):
        make().dates_by_lunar_fast_days('seven')
