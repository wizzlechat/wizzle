# wizzle

**A chat app for your own AI agents.**

<a href="https://wizzle.app"><img src="assets/header-dark.svg" alt="Wizzle characters"></a>

Message the agents running on your NanoClaw or OpenClaw, send them photos and
documents, or talk instead of typing.

Every conversation is end to end encrypted between your phone and your agents.
We can't read your messages, and neither can anyone in between.

## Features

- **A chat for every agent**: each agent has its own chat, with its full
  history.
- **Photos and documents**: send them to your agents and get files back.
- **Talk instead of typing**: dictation runs on your phone.
- **See it work**: watch when an agent is typing and what it is doing.
- **Topics**: start extra chats with an agent, each with its own history and
  context.
- **Clear chat**: wipe a chat and start fresh.
- **Notifications**: know when an agent replies, even when the app is closed.
- **Agents that reach out**: hear from an agent when it has something to tell
  you, not only when you ask.

With NanoClaw you also get:

- **Rooms**: one chat with several agents. Name one with @ and it answers, and
  they hand work to each other.
- **Questions and approvals**: an agent stops to ask you something, or asks
  before it takes an action.
- **Scheduled tasks**: see what your agents do on a schedule, and run, pause or
  resume it.
- **Manage your agents**: create agents from templates, and pause, restart or
  delete them.
- **Keys**: save API keys on your NanoClaw machine and choose which agents can
  use them.
- **Interactive screens**: agents can send flash cards to flip, a deck to swipe
  through or a report, drawn as its own screen in the app.
- **Updates from the app**: when a new version of Wizzle is out for your
  NanoClaw, install it from the app.

## Set it up

1. **Get the Wizzle app.** Wizzle is currently available by invite only for
   testing.

   <a href="APP_STORE_URL"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/app-store-white.svg"><img src="assets/app-store-black.svg" alt="Download on the App Store" width="150" height="50"></picture></a>

2. **Have NanoClaw or OpenClaw running.** Wizzle works with
   [NanoClaw](https://docs.nanoclaw.dev/quickstart) and
   [OpenClaw](https://docs.openclaw.ai/install).

3. **Run this on that machine**, on macOS or Linux:

   ```bash
   curl -fsSL https://wizzle.app/install.sh | bash
   ```

   It installs Wizzle and shows a pairing code. If you have both, it asks which
   one to use.

4. **Scan the code.** In the Wizzle app, choose Pair and scan it. The code
   works once.

## Good to know

- **Read it first** if you like: [wizzle.app/install.sh](https://wizzle.app/install.sh).
- **Removing it** takes the same script:

  ```bash
  curl -fsSL https://wizzle.app/install.sh | bash -s -- --uninstall
  ```
