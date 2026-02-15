FROM node:20-slim

# Chromium + 日本語フォントをインストール（Puppeteer用）
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-noto-cjk \
    git \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer設定：ダウンロード済みChromiumを使う
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV HEADLESS=true

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# データ用ディレクトリを作成
RUN mkdir -p data/db data/logs data/images config

EXPOSE 3000

CMD ["node", "server.js"]
