# 阿里云宝塔部署手册

> 服务器规格：2 核 2G，宝塔 Linux 面板
> 域名备案中，暂时用公网 IP 访问

---

## 一、准备工作

### 1.1 宝塔面板安装必要软件

在宝塔面板「软件商店」安装：

- **Node.js 版本管理器**（选 22.x LTS）
- **PM2 管理器**（宝塔内置，或 `npm install -g pm2`）
- **Nginx**（用于反向代理）

### 1.2 创建环境变量文件

在服务器项目根目录创建 `.env.server`（不提交到 Git）：

```env
# Supabase（使用 service_role key，不是 anon key）
SUPABASE_URL=https://wtogbmrbcgpmbtybkvle.supabase.co
SUPABASE_SERVICE_KEY=<从 Supabase 控制台 Settings → API 获取 service_role key>

# JWT 密钥（随机生成，建议 32+ 字符）
JWT_SECRET=<openssl rand -base64 32 生成>

# CORS 允许的额外来源（逗号分隔）
ALLOWED_ORIGINS=http://120.77.156.253,http://120.77.156.253:3000

# Next.js 前端 - Hono API 地址（Next.js 运行时读取）
NEXT_PUBLIC_API_BASE_URL=http://120.77.156.253:3001
```

> ⚠️ service_role key 拥有绕过 RLS 的超级权限，只能在服务端使用，绝不能写入前端代码

---

## 二、部署步骤

### 2.1 拉取代码

```bash
cd /www/wwwroot
git clone https://github.com/realLeonard/QuantStock.git quantstock
cd quantstock
```

### 2.2 安装依赖

```bash
npm install
```

### 2.3 构建项目

```bash
# 构建 Hono API（编译 TypeScript → dist/）
cd backend/api
npm run build
cd ../..

# 构建 Next.js
cd apps/web
# 先创建 .env.local，写入环境变量
cp /root/.env.server .env.local   # 或手动创建
npm run build
cd ../..
```

### 2.4 加载环境变量并启动 PM2

```bash
# 将 .env.server 中的变量导出到当前 shell（PM2 会继承）
export $(grep -v '^#' .env.server | xargs)

# 启动两个进程
pm2 start ecosystem.config.js

# 保存 PM2 进程列表（重启服务器后自动恢复）
pm2 save
pm2 startup   # 按提示执行输出的命令
```

### 2.5 验证服务

```bash
# 检查进程状态
pm2 list

# 检查 API 健康
curl http://localhost:3001/api/health

# 检查 Web（应返回 HTML）
curl http://localhost:3000
```

---

## 三、Nginx 反向代理配置

在宝塔面板「网站」→「添加站点」，或手动编辑 `/etc/nginx/conf.d/quantstock.conf`：

```nginx
# 管理后台（3000 端口）
server {
    listen 80;
    server_name 120.77.156.253;   # 备案后改为域名

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Hono API（3001 端口，移动端直连，也可通过 /api 子路径代理）
server {
    listen 3001;
    server_name 120.77.156.253;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

重载 Nginx：

```bash
nginx -t && nginx -s reload
```

---

## 四、移动端 Android 配置

打包前修改 `apps/mobile/.env.production`：

```env
VITE_API_BASE_URL=http://120.77.156.253:3001
```

重新打包 APK 后安装到设备测试。

---

## 五、验证清单

```bash
# 1. API 健康检查
curl http://120.77.156.253:3001/api/health
# 预期：{"status":"ok","ts":...}

# 2. 未带 token 访问受保护接口 → 401
curl http://120.77.156.253:3001/api/themes
# 预期：{"error":"未授权，缺少 Authorization header"}

# 3. 登录并获取 token
curl -X POST http://120.77.156.253:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
# 预期：{"data":{"token":"eyJ...","user":{"username":"admin","role":"admin"}}}

# 4. 带 token 访问主题接口
TOKEN=<上一步拿到的 token>
curl http://120.77.156.253:3001/api/themes \
  -H "Authorization: Bearer $TOKEN"
# 预期：{"data":[...]}

# 5. 移动端接口（需要有效 Supabase JWT）
curl -X POST http://120.77.156.253:3001/api/mobile/user/sync \
  -H "Authorization: Bearer <supabase_access_token>"
```

---

## 六、日常运维

```bash
# 查看实时日志
pm2 logs quantstock-api --lines 100
pm2 logs quantstock-web --lines 100

# 拉新代码并重启
cd /www/wwwroot/quantstock
git pull
cd backend/api && npm run build && cd ../..
pm2 restart quantstock-api

# Next.js 更新（需重新 build）
cd apps/web
npm run build
cd ../..
pm2 restart quantstock-web
```

---

## 七、安全注意事项

1. **service_role key** 只存在服务器 `.env.server`，不进 Git、不打包进 APK
2. **JWT_SECRET** 泄露后需立即更换，并让所有已登录用户重新登录
3. 宝塔防火墙只开放 80、443、3001 端口（3000 端口通过 Nginx 代理，无需对外暴露）
4. 定期检查 `pm2 logs` 是否有异常鉴权失败日志
