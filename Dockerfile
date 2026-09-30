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
