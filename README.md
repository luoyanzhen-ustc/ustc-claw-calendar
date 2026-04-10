# USTC Claw Calendar Skill

一个可直接放到 GitHub 的 OpenClaw 课表与日程 skill 包。

## 适用场景

- 上传课表图片并写入 `courses.json`
- 管理临时计划、提醒、会议、待办，并写入 `plans.json`
- 首次安装后自动初始化学期信息
- 默认按北京时间和用户交流
- 自动同步 OpenClaw 已连通的 QQ / 微信 bot 渠道配置

## 一句话安装

把这个仓库推到 GitHub 后，可以直接让 OpenClaw 帮你安装：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar
```

如果你想让它安装后顺手完成初始化，可以直接说：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar，然后完成初始化
```

如果你要指定学期起始日期：

```text
帮我安装这个 skill：https://github.com/luoyanzhen-ustc/ustc-claw-calendar，然后把学期开始日期设为 2026-03-01 并完成初始化
```

## 手动一键安装

如果你想手动安装，不通过对话安装，可直接运行：

```bash
curl -fsSL https://raw.githubusercontent.com/luoyanzhen-ustc/ustc-claw-calendar/main/install.sh | bash
```

如果你已经把仓库拉到本地，也可以直接：

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

如果你不指定日期，当前默认值是：

```text
2026-03-01
```

## 安装后的初始化行为

安装完成后，初始化脚本会：

- 补齐 `settings.json`
- 补齐 `metadata.json`
- 创建空的 `courses.json`
- 创建空的 `recurring.json`
- 创建空的 `plans.json`
- 自动同步并缓存渠道配置到 `known-users.json`
- 自动按学期起始日期计算当前周

如果还没检测到已连通的 QQ / 微信 bot，skill 会提示你先完成 bot 连通；正常情况下不需要手动填写任何渠道 ID。

## 常用脚本

如果你或 Agent 需要显式执行脚本，优先使用这些命令：

```bash
node scripts/install.js
node scripts/auto-init.js --check-channels
node scripts/auto-init.js --semester-start 2026-03-01 --semester-name 2026-spring
node scripts/setup-cron.js
node scripts/daily-task.js
node scripts/weekly-task.js
```

如果环境支持 `npm`，也可以使用：

```bash
npm run init
npm run check-channels
npm run setup-cron
npm run daily
npm run weekly
```

## 数据位置

默认数据目录：

```text
~/.openclaw/workspace/ustc-claw-calendar/data
```

如果设置了环境变量 `OPENCLAW_WORKSPACE`，则会写到：

```text
$OPENCLAW_WORKSPACE/ustc-claw-calendar/data
```

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
│   └── weekly-task.js
└── tools/
    ├── archive-ops.js
    ├── channel-sync.js
    ├── cron-manager.js
    ├── date-math.js
    ├── file-ops.js
    ├── ocr-wrapper.js
    ├── path-utils.js
    ├── plan-manager.js
    └── rebuild-index.js
```

## 当前约束

- 不再依赖 `register-tools.js`
- 不会把课表课程混写进 `plans.json`
- `setup-cron.js` 只保留 daily / weekly 两类任务
- 用户可见时间默认按北京时间表达

## 发布前建议

- 把仓库推到 GitHub 根目录
- 确保 `SKILL.md` 位于仓库根目录
- 不要把真实 `known-users.json`、运行时数据或私有渠道标识提交到仓库
