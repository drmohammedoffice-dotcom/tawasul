FROM node:22-alpine AS builder
WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:3000/api
ARG VITE_WS_URL=http://localhost:3000/realtime

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY shared/package.json ./shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY frontend ./frontend
COPY shared ./shared

WORKDIR /app/frontend
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY infrastructure/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
