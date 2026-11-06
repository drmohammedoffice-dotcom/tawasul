# Production Deployment Guide (VPS + Nginx + SSL)

This guide is for launching the platform in production with:
- Docker Compose app stack
- Nginx reverse proxy
- Let's Encrypt SSL
- Domain routing
- Security hardening
- Horizontal backend scaling

---

## 1) VPS Setup (Ubuntu 22.04+)

### Recommended minimum for first launch
- 4 vCPU
- 8 GB RAM
- 100+ GB SSD
- Public IPv4

### Base provisioning
```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone UTC
sudo apt install -y curl git ufw fail2ban ca-certificates gnupg lsb-release
```

### Create deploy user
```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
```

### Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### Install Docker + Compose plugin
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

---

## 2) Domain Connection (DNS)

Point your domain to VPS:
- `A` record: `example.com` -> `YOUR_VPS_IP`
- `A` record: `www.example.com` -> `YOUR_VPS_IP` (optional)
- If split API domain:
  - `api.example.com` -> `YOUR_VPS_IP`

Verify:
```bash
dig +short example.com
dig +short api.example.com
```

---

## 3) Deploy Application Stack

### Clone and configure
```bash
git clone <your-repo-url> app
cd app
cp .env.docker.example .env
cp backend/.env.docker.example backend/.env.docker
```

Update secrets in `backend/.env.docker`:
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- DB credentials/URLs
- media/S3 credentials if using S3

### Start stack
```bash
docker compose up -d --build
docker compose ps
```

### Smoke checks
```bash
curl http://127.0.0.1:3000/health
docker compose logs backend --tail=100
```

---

## 4) Nginx Reverse Proxy Configuration

Install Nginx:
```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/secure-messaging.conf`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;

    # ACME challenge (Let's Encrypt)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect HTTP -> HTTPS after cert setup
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO / WebSocket
    location /realtime/ {
        proxy_pass http://127.0.0.1:3000/realtime/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
    }
}
```

Enable config:
```bash
sudo ln -s /etc/nginx/sites-available/secure-messaging.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5) SSL with Let's Encrypt

Install Certbot:
```bash
sudo apt install -y certbot python3-certbot-nginx
```

Issue cert:
```bash
sudo certbot --nginx -d example.com -d www.example.com
```

Auto-renew check:
```bash
sudo certbot renew --dry-run
```

---

## 6) Environment Security Checklist

- Use strong random secrets (JWT, DB, Redis, S3).
- Keep `.env` files out of git.
- Set `NODE_ENV=production`.
- Restrict Postgres/Redis ports to private network only (no public exposure).
- Enable `AUTH_COOKIE_SECURE=true` when serving over HTTPS.
- Use `AUTH_COOKIE_SAME_SITE=lax` or `strict` unless cross-site required.
- Enforce HTTPS-only traffic and HSTS in Nginx.
- Disable debug logging in production.
- Rotate secrets regularly (at least quarterly).
- Use separate DB user with least privileges.
- Backup DB daily and test restore process.
- Enable fail2ban and SSH key-only login (`PasswordAuthentication no`).

---

## 7) Horizontal Backend Scaling Strategy

### Phase 1 (single VPS)
- 1 backend container
- 1 postgres
- 1 redis
- Nginx reverse proxy

### Phase 2 (multi-instance backend on one host)
```bash
docker compose up -d --scale backend=3
```
- Keep backend stateless.
- Redis already supports socket pub/sub fanout across instances.
- All backend replicas share the same Postgres + Redis.

### Phase 3 (real multi-node)
- Move Postgres to managed HA database.
- Move Redis to managed Redis (replication/sentinel or cluster).
- Put multiple VPS nodes behind cloud load balancer.
- Use sticky sessions only if required (Socket.IO can work without stickiness with proper adapter strategy).
- Externalize storage to S3-compatible service.

### Nginx upstream sample (for multiple backend replicas)
```nginx
upstream backend_pool {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}
```

Then proxy `/api/` and `/realtime/` to `http://backend_pool`.

---

## 8) Operations Runbook (Launch Day)

1. `docker compose pull && docker compose up -d --build`
2. Verify `/health` and app login flow
3. Verify WebSocket connection and message send/read
4. Confirm SSL grade and renewal job
5. Enable monitoring + alerting:
   - container restart alerts
   - CPU/RAM thresholds
   - DB connection saturation
   - error-rate alerts

Recommended monitoring stack:
- Prometheus + Grafana + Loki (or Datadog/New Relic equivalent)
