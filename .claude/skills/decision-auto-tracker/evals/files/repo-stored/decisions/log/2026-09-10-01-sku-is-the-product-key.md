---
id: 2026-09-10-01
date: 2026-09-10
topic: sku-is-the-product-key
status: active
tags: [glossary, catalog]
linear:
supersedes:
---

# SKU is the product key

## Decision

**SKU** is the canonical product identifier across services. Internal numeric ids are never exposed in APIs.

## Context

Two services exposed different product ids in their APIs, which broke a partner integration.

## Reasoning

Partners already key on SKU. One external key avoids a mapping table on every boundary.

## Source

User in conversation, 2026-09-10: "SKU everywhere in the API, never the db id."
