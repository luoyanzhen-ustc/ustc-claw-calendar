# USTC Claw Calendar Skill

这是一个给 OpenClaw 用的课表与日程管理 skill。

它适合做这些事：

- 导入课表图片，整理成结构化课程数据
- 记录一次性事件
- 记录周期事件
- 给课程、事件、周期事件添加提醒
- 查询今天、本周、近期安排
- 生成 daily / weekly 所需的索引与归档数据

它不负责把所有聊天内容都自动记进日程。普通闲聊、吐槽、心情、轻量记忆，仍然更适合交给 OpenClaw 原生 memory。

## 先理解这件事

这份 skill 的定位不是“什么都自动记”的全能记忆系统，而是“用户明确触发时才工作的日程助手”。

可以这样理解：

- 你说“帮我记一下……”，它会记录
- 你说“提醒我……”，它会记录并创建提醒
- 你说“看看我今天有什么安排”，它会查询
- 你只是随口说“明天我要去跑步”，默认不会自动写入日程

这样做的好处是：

- 记录范围更清楚，不容易把闲聊误写成事件
- 提醒创建更稳定，能走 skill 自己的统一逻辑
- 长期积累下来的课程、事件、周期安排更容易检索和总结

## 一句话安装

如果你想让 OpenClaw 通过对话安装这个 skill，可以直接说：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar
```

如果希望安装后顺手完成初始化，可以说：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar，然后完成初始化
```

