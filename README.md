# ZYUC Mock 服务

一个功能强大的 HTTP 请求模拟服务，支持实时监控、自动响应、规则匹配等特性。

## 特性

- 🔄 实时监控请求和响应
- 🤖 自动响应配置
- 📝 基于关键字的响应规则
- 📊 历史记录查询
- 🌐 多设备支持
- 🎯 项目分类管理

## 快速开始

### 前置条件

- Go 1.19 或更高版本
- Node.js 16 或更高版本
- SQLite3

### 安装

1. 克隆仓库：
```bash
git clone https://github.com/yourusername/zyuc-mock-clean.git
cd zyuc-mock-clean
```

2. 安装依赖：
```bash
# 后端依赖
go mod tidy

# 前端依赖
cd zyuc-mock-clean-web
npm install
```

### 构建

```bash
# 构建前端
cd zyuc-mock-clean-web
npm run build

# 构建后端（在项目根目录）
go build -o zyuc-mock
```

### 运行

```bash
# 指定监听地址和端口
./zyuc-mock -listen :8080
```

默认情况下，服务器将监听在 `:8080` 端口。你可以通过浏览器访问 `http://localhost:8080` 来使用 Web 界面。

## 使用说明

### 实时监控模式

1. 访问 Web 界面主页面
2. 查看实时请求
3. 可以选择手动编辑响应或使用默认响应

### 配置默认响应

1. 点击"配置默认响应"按钮
2. 填写接口路径、项目名称等信息
3. 设置默认响应内容
4. 可选：添加基于关键字的响应规则

### 查看历史记录

1. 点击"查看历史"按钮
2. 使用过滤器筛选特定记录
3. 查看详细请求和响应信息

## 架构设计

### 后端（Go）

- **gin**: Web 框架
- **SQLite**: 数据存储
- **SSE**: 实时通信

### 前端（Next.js）

- **React**: UI 构建
- **TypeScript**: 类型安全
- **TailwindCSS**: 样式处理

## 配置说明

### 服务器配置

- `-listen`: 监听地址和端口（默认 `:8080`）
- 其他配置通过环境变量提供

### 数据库

- 使用 SQLite 数据库（`mock_config.db`）
- 自动创建必要的表结构

## API 文档

详细的 API 文档请参考 [API.md](API.md)。

## 开发指南

### 本地开发

1. 启动后端服务：
```bash
go run main.go
```

2. 启动前端开发服务器：
```bash
cd zyuc-mock-clean-web
npm run dev
```

### 代码结构

```
zyuc-mock-clean/
├── main.go              # 主入口
├── service/            # 后端服务
│   ├── broker/        # 请求处理
│   ├── bus/           # 事件总线
│   └── storage/       # 数据存储
├── zyuc-mock-clean-web/ # 前端项目
│   ├── app/           # Next.js 页面
│   ├── components/    # React 组件
│   ├── hooks/         # 自定义 hooks
│   └── lib/           # 工具函数
└── mock_config.db     # SQLite 数据库
```

## 许可证

[MIT License](LICENSE)
