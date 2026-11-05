# ---------- 共通：依存関係のインストール ----------
FROM node:22-alpine AS base
RUN npm install -g pnpm@10.34.9
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# 依存を追加した後は pnpm-lock.yaml が古い可能性があるため frozen にはしない
# （ローカルで一度 `pnpm install` を実行してロックファイルを更新すれば frozen も可）
RUN pnpm install --no-frozen-lockfile

# ---------- 開発用：Vite dev server（ホットリロード） ----------
FROM base AS dev
COPY . .
ENV PORT=5173
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

# ---------- ビルド ----------
FROM base AS build
COPY . .
# ブラウザから見た API の URL（ビルド時に埋め込まれる）
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm build

# ---------- 本番用：nginx で静的配信 ----------
FROM nginx:alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