如果你已经知道学期开始日期，也可以一起说清楚：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar，然后把学期开始日期设为 2026-03-01 并完成初始化
```

## 手动一键安装

如果你想手动安装，可以运行：

```bash
curl -fsSL https://raw.githubusercontent.com/luoyanzhen-ustc/ustc-claw-calendar/main/install.sh | bash
```

如果仓库已经在本地：

```bash
bash install.sh
```

可选环境变量：

```bash
CLAW_CALENDAR_SEMESTER_START=2026-03-01
CLAW_CALENDAR_SEMESTER_NAME=2026-spring
USTC_CLAW_CALENDAR_SETUP_CRON=1
OPENCLAW_WORKSPACE=/your/openclaw/workspace
```

## 安装后会发生什么

安装完成后，初始化脚本会自动补齐这几类数据文件：

- `settings.json`
- `metadata.json`
- `courses.json`
- `events.json`
- `recurring.json`
- `known-users.json`

同时它会尝试做这些事：

- 默认把学期开始日期设为 `2026-03-01`
- 自动计算当前周次
- 默认按北京时间与用户交流
- 自动检查 OpenClaw 已连通的 QQ / 微信 bot 渠道配置
- 把可用的渠道信息同步到 skill 自己的 `known-users.json`

如果当前还没有检测到已连通的 QQ / 微信 bot，这个 skill 仍然可以正常记录课表和事件，只是提醒推送暂时不能工作。

你一般不需要手动填写 openid、userId、accountId 之类的底层参数。更符合用户视角的做法是：先让 OpenClaw 和 QQ / 微信 bot 连通，并且至少实际聊过一次，再让 skill 自动同步配置。

## 最常见的几种用法

### 1. 上传课表图片

推荐流程是：

1. Agent 优先直接读图解析课表
2. 如果当前模型不适合读图，再回退到 OCR
3. 根据 USTC 规则修正星期、节次、周次、上课时间
4. 先保存为待确认草稿
5. 让用户确认识别结果
6. 确认后再写入 `courses.json`

也就是说，课表不会在用户还没确认时直接正式写入。

### 2. 只记录，不提醒

```text
帮我记一下，明天下午三点和老师讨论选题
```

结果：

- 写入 `events.json`
- 默认不创建提醒

### 3. 记录并提醒

```text
提醒我明天下午三点和老师讨论选题
```

结果：

- 写入 `events.json`
- 创建提醒
- 提醒会优先走这个 skill 自己的 reminder 逻辑，而不是绕过 skill 直接调系统级临时提醒

提醒文案默认会尽量写得简短、自然、像正常聊天提醒。

如果你想自定义提醒文案风格，也可以在 `settings.json` 里设置 `notify.reminderPromptTemplate`。
例如你希望提醒语气更温和，或者更像待办通知，都可以改。

可用占位符：

- `{{title}}`
- `{{date}}`
- `{{time}}`
- `{{summary}}`
- `{{location}}`
- `{{lead_time}}`
- `{{channel}}`

示例：

```json
{
  "notify": {
    "reminderPromptTemplate": "提醒你：{{date}} {{time}} 有“{{title}}”。{{summary}}"
  }
}
```

如果不设置这一项，skill 会使用内置的默认提醒风格。

### 4. 添加周期事件

```text
帮我记一下，以后每周二和周四晚上健身
```

结果：

- 写入 `recurring.json`

如果你想要提醒，最好直接说清楚：

```text
以后每周二和周四晚上八点提醒我去健身
```

## 这份 skill 会怎么处理你的内容

为了让记录结果更清楚，这份 skill 目前会这样处理：

- 课程写入 `courses.json`
- 一次性事件写入 `events.json`
- 周期事件写入 `recurring.json`
- 提醒可以附加在课程、一次性事件、周期事件上
- 用户看到的时间默认按北京时间表达
- 如果时间说得不够具体，通常会先向你确认
- 如果新事件和已有课程、事件、周期事件时间重叠，会提示你存在冲突

## 这份 skill 不适合做什么

下面这些事情，不建议交给这份 skill 自动做：

- 把每一句聊天都写进日程
- 因为用户提到未来时间，就自动创建事件
- 因为用户提到一件事，就默认创建提醒
- 把隐性偏好、心情、闲聊细节都塞进 calendar 存储

更合适的分工是：

- OpenClaw 原生 memory：处理聊天背景、偏好、情绪、轻量记忆
- USTC Claw Calendar：处理用户明确交给它的课程、事件、周期安排、提醒、查询、总结

## 常用脚本

```bash
node scripts/install.js
node scripts/auto-init.js --check-channels
node scripts/auto-init.js --semester-start 2026-03-01 --semester-name 2026-spring
node scripts/setup-cron.js
node scripts/daily-task.js
node scripts/weekly-task.js
node scripts/review-course-import.js
node scripts/confirm-course-import.js
node scripts/discard-course-import.js
```

如果环境支持 `npm`：

```bash
npm run init
npm run check-channels
npm run setup-cron
npm run daily
npm run weekly
npm run review-course-import
npm run confirm-course-import
npm run discard-course-import
```

## 数据放在哪里

默认数据目录：

```text
~/.openclaw/workspace/ustc-claw-calendar/data
```

如果设置了 `OPENCLAW_WORKSPACE`：

```text
$OPENCLAW_WORKSPACE/ustc-claw-calendar/data
```

主要数据文件：

- `settings.json`：显示时区、提醒文案模板等用户设置
- `courses.json`：课程主存储
- `events.json`：一次性事件主存储
- `recurring.json`：周期事件规则主存储
- `index/today.json`
- `index/this-week.json`
- `index/upcoming.json`

后面这三个是派生索引，不是主存储。

## 仓库结构

```text
ustc-claw-calendar/
├── SKILL.md
├── README.md
├── config.json
├── package.json
├── install.sh
├── scripts/
│   ├── auto-init.js
│   ├── install.js
│   ├── init.js
│   ├── setup-cron.js
│   ├── daily-task.js
│   ├── weekly-task.js
│   ├── review-course-import.js
│   ├── confirm-course-import.js
│   └── discard-course-import.js
└── tools/
    ├── archive-ops.js
    ├── channel-sync.js
    ├── conflict-detector.js
    ├── course-import.js
    ├── course-manager.js
    ├── cron-manager.js
    ├── date-math.js
    ├── event-manager.js
    ├── file-ops.js
    ├── ocr-wrapper.js
    ├── path-utils.js
    ├── recurring-manager.js
    └── rebuild-index.js
```
