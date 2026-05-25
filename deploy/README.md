# Deployment Notes

The root deployment path is intended for Railway/Railpack or Nixpacks-style Node
deploys. Keep Docker opt-in because Railway automatically switches to Docker
when it finds a root `Dockerfile`.

Use `deploy/Dockerfile` only for hosts where we explicitly choose a Docker build
and can point the platform at this non-standard Dockerfile path.

For the full operator runbook, including Railway environment variables, cron
routes, tenant onboarding, MLS provider setup, and troubleshooting, see
`docs/management/README.md`.
