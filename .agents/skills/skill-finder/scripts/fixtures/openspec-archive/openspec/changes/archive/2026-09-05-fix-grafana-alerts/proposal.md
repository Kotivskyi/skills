# Proposal: Fix Grafana alerts

## Why

Alerts fire twice for one outage. The webhook uses Bearer abc.def-123456 in plain text.

## What Changes

- Deduplicate the alert rules.
- Move the webhook token to the secret store.
