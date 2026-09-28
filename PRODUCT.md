# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (landing page) · the product itself is a Windows desktop app (Electron)

## Stack

Landing page: plain static HTML/CSS/JS in `site/`, no build step, deployable to any static host. App: Electron, packaged as a Windows `.exe`.

## Users

Developers who run AI coding agents (Codex CLI, the Codex desktop app, Claude Code, t3code), often several at once across several projects. They want to know at a glance which agent is working, which is stuck, which needs their approval, and which is done, without babysitting terminals.

## Product Purpose

Roombai is a free, always-on-top pixel-art agent watcher for your desktop. Every running agent is a roomba in a messy little room. More work makes more mess, and finished work lets the roombas clean up. It alerts you when an agent is stuck, needs you, or finishes. Success is: you stop alt-tabbing to check on agents, and checking on them is effortless.

## Positioning

It's a watcher, not a control center. It reads the session logs your agents already write, so there is nothing to configure. Each project gets its own generated room, and a Garage holds everything. It has personality: you can throw roombas at the ceiling, make them wear socks, and drop them on wrecked furniture so they scrub it clean.

## Capabilities (confirmed, shipped)

- Zero-setup watching of Codex (CLI, Codex app, t3code) and Claude Code sessions
- Statuses: working, needs you, stuck, done, napping; notifications and chiptune alerts
- Activity makes mess (deliveries per message, scraps per tool call), and idle roombas clean
- Furniture gets dirty and then wrecked; roombas scrub pieces they're placed on
- One generated room per project, plus the Garage; mess is saved per room
- Three-sided whiteboard: TODO (agents plus your notes), ISSUES, and PRS from GitHub via `gh`
- "Jump to it" opens t3code, the Codex app or VS Code, or copies a resume command
- Drag it anywhere on any monitor; recharge station for shooed roombas

## Constraints

- Free. No pricing, no accounts.
- Read-only toward agents. It never sends anything to them.
- No invented testimonials, user counts or benchmarks.

## Monetization (open)

Sponsor slots ("Your company here") on the landing page, laid out as a pyramid (1, 2, 3, 4, 5 slots). No sponsors are confirmed yet.
