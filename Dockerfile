# One container: the game server also serves the built web app.
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm install --no-audit --no-fund && npm run build
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["npm", "start"]
