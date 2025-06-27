#!/bin/bash

# 版本发布脚本
# 用法: ./scripts/release.sh [patch|minor|major|<version>]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否在git仓库中
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "当前目录不是git仓库"
    exit 1
fi

# 检查工作区是否干净
if ! git diff-index --quiet HEAD --; then
    log_error "工作区有未提交的更改，请先提交或暂存"
    exit 1
fi

# 检查是否在main分支
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
    log_warning "当前不在main分支 (当前: $current_branch)"
    read -p "是否继续? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 获取当前版本
current_version=$(node -p "require('./package.json').version")
log_info "当前版本: $current_version"

# 确定新版本
if [ $# -eq 0 ]; then
    echo "请指定版本类型或具体版本号:"
    echo "  patch  - 补丁版本 (0.0.1)"
    echo "  minor  - 次要版本 (0.1.0)"
    echo "  major  - 主要版本 (1.0.0)"
    echo "  <version> - 具体版本号 (如 1.2.3)"
    exit 1
fi

version_type=$1

# 计算新版本号
if [[ "$version_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    new_version=$version_type
else
    case $version_type in
        patch)
            new_version=$(node -p "
                const v = require('./package.json').version.split('.');
                v[2] = parseInt(v[2]) + 1;
                v.join('.');
            ")
            ;;
        minor)
            new_version=$(node -p "
                const v = require('./package.json').version.split('.');
                v[1] = parseInt(v[1]) + 1;
                v[2] = 0;
                v.join('.');
            ")
            ;;
        major)
            new_version=$(node -p "
                const v = require('./package.json').version.split('.');
                v[0] = parseInt(v[0]) + 1;
                v[1] = 0;
                v[2] = 0;
                v.join('.');
            ")
            ;;
        *)
            log_error "无效的版本类型: $version_type"
            exit 1
            ;;
    esac
fi

log_info "新版本: $new_version"

# 确认发布
echo
log_warning "即将发布版本 $new_version"
echo "这将会:"
echo "  1. 更新所有package.json中的版本号"
echo "  2. 更新Tauri配置中的版本号"
echo "  3. 创建git commit和tag"
echo "  4. 推送到远程仓库触发CI/CD"
echo
read -p "确认继续? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "取消发布"
    exit 0
fi

# 更新版本号
log_info "更新版本号..."

# 更新根package.json
node -e "
const fs = require('fs');
const pkg = require('./package.json');
pkg.version = '$new_version';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# 更新所有子包的版本号
find packages -name "package.json" -exec node -e "
const fs = require('fs');
const path = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.version = '$new_version';
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
" {} \;

# 更新Tauri配置
if [ -f "packages/web-ui/src-tauri/tauri.conf.json" ]; then
    node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('packages/web-ui/src-tauri/tauri.conf.json', 'utf8'));
    config.version = '$new_version';
    fs.writeFileSync('packages/web-ui/src-tauri/tauri.conf.json', JSON.stringify(config, null, 2) + '\n');
    "
    log_success "已更新Tauri配置版本号"
fi

# 创建commit
log_info "创建版本提交..."
git add .
git commit -m "chore: bump version to $new_version"

# 创建tag
tag_name="v$new_version"
log_info "创建标签: $tag_name"
git tag -a "$tag_name" -m "Release $new_version"

# 推送到远程
log_info "推送到远程仓库..."
git push origin main
git push origin "$tag_name"

log_success "版本 $new_version 发布完成!"
log_info "CI/CD将自动构建和部署新版本"
log_info "查看发布状态: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/actions"
