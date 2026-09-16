---
id: 2026-09-10-02
date: 2026-09-10
topic: eu-region-only-for-launch
status: active
tags: [infra, v1-cut]
linear:
supersedes:
---

# EU region only for launch

## Decision

Launch deploys to the **EU region only**. Multi-region comes after the first paying customers.

## Context

Terraform had placeholders for three regions and the team debated provisioning them all before launch.

## Reasoning

Every launch customer is in the EU. A second region doubles the infra bill with no user in it.

## Source

User in conversation, 2026-09-10: "EU only for now. We add regions when someone pays for them."
