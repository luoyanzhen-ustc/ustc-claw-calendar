#!/usr/bin/env bash

set -euo pipefail

SKILL_SLUG="ustc-claw-calendar"
SKILL_NAME="USTC Claw Calendar"
REPO_URL="https://github.com/luoyanzhen-ustc/ustc-claw-calendar.git"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE:-${HOME}/.openclaw/workspace}"
SKILLS_DIR="${WORKSPACE_DIR}/skills"
INSTALL_DIR="${SKILLS_DIR}/${SKILL_SLUG}"
TMP_DIR="$(mktemp -d)"

DEFAULT_SEMESTER_START="${CLAW_CALENDAR_SEMESTER_START:-2026-03-01}"
DEFAULT_SEMESTER_NAME="${CLAW_CALENDAR_SEMESTER_NAME:-}"
SETUP_CRON="${USTC_CLAW_CALENDAR_SETUP_CRON:-0}"

cleanup() {
  rm -rf "${TMP_DIR}"
}

trap cleanup EXIT

echo "📅 ${SKILL_NAME} 安装脚本"
echo "========================================="
echo "仓库: ${REPO_URL}"
echo "工作区: ${WORKSPACE_DIR}"
echo "安装目录: ${INSTALL_DIR}"
echo ""

if ! command -v git >/dev/null 2>&1; then
  echo "❌ 未找到 git，无法继续安装"
  exit 1
fi

mkdir -p "${SKILLS_DIR}"

echo "📥 正在从 GitHub 下载..."
git clone --depth 1 "${REPO_URL}" "${TMP_DIR}/repo" >/dev/null 2>&1

if [ -d "${INSTALL_DIR}" ]; then
  echo "⚠️  检测到旧版本，备份到 ${INSTALL_DIR}.bak"
  rm -rf "${INSTALL_DIR}.bak"
  mv "${INSTALL_DIR}" "${INSTALL_DIR}.bak"
fi

mkdir -p "${INSTALL_DIR}"

echo "📦 正在复制 skill 文件..."
cp -R "${TMP_DIR}/repo/." "${INSTALL_DIR}/"
rm -rf "${INSTALL_DIR}/.git"

if [ -z "${DEFAULT_SEMESTER_NAME}" ]; then
  case "${DEFAULT_SEMESTER_START#*-}" in
    0[1-7]-* ) DEFAULT_SEMESTER_NAME="${DEFAULT_SEMESTER_START%%-*}-spring" ;;
    * ) DEFAULT_SEMESTER_NAME="${DEFAULT_SEMESTER_START%%-*}-fall" ;;
  esac
fi

echo ""
echo "🧰 安装后的初始化参数:"
echo "  - 学期开始日期: ${DEFAULT_SEMESTER_START}"
echo "  - 学期名称: ${DEFAULT_SEMESTER_NAME}"
echo ""

if command -v node >/dev/null 2>&1; then
  echo "🚀 正在执行初始化..."
  (
    cd "${INSTALL_DIR}"
    CLAW_CALENDAR_SEMESTER_START="${DEFAULT_SEMESTER_START}" \
    CLAW_CALENDAR_SEMESTER_NAME="${DEFAULT_SEMESTER_NAME}" \
    OPENCLAW_WORKSPACE="${WORKSPACE_DIR}" \
    node "scripts/install.js"
  )

  if [ "${SETUP_CRON}" = "1" ] && command -v openclaw >/dev/null 2>&1; then
    echo "⏰ 正在配置 daily / weekly cron..."
    (
      cd "${INSTALL_DIR}"
      OPENCLAW_WORKSPACE="${WORKSPACE_DIR}" \
      node "scripts/setup-cron.js"
    )
  fi
else
  echo "⚠️  未找到 node，已完成文件安装，但未执行初始化"
  echo "   之后可手动运行:"
  echo "   cd \"${INSTALL_DIR}\" && OPENCLAW_WORKSPACE=\"${WORKSPACE_DIR}\" node scripts/install.js"
fi

echo ""
echo "✅ 安装完成"
echo ""
echo "目录结构:"
echo "  ${INSTALL_DIR}/"
echo "  ├── SKILL.md"
echo "  ├── README.md"
echo "  ├── config.json"
echo "  ├── package.json"
echo "  ├── install.sh"
echo "  ├── scripts/"
echo "  ├── templates/"
echo "  └── tools/"
echo ""
echo "数据目录:"
echo "  ${WORKSPACE_DIR}/${SKILL_SLUG}/data"
echo ""
echo "后续建议:"
echo "  1. 检查 known-users.json 是否已填写 QQ / 微信配置"
echo "  2. 上传课表图片测试 courses.json 导入"
echo "  3. 如需 daily / weekly cron，可设置环境变量 USTC_CLAW_CALENDAR_SETUP_CRON=1 后重装"
