FROM node:24-bookworm-slim
WORKDIR /app
COPY index.html app.js audio-player.js styles.css package.json ./
COPY settings.js watch-together.js ./
COPY assets ./assets
COPY dreamie-mvp ./dreamie-mvp
WORKDIR /app/dreamie-mvp
RUN corepack enable && pnpm install --frozen-lockfile
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/web-server.ts"]
