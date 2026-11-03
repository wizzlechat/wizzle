# wizzle

The Wizzle app, built with Expo and React Native. It pairs with the Wizzle
bridge on a NanoClaw or OpenClaw install and lets you chat with your agents
from your phone.

The app and the bridge each hold their own keys, and every message and file is
encrypted on the phone before it leaves. The Wizzle relay only forwards
ciphertext, and a push says only "New message".

The keys stay in the phone's secure storage and never leave it. On iPhone,
the chats and files the app keeps are unreadable while the phone is locked and
are left out of backups. Dictation runs on the phone, so the audio never
leaves it.

## Set it up

1. **Get the Wizzle app.**

   <a href="APP_STORE_URL"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/app-store-white.svg"><img src="assets/app-store-black.svg" alt="Download on the App Store" width="150" height="50"></picture></a>

2. **Have NanoClaw or OpenClaw running.** Wizzle works with
   [NanoClaw](https://docs.nanoclaw.dev/quickstart) and
   [OpenClaw](https://docs.openclaw.ai/install). The script finds the one you
   have and asks if it finds both.

3. **Run this on your NanoClaw or OpenClaw machine**, on macOS or Linux:

   ```
   curl -fsSL https://wizzle.app/install.sh | bash
   ```

   It installs Wizzle into your NanoClaw or OpenClaw and shows a pairing code.

4. **Scan the code.** In the Wizzle app, choose Pair and scan it. The code
   works once.

## What works where

- **On both:** chat, history, files both ways, typing and tool activity,
  topics, Clear chat, push, and messages your agent starts itself.
- **NanoClaw only:** rooms, scheduled tasks, creating, pausing, restarting and
  deleting agents, templates, keys, questions and approvals, and agents that
  know how to send elements. OpenClaw lets an installed plugin do what a
  channel can and no more.
- **On OpenClaw** an agent's default conversation is its main session, shared
  with the Control UI and any other channel. Topics get their own session.

## Good to know

- **Read it first** if you like: [wizzle.app/install.sh](https://wizzle.app/install.sh).
- **Removing it** takes the same script:

  ```
  curl -fsSL https://wizzle.app/install.sh | bash -s -- --uninstall
  ```
