import { GATEWAY_PORT } from "../../config/constants";

export function nginxOpenclawConf(): string {
  return `limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    listen 127.0.0.1:80;
    server_name openclaw;

    server_tokens off;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:${GATEWAY_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 75s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        limit_req zone=api burst=20 nodelay;

        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-XSS-Protection "1; mode=block" always;
        # unsafe-inline/unsafe-eval required by OpenClaw control UI SPA
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; frame-src 'self'" always;
        add_header Referrer-Policy "no-referrer" always;
    }
}`;
}
