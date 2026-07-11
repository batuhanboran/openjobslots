# Deploy — replace the openjobslots.com frontend

This app becomes the **site root**. It serves `/` (Brave-skinned home) and `/ara`
(search results, live from the backend) and transparently **proxies every other
path** — `/postings`, `/health`, `/sync/status`, `/search/*`, `/sitemap.xml`,
`/robots.txt`, `/privacy`, all mobile-app API calls — to the existing Node
backend. So the API, mobile app, and SEO keep working unchanged.

```
Internet ──▶ openjobslots.com ──▶ [ NEW: openjobslots-web :3000 ]
                                      ├─ /  /ara            → Next.js pages
                                      ├─ /api/postings      → Next route → backend
                                      └─ everything else    → proxy ↓
                                   [ openjobslots-app :8787 ]  (unchanged, internal)
                                      └─ Postgres · Meilisearch · worker
```

**The Node backend must keep running.** Do NOT stop `openjobslots-app`; it now
serves internally and the web frontend proxies to it.

## 1. Build the image (on CT100, in the repo dir)

```bash
# in the brave-clone project directory on the host
docker build \
  --build-arg OJS_API_BASE=http://openjobslots-app:8787 \
  -t openjobslots-web:3.0.0 .
```

`OJS_API_BASE` is the **internal** backend (compose service name + internal port
8787). It is baked into the fallback proxy at build time — never use the public
domain here or the root will proxy to itself.

## 2. Add the service to docker-compose.yml (same network as the app)

```yaml
  openjobslots-web:
    image: openjobslots-web:3.0.0
    container_name: openjobslots-web
    restart: unless-stopped
    environment:
      - OJS_API_BASE=http://openjobslots-app:8787
    depends_on:
      - openjobslots-app
    # expose to the reverse proxy the same way openjobslots-app was exposed,
    # e.g. host port 8090 → container 3000 (pick a free host port):
    ports:
      - "8090:3000"
```

```bash
docker compose up -d openjobslots-web
```

## 3. Repoint openjobslots.com  →  the new frontend

Whatever currently routes `openjobslots.com` to `openjobslots-app` (host :8081)
must now point to `openjobslots-web` (host :8090):

- **nginx-proxy-manager:** edit the `openjobslots.com` proxy host → Forward
  Hostname/Port → the web container (or `127.0.0.1:8090`). Save.
- **cloudflare-tunnel:** update the ingress rule for `openjobslots.com` to the
  new port, then restart the tunnel.

Do NOT expose `openjobslots-app` publicly anymore — traffic reaches it only
through the frontend's proxy.

## 4. Verify

```bash
curl -fsS https://openjobslots.com/health            # {"ok":true,...}  (proxied)
curl -fsS "https://openjobslots.com/postings?search=nurse&limit=1" | head -c 60
curl -fsSI https://openjobslots.com/                 # 200, new frontend
curl -fsS https://openjobslots.com/robots.txt | head -1
# open https://openjobslots.com — Brave-skinned home; search → /ara results
# open the mobile app — jobs still load (same /postings API through the proxy)
```

## 5. Rollback (instant)

Point the reverse proxy for `openjobslots.com` back to `openjobslots-app` (:8081).
Nothing in the backend changed, so this fully restores the previous site.

## Notes / current limits

- Results page (`/ara`) is intentionally lean vs the old App.js surface: no
  facets or sort controls yet. Search + suggestions (with intent filters) +
  region filter + load-more work.
- Language selector retranslates the whole UI live (12 languages).
- This app is separate from the `OpenJobSlots/` repo and its git-push auto-deploy
  timer; deploy it with the steps above (or wire it into its own pipeline).
