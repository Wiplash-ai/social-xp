# Wiplash Labs Host

`labs.wiplash.ai` is a separate production host for small Wiplash tools and services.

- Caddy terminates HTTPS and serves static releases from `/srv/labs`.
- Social-XP is deployed to `/srv/labs/social-xp`.
- Future tools should use their own directory or reverse-proxy route under the same hostname.
- The root route redirects to `/social-xp/` until a Labs index is needed.

Deploying Social-XP requires copying `site/social-xp/` to a temporary release directory on the host, replacing `/srv/labs/social-xp`, and reloading Caddy after validating `deploy/Caddyfile`.
