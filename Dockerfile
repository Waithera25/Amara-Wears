FROM nginx:alpine

COPY index-local.html /usr/share/nginx/html/index.html
COPY katawa-logo-local.png /usr/share/nginx/html/katawa-logo-header.png

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1