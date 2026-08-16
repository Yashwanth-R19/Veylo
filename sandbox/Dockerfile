# Sandbox Dockerfile
# ───────────────────
# Multi-stage image for running untrusted code submissions.
# Supports both Python and Node.js projects.
#
# Security: no network, memory limits, read-only root, timeout enforced by host.
# Additional host-side flags: --pids-limit, --cap-drop=ALL, --security-opt

FROM node:18-slim AS node-base
RUN npm install -g --no-cache jest mocha eslint typescript ts-node

# Final image — built on python:3.11-slim (Debian 13/trixie, glibc 2.38+).
# Node's binaries are copied in from node:18-slim (Debian 12/bookworm, glibc
# 2.36), which is ABI-safe because glibc is backward compatible: a binary
# built against an older glibc runs fine on a newer one. The reverse — this
# image previously copied Python (trixie, glibc 2.38) into an ubuntu:22.04
# final stage (glibc 2.35) — is not safe and was the cause of
# "version `GLIBC_2.38' not found" at runtime.
FROM python:3.11-slim

RUN pip install --no-cache-dir pytest flake8 pylint requests flask fastapi uvicorn

# Install git (Node itself comes from the node-base stage below)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy pre-installed global node packages from builder stage
COPY --from=node-base /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node-base /usr/local/bin /usr/local/bin

# Create non-root user for execution
RUN useradd -m -s /bin/bash sandboxuser
WORKDIR /workspace

# Copy runner script
COPY runner.sh /usr/local/bin/runner.sh
RUN chmod +x /usr/local/bin/runner.sh

USER sandboxuser

# Health check for container readiness
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD test -f /usr/local/bin/runner.sh || exit 1

ENTRYPOINT ["/usr/local/bin/runner.sh"]
