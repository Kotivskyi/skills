---
id: 2026-08-05-02
date: 2026-08-05
topic: uplink-port-12-carries-health
bucket: protocol
tags: [lorawan, protocol]
linear:
supersedes:
---

# Uplink port 12 carries the health frame

## Decision

The device health frame goes out on **FPort 12**. No other frame type uses that port.

## Context

The backend decoder registry is keyed by port, so each frame type needs a stable port.

## Reasoning

Ports 1-11 were taken by telemetry and control frames; 12 was the next free port.

## Source

User in conversation, 2026-08-05: "Health on port 12, and only health."
