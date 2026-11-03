# 八关斋戒助手 (BaGuanZhaiJieHelper)

生成八关斋戒日历（`.ics`），可导入手机或电脑日历，自动提醒。

每个事件从**当日日出**开始，到**次日日出**结束；描述中包含农历日期、日出、日中、日落、次日日出时间。

默认提醒：

- 日出前 24、12、1 小时
- 日中前 30 分钟（过午不食，可在界面中关闭或修改分钟数）

## 支持的规则

| 规则 | 说明 |
|---|---|
| 农历斋日 | 六斋日：初八、十四、十五、廿三、廿九、三十（小月为廿八、廿九）<br>十斋日：初一、初八、十四、十五、十八、廿三、廿四、廿八、廿九、三十（小月为廿七、廿八、廿九）<br>闰月同样计算 |
| 每月的第几天 | 不存在的日期（如 2 月 30 日）会被跳过 |
| 每季度 | 第一天或最后一天 |
| 某月的第几个星期几 | 第一个 ~ 第四个，或最后一个 |

默认地点为 Auckland Britomart Train Station（36°50'38.6"S 174°46'03.1"E），可在界面中改为其它经纬度和时区（时区使用 IANA 名称，如 `Asia/Shanghai`）。农历换算支持 1900-2099 年。

每个事件的 UID 由日期决定，重新生成并导入时，日历应用会更新已有事件而不是重复添加。

## 网页版（web/）

纯静态页面，不需要构建，所有计算都在浏览器中完成。功能与桌面版一致，另外支持：

- 选择日出前提醒哪几个时间
- 「使用当前位置」自动填写经纬度和时区（需要 HTTPS 或 localhost）
- 记住上次的设置（保存在浏览器本地）

| 文件 | 说明 |
|---|---|
| `web/index.html`、`web/css/style.css` | 页面 |
| `web/js/core.js` | 核心逻辑：太阳时间（移植自 astral）、农历（数据表移植自 lunardate）、日期规则、生成 .ics。浏览器与 Node 通用 |
| `web/js/vendor/date-tibetan.js` | 藏历计算（@hnw/date-tibetan，MIT，见下文） |
| `web/js/calendar-view.js` | 月历控件 |
| `web/js/app.js` | 页面交互 |
| `web/test/` | 单元测试，以及与 Python 版本的对比脚本 |

本地使用：直接双击打开 `web/index.html` 即可。定位功能需要通过本地服务器访问：

```powershell
.\.venv\Scripts\python -m http.server 8000 -d web
# 打开 http://localhost:8000
```

部署：把 `web/` 目录上传到任何静态托管即可，例如 GitHub Pages、Azure Static Web Apps、Cloudflare Pages。

测试（需要 Node.js 20+）：

```powershell
node --test web/test/
# 与 Python 版本逐项对比（太阳时间、1901-2098 年每一天的农历、日期规则）
.\.venv\Scripts\python web/test/make_reference.py > reference.json
node web/test/compare.js reference.json
```

### 月历与手动选择

页面上的月历每格显示公历、农历、藏历，并标出：

- 「斋」：适合受持八关斋戒（汉传六斋日/十斋日，藏传初八、十五、三十、四大节日）
- 佛教节日名称（汉传佛菩萨纪念日、藏传四大节日、藏历新年）
- 萨嘎达瓦月底色、当前规则生成的日期（虚线框）

点击日期即加入或移出「已选日期」列表，同时显示当天的农历、藏历、太阳时间和殊胜日建议。列表保存在浏览器本地。生成时可选择包含规则日期、手动选择的日期，或两者合并；每个事件的描述会写明当天的殊胜日。

汉传纪念日（农历，非闰月；三十在小月取廿九）：弥勒菩萨圣诞（正月初一）、释迦牟尼佛出家日（二月初八）、涅槃日（二月十五）、观世音菩萨圣诞（二月十九）、普贤菩萨圣诞（二月廿一）、准提菩萨圣诞（三月十六）、文殊菩萨圣诞（四月初四）、浴佛节（四月初八）、药王菩萨圣诞（四月廿八）、伽蓝菩萨圣诞（五月十三）、韦驮菩萨圣诞（六月初三）、观世音菩萨成道日（六月十九）、大势至菩萨圣诞（七月十三）、盂兰盆节（七月十五）、地藏菩萨圣诞（七月三十）、燃灯古佛圣诞（八月廿二）、观世音菩萨出家日（九月十九）、药师佛圣诞（九月三十）、达摩祖师圣诞（十月初五）、阿弥陀佛圣诞（冬月十七）、释迦牟尼佛成道日（腊月初八）。表在 `web/js/core.js` 的 `HAN_FESTIVALS`，可按所在道场的习惯增删。

### 藏历

网页版另有「藏历斋日」规则（仅网页版），按时轮历浦派（Phugpa）计算，可勾选：

- 每月：初八药师佛日、十五阿弥陀佛日、三十释迦牟尼佛日、初十莲师荟供日、廿五空行母荟供日
- 每年：四大节日（神变节正月十五、萨嘎达瓦节四月十五、转法轮节六月初四、天降节九月廿二，均取非闰月）、整个萨嘎达瓦月

藏历的日子以当天黎明时的太阴日命名，因此会有重日（同一日子两天）和缺日（当月没有某日）。规则为：**重日取第二天，缺日提前一天**，事件描述中会注明。

计算使用 `web/js/vendor/date-tibetan.js`，来自 [@hnw/date-tibetan](https://github.com/hnw/date-tibetan) 1.0.2（MIT），做了以下改动：

- 改为普通脚本，去掉 `astronomia` 依赖
- 修复一处错误：原代码在搜索时把日子推到 0 或 31 而不换月，导致 2077-07-20（六月初一重日的第一天）判断错误

校验：`web/test/tibetan-exact.test.js` 用精确分数运算独立实现了 Janson 的公式，与之逐日对比 1900-2100 年完全一致。藏历新年（2024-2030）和萨嘎达瓦节等日期与公开资料一致。

注意：农历没有使用浏览器内置的 `Intl` 中国历。ICU 在部分年份有误（例如把 2027 年春节算成 2 月 7 日，实际为 2 月 6 日），因此改用与 Python 版本相同的数据表。

## 桌面版（calendar_app/）

### 运行

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements-dev.txt
cd calendar_app
..\.venv\Scripts\python calendar_gui.py
```

### 测试

```powershell
cd calendar_app
..\.venv\Scripts\python -m pytest
```

### 打包为 exe

```powershell
cd calendar_app
..\.venv\Scripts\pyinstaller calendar_gui.spec
```

生成文件位于 `calendar_app/dist/BGZJ_calendar.exe`。
