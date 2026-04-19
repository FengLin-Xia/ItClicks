FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# 创建 logs 目录
RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "server.js"]
