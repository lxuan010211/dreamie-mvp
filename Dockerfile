FROM node:24-bookworm-slim
WORKDIR /app
COPY index.html app.js styles.css package.json ./
COPY assets ./assets
COPY dreamie-mvp ./dreamie-mvp
WORKDIR /app/dreamie-mvp
RUN corepack enable && pnpm install --frozen-lockfile
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/web-server.ts"]
