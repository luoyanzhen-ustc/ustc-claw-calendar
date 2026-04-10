# USTC Claw Calendar Skill

一个可直接放到 GitHub 的 OpenClaw 课表与日程 skill 包。

## 适用场景

- 上传课表图片并导入 `courses.json`
- 管理一次性事件并写入 `events.json`
- 管理周期事件并写入 `recurring.json`
- 给课程、事件、周期事件附加提醒
- 首次安装后自动初始化学期信息
- 默认按北京时间与用户交流
- 自动同步 OpenClaw 已连通的 QQ / 微信 bot 渠道配置

## 使用边界

这个 skill 的定位是“需要用户明确触发的结构化日程管理助手”。

它负责：

- 用户明确要求记录的事项
- 用户明确要求提醒的事项
- 用户明确要求查询、总结、规划的日程事项

它不负责：

- 把所有聊天都自动写进日程
- 因为用户提到未来时间就自动创建 event
- 因为用户提到一件事就自动创建提醒

推荐理解方式：

- “帮我记一下，明天下午三点和老师讨论选题”
  只记录到 `events.json`
- “明天下午三点提醒我和老师讨论选题”
  记录到 `events.json` 并创建提醒
- “明天我要去跑步”
  默认不写入 calendar，普通聊天与隐式记忆交给 OpenClaw 原生 memory

这也是这个 skill 和 OpenClaw 原生 memory 的分工：

- 原生 memory 负责偏好、心情、聊天背景、轻量记忆
- 本 skill 负责用户明确交给它的课程、事件、周期安排、提醒和查询

## 一句话安装

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar
```

如果希望安装后顺手完成初始化：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar，然后完成初始化
```

如果要指定学期起始日期：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar，然后把学期开始日期设为 2026-03-01 并完成初始化
```

## 手动一键安装

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

## 安装后的初始化行为

安装完成后，初始化脚本会：

- 补齐 `settings.json`
- 补齐 `metadata.json`
- 创建空的 `courses.json`
- 创建空的 `events.json`
- 创建空的 `recurring.json`
- 自动同步并缓存渠道配置到 `known-users.json`
- 自动按学期起始日期计算当前周

默认学期起始日期是：

```text
2026-03-01
```

如果还没有检测到已连通的 QQ / 微信 bot，skill 会提示先完成 bot 连通；正常情况下不需要用户手动填写任何渠道 ID。

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

## 课表导入流程

推荐链路：

1. Agent 优先使用自身读图能力解析课表图片。
2. 如果当前模型不适合直接读图，再回退到 OCR。
3. 根据 USTC 规则修正星期、节次、周次和上课时间。
4. 先保存为待确认草稿，不直接写入正式课程存储。
5. 向用户展示识别摘要并确认。
6. 用户确认后再写入 `courses.json`。

可配合以下命令：

```bash
node scripts/review-course-import.js
node scripts/confirm-course-import.js
node scripts/discard-course-import.js
```

若草稿仍有 `needsReview` 项，但用户已经逐项确认无误，可使用：

```bash
node scripts/confirm-course-import.js --force
```

## 数据位置

默认数据目录：

```text
~/.openclaw/workspace/ustc-claw-calendar/data
```

若设置了 `OPENCLAW_WORKSPACE`：

```text
$OPENCLAW_WORKSPACE/ustc-claw-calendar/data
```

## 当前数据模型

- `courses.json`
  课程表主存储
- `events.json`
  一次性事件主存储
- `recurring.json`
  周期事件规则主存储
- `index/today.json`
- `index/this-week.json`
- `index/upcoming.json`
  这些都是派生索引

提醒是通用能力，可附加到课程、事件、周期事件。

## 记录与提醒规则

- “帮我记一下 / 记一下 / 加入日程”
  默认只记录，不自动提醒
- “提醒我 / 到时候提醒我 / 通知我”
  记录并提醒
- “以后每周……”
  若用户明确要求记录或提醒，则创建周期事件
- 含糊不清时
  应先追问一句，而不是自作主张写入或提醒

提醒创建应优先走本 skill 的统一 reminder 层，而不是绕过 skill 直接调用系统级临时提醒。

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

## 当前约束

- 不再依赖 `register-tools`
- 不会把课表课程混写进普通事件
- `setup-cron.js` 只保留 daily / weekly 两类任务
- 用户可见时间默认按北京时间表达

## 发布前建议

- 将仓库内容直接推到 GitHub 根目录
- 确保 `SKILL.md` 位于仓库根目录
- 不要提交真实 `known-users.json`、运行时数据或私有渠道标识
