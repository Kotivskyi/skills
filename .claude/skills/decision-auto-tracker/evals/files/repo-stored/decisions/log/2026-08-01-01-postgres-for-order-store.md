---
id: 2026-08-01-01
date: 2026-08-01
topic: postgres-for-order-store
status: active
tags: [storage, architecture]
linear:
supersedes:
---

# Postgres for the order store

## Decision

The order store uses **Postgres**. No document database is introduced for orders.

## Context

The order service needed a primary store before the checkout work started. Postgres and MongoDB were both on the table.

## Reasoning

The team already runs Postgres in production and the order data is relational.

## Source

User in conversation, 2026-08-01: "Postgres for orders, we know how to run it."
