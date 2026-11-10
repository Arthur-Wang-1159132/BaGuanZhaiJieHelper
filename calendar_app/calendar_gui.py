import tkinter as tk
from tkinter import ttk, messagebox, filedialog

from recurring_sun_generator import AUCKLAND_BRITOMART, Place, RecurringSunEventGenerator, WEEK_ORDINALS

RULE_LUNAR = "农历斋日（六斋日/十斋日）"
RULE_MONTHLY = "每月的第几天"
RULE_QUARTER = "每季度（第一天或最后一天）"
RULE_WEEKDAY = "某月的第几个星期几"

LUNAR_TYPES = {"朔望斋（初一、十五）": "two", "六斋日": "six", "十斋日": "ten"}
QUARTER_DAYS = {"第一天": "first", "最后一天": "last"}
WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
ORDINAL_LABELS = dict(zip(["第一个", "第二个", "第三个", "第四个", "最后一个"], WEEK_ORDINALS))

PREVIEW_LIMIT = 30


class CalendarGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("太阳提醒日历生成器")

        self.create_widgets()

    def create_widgets(self):
        frame = ttk.Frame(self.root, padding=20)
        frame.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        frame.columnconfigure(1, weight=1)
        frame.rowconfigure(7, weight=1)

        # 年份设置
        ttk.Label(frame, text="开始年份:").grid(row=0, column=0, sticky="e")
        self.start_year = tk.IntVar(value=2026)
        ttk.Entry(frame, textvariable=self.start_year, width=6).grid(row=0, column=1, sticky="w")

        ttk.Label(frame, text="结束年份:").grid(row=0, column=2, sticky="e")
        self.end_year = tk.IntVar(value=2030)
        ttk.Entry(frame, textvariable=self.end_year, width=6).grid(row=0, column=3, sticky="w")

        # 规则选择
        ttk.Label(frame, text="重复规则:").grid(row=1, column=0, sticky="e")
        self.rule_type = tk.StringVar()
        self.rule_combo = ttk.Combobox(frame, textvariable=self.rule_type, width=28, state="readonly")
        self.rule_combo['values'] = [RULE_LUNAR, RULE_MONTHLY, RULE_QUARTER, RULE_WEEKDAY]
        self.rule_combo.current(0)
        self.rule_combo.grid(row=1, column=1, columnspan=3, sticky="w")

        # 规则参数输入
        self.param_frame = ttk.LabelFrame(frame, text="规则参数", padding=10)
        self.param_frame.grid(row=2, column=0, columnspan=4, pady=10, sticky="ew")
        self.update_rule_inputs()

        self.rule_combo.bind("<<ComboboxSelected>>", lambda e: self.update_rule_inputs())

        # 地点
        place_frame = ttk.LabelFrame(frame, text="地点", padding=10)
        place_frame.grid(row=3, column=0, columnspan=4, sticky="ew")
        self.place_name = tk.StringVar(value=AUCKLAND_BRITOMART.name)
        self.latitude = tk.DoubleVar(value=AUCKLAND_BRITOMART.latitude)
        self.longitude = tk.DoubleVar(value=AUCKLAND_BRITOMART.longitude)
        self.timezone = tk.StringVar(value=AUCKLAND_BRITOMART.timezone)
        ttk.Label(place_frame, text="名称:").grid(row=0, column=0, sticky="e")
        ttk.Entry(place_frame, textvariable=self.place_name, width=32).grid(row=0, column=1, columnspan=3, sticky="w")
        ttk.Label(place_frame, text="纬度 (南为负):").grid(row=1, column=0, sticky="e")
        ttk.Entry(place_frame, textvariable=self.latitude, width=12).grid(row=1, column=1, sticky="w")
        ttk.Label(place_frame, text="经度 (西为负):").grid(row=1, column=2, sticky="e")
        ttk.Entry(place_frame, textvariable=self.longitude, width=12).grid(row=1, column=3, sticky="w")
        ttk.Label(place_frame, text="时区:").grid(row=2, column=0, sticky="e")
        ttk.Entry(place_frame, textvariable=self.timezone, width=20).grid(row=2, column=1, columnspan=3, sticky="w")

        # 提醒
        reminder_frame = ttk.LabelFrame(frame, text="提醒", padding=10)
        reminder_frame.grid(row=4, column=0, columnspan=4, pady=10, sticky="ew")
        ttk.Label(reminder_frame, text="日出前提醒 24、12、1 小时").grid(row=0, column=0, columnspan=3, sticky="w")
        self.noon_reminder = tk.BooleanVar(value=True)
        self.noon_minutes = tk.IntVar(value=30)
        ttk.Checkbutton(reminder_frame, text="日中前提醒（过午不食），提前分钟:",
                        variable=self.noon_reminder).grid(row=1, column=0, sticky="w")
        ttk.Entry(reminder_frame, textvariable=self.noon_minutes, width=5).grid(row=1, column=1, sticky="w")

        # 保存
        self.filename = tk.StringVar(value="sun_events.ics")
        ttk.Label(frame, text="保存为:").grid(row=5, column=0, sticky="e")
        ttk.Entry(frame, textvariable=self.filename, width=30).grid(row=5, column=1, columnspan=2, sticky="ew")
        ttk.Button(frame, text="选择文件...", command=self.choose_file).grid(row=5, column=3)

        button_frame = ttk.Frame(frame)
        button_frame.grid(row=6, column=0, columnspan=4, pady=10)
        ttk.Button(button_frame, text="预览日期", command=self.preview).grid(row=0, column=0, padx=5)
        ttk.Button(button_frame, text="生成 .ics 日历", command=self.generate_calendar).grid(row=0, column=1, padx=5)

        # 预览
        self.preview_list = tk.Listbox(frame, height=10)
        self.preview_list.grid(row=7, column=0, columnspan=4, sticky="nsew")

    def update_rule_inputs(self):
        for widget in self.param_frame.winfo_children():
            widget.destroy()

        rule = self.rule_type.get()
        if rule == RULE_LUNAR:
            ttk.Label(self.param_frame, text="斋日:").grid(row=0, column=0)
            self.lunar_var = tk.StringVar(value="六斋日")
            ttk.Combobox(self.param_frame, textvariable=self.lunar_var, values=list(LUNAR_TYPES),
                         width=10, state="readonly").grid(row=0, column=1)
        elif rule == RULE_MONTHLY:
            ttk.Label(self.param_frame, text="日 (1-31):").grid(row=0, column=0)
            self.day_var = tk.IntVar(value=1)
            ttk.Entry(self.param_frame, textvariable=self.day_var, width=5).grid(row=0, column=1)
        elif rule == RULE_QUARTER:
            ttk.Label(self.param_frame, text="哪一天:").grid(row=0, column=0)
            self.quarter_var = tk.StringVar(value="第一天")
            ttk.Combobox(self.param_frame, textvariable=self.quarter_var, values=list(QUARTER_DAYS),
                         width=10, state="readonly").grid(row=0, column=1)
        elif rule == RULE_WEEKDAY:
            ttk.Label(self.param_frame, text="月份 (1-12):").grid(row=0, column=0)
            self.month_var = tk.IntVar(value=6)
            ttk.Entry(self.param_frame, textvariable=self.month_var, width=5).grid(row=0, column=1)

            ttk.Label(self.param_frame, text="第几个:").grid(row=0, column=2)
            self.which_var = tk.StringVar(value="最后一个")
            ttk.Combobox(self.param_frame, textvariable=self.which_var, values=list(ORDINAL_LABELS),
                         width=8, state="readonly").grid(row=0, column=3)

            self.weekday_var = tk.StringVar(value="星期日")
            ttk.Combobox(self.param_frame, textvariable=self.weekday_var, values=WEEKDAYS,
                         width=8, state="readonly").grid(row=0, column=4)

    def choose_file(self):
        file_path = filedialog.asksaveasfilename(defaultextension=".ics", filetypes=[("iCalendar", "*.ics")])
        if file_path:
            self.filename.set(file_path)

    def build_generator(self):
        """根据界面输入创建生成器并加入日期，输入不合法时抛出 ValueError"""
        try:
            place = Place(self.place_name.get().strip() or "自定义地点",
                          self.latitude.get(), self.longitude.get(), self.timezone.get().strip())
            start_year, end_year = self.start_year.get(), self.end_year.get()
            noon_minutes = self.noon_minutes.get() if self.noon_reminder.get() else None
        except tk.TclError:
            raise ValueError("请输入有效的数字")
        if not -90 <= place.latitude <= 90 or not -180 <= place.longitude <= 180:
            raise ValueError("纬度必须在 -90 到 90 之间，经度必须在 -180 到 180 之间")
        if not 1900 <= start_year <= end_year <= 2099:
            raise ValueError("年份必须在 1900-2099 之间，且开始年份不能晚于结束年份")

        try:
            gen = RecurringSunEventGenerator(start_year, end_year, place=place, noon_reminder_minutes=noon_minutes)
        except Exception as e:
            raise ValueError(f"时区无效: {place.timezone}") from e

        rule = self.rule_type.get()
        try:
            if rule == RULE_LUNAR:
                gen.generate_by_lunar_fast_days(LUNAR_TYPES[self.lunar_var.get()])
            elif rule == RULE_MONTHLY:
                gen.generate_by_monthly_day(day=self.day_var.get())
            elif rule == RULE_QUARTER:
                gen.generate_by_quarter(which=QUARTER_DAYS[self.quarter_var.get()])
            elif rule == RULE_WEEKDAY:
                gen.generate_by_weekday_rule(
                    month=self.month_var.get(),
                    weekday=WEEKDAYS.index(self.weekday_var.get()),
                    which=ORDINAL_LABELS[self.which_var.get()]
                )
        except tk.TclError:
            raise ValueError("请输入有效的规则参数")
        return gen

    def preview(self):
        try:
            gen = self.build_generator()
            dates = sorted(gen.dates)
            self.preview_list.delete(0, tk.END)
            self.preview_list.insert(tk.END, f"共 {len(dates)} 天，显示前 {min(len(dates), PREVIEW_LIMIT)} 天:")
            for day in dates[:PREVIEW_LIMIT]:
                times = gen.get_sun_times(day)
                self.preview_list.insert(
                    tk.END,
                    f"{day:%Y-%m-%d} {WEEKDAYS[day.weekday()]}  日出 {times['sunrise']:%H:%M}  "
                    f"日中 {times['noon']:%H:%M}  日落 {times['sunset']:%H:%M}"
                )
        except Exception as e:
            messagebox.showerror("出错了", str(e))

    def generate_calendar(self):
        try:
            gen = self.build_generator()
            count = gen.save_to_ics(self.filename.get())
            messagebox.showinfo("完成", f"已生成 {count} 个事件，.ics 文件已保存至:\n{self.filename.get()}")
        except Exception as e:
            messagebox.showerror("出错了", str(e))


if __name__ == "__main__":
    root = tk.Tk()
    app = CalendarGUI(root)
    root.mainloop()
