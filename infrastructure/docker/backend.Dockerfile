FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY shared/package.json ./shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY backend ./backend
COPY shared ./shared

WORKDIR /app/backend
RUN npm run prisma:generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/backend
EXPOSE 3000
CMD ["npm", "run", "start"]
