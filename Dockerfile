# 경량 MES: 컨테이너 하나가 API + 빌드된 화면을 함께 서빙한다 (server/src/app.js의 정적 파일 서빙 참고)

# ---- 1) 클라이언트 빌드 ----
FROM node:24-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY client client
RUN npm run build --workspace=client

# ---- 2) 프로덕션 런타임 (서버만) ----
FROM node:24-slim AS runtime
WORKDIR /app
# better-sqlite3는 Node 24용 프리빌드 바이너리가 없을 수 있어 소스 빌드 도구를 설치한다
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev --workspace=server
COPY server server
COPY --from=client-build /app/client/dist client/dist

ENV NODE_ENV=production
ENV PORT=4000
ENV MES_DB_PATH=/app/data/data.sqlite3
RUN mkdir -p /app/data
EXPOSE 4000

CMD ["node", "server/src/index.js"]
