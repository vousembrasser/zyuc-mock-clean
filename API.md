# ZYUC Mock 服务接口文档

## 基础信息

- 基础URL: `http://<host>:8080`
- 所有 POST 请求的 Content-Type 应该设置为 `application/json`
- 时间格式统一使用 ISO 8601 标准

## API 端点

### SSE 连接

#### 建立 SSE 连接
```http
GET /api/events?mode={mode}
```

**参数说明：**
- `mode`: 连接模式
  - `interactive`: 实时监控模式，用于人工审核响应
  - `keep-alive`: 保持连接模式，用于非监控场景

**响应格式：**
```json
{
    "requestId": "string",
    "endpoint": "string",
    "payload": "string",
    "defaultResponse": "string",
    "project": "string",
    "source": "string"
}
```

### 配置管理

#### 获取所有配置
```http
GET /api/configs
```

**响应示例：**
```json
[
    {
        "ID": 1,
        "Endpoint": "/api/example",
        "Project": "示例项目",
        "Remark": "示例接口",
        "DefaultResponse": "默认响应内容",
        "Source": "127.0.0.1:8080"
    }
]
```

#### 获取配置源列表
```http
GET /api/configs/sources
```

**响应示例：**
```json
[
    "127.0.0.1:8080",
    "192.168.1.100:8080"
]
```

#### 获取单个配置
```http
GET /api/config/{endpoint}
```

#### 创建/更新配置
```http
POST /api/config
```

**请求体：**
```json
{
    "endpoint": "/api/example",
    "project": "示例项目",
    "remark": "示例接口",
    "defaultResponse": "默认响应内容",
    "source": "127.0.0.1:8080"
}
```

#### 删除配置
```http
DELETE /api/config/{endpoint}
```

### 规则管理

#### 添加规则
```http
POST /api/rules
```

**请求体：**
```json
{
    "configID": 1,
    "keyword": "关键字",
    "response": "特定响应内容"
}
```

#### 删除规则
```http
DELETE /api/rules/{ruleID}
```

### 响应管理

#### 发送响应
```http
POST /api/respond
```

**请求体：**
```json
{
    "requestId": "请求ID",
    "responseBody": "响应内容"
}
```

### 历史记录

#### 获取历史记录
```http
GET /api/history
```

**查询参数：**
- `source`: 设备地址（可选）
- `project`: 项目名称（可选）
- `endpoint`: 接口路径（可选）

#### 获取历史记录源列表
```http
GET /api/history/sources
```

### 服务发现

#### 获取服务列表
```http
GET /api/services
```

**响应示例：**
```json
[
    "127.0.0.1:8080",
    "192.168.1.100:8080"
]
```

## 错误响应

所有错误响应的格式如下：

```json
{
    "code": "ERROR_CODE",
    "message": "错误描述"
}
```

常见错误码：
- `NOT_FOUND`: 资源不存在
- `BAD_REQUEST`: 请求参数错误
- `INTERNAL_ERROR`: 服务器内部错误
