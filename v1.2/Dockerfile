# 使用Node.js 18运行时
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json
COPY backend/package.json backend/package-lock.json ./

# 安装依赖
RUN npm ci --production

# 复制后端代码
COPY backend/ ./backend/
# 复制前端代码
COPY frontend/ ./frontend/

# 创建logs目录并设置权限
RUN mkdir -p backend/logs && chmod -R 777 backend/logs

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 设置工作目录到backend,确保相对路径正确
WORKDIR /app/backend

# 启动应用
CMD ["node", "server.js"]
