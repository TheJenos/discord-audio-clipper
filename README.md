# Discord Audio Clipper

A Discord bot that joins a voice channel, keeps a rolling in-memory recording
of everyone talking, and lets anyone grab an mp3 clip of the last few minutes
on command.

This README is a quickstart. For architecture, the full audio pipeline,
every command and config option, production deployment notes, and
troubleshooting, see **[docs/GUIDE.md](docs/GUIDE.md)**.

## How it works

- `/join` connects the bot to your current voice channel. From that point on,
  it keeps a fixed-size **rolling buffer per speaker** (default: 5 minutes) of
  raw PCM audio — nothing is written to disk while recording, so the "tape"
  is always just the most recent window and never grows unbounded.
- `/clip [seconds]` mixes every speaker's buffer for the requested window
  (default and max come from your config), encodes it to mp3 via ffmpeg, and
  uploads it. The mp3 is written to the OS temp directory only for the few
  seconds it takes to encode and upload, then deleted.
- `/leave` disconnects and drops the buffers. The bot also leaves
  automatically once everyone else has left the channel — after a short grace
  period (default 10s), in case everyone just briefly dropped out.
- `/autojoin enable` / `/autojoin disable` toggles automatic joining per
  server. While on, the bot connects and starts recording on its own as soon
  as more than 3 people (configurable) are together in a voice channel — no
  need to run `/join`. `/autojoin status` shows the current settings, and
  `/autojoin exclude add|remove <channel>` keeps specific channels (like an
  AFK lobby) from ever triggering it. All of this is saved to disk, so it
  survives a bot restart.

## Setup

1. Create an application and bot at the
   [Discord Developer Portal](https://discord.com/developers/applications).
   Under **Bot**, copy the token. Under **OAuth2 → General**, copy the
   Application (Client) ID.
2. Invite the bot to your server with the `bot` and `applications.commands`
   scopes, and the **Connect** + **Speak** + **View Channel** permissions
   (Speak isn't strictly needed since the bot never talks, but some clients
   require it to fully join).
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`
   (and optionally `GUILD_ID` for instant command updates during development).
5. Build the TypeScript sources:
   ```bash
   npm run build
   ```
6. Register the slash commands:
   ```bash
   npm run deploy-commands
   ```
7. Start the bot:
   ```bash
   npm start
   ```

During development you can skip the build step and run the TypeScript
sources directly with `npm run dev` (and `npm run deploy-commands:dev` for
command registration), both powered by `ts-node`.

## Configuration

All settings live in `.env` (see `.env.example`):

| Variable                | Description                                              | Default |
|--------------------------|----------------------------------------------------------|---------|
| `DISCORD_TOKEN`          | Bot token                                                 | —       |
| `CLIENT_ID`              | Application/client ID                                     | —       |
| `GUILD_ID`               | Guild to register commands to instantly (optional)        | global  |
| `RECORD_WINDOW_SECONDS`  | How much audio to keep in the rolling buffer              | `300`   |
| `DEFAULT_CLIP_SECONDS`   | Default clip length when `/clip` is used with no argument | `300`   |
| `AUTO_JOIN_MIN_MEMBERS`  | Humans required in a channel to trigger auto-join         | `4`     |
| `LEAVE_GRACE_SECONDS`    | Delay before auto-leaving an emptied channel               | `10`    |
| `DATA_DIR`               | Where per-guild settings are persisted (JSON file)         | `./data`|

`/clip` accepts an optional `seconds` argument, capped at
`RECORD_WINDOW_SECONDS`.

Auto-join is off by default in every server; use `/autojoin enable` to turn
it on and `/autojoin disable` to turn it back off. It only kicks in while the
bot isn't already connected in that server, and skips any channel added with
`/autojoin exclude add`. These settings live in `<DATA_DIR>/settings.json`
(gitignored) and are read back on startup.

## Notes

- Written in TypeScript (source in `src/`, compiled output in `dist/`).
  `npm run build` type-checks and compiles; `npm start` runs the compiled
  output; `npm run dev` runs the sources directly via `ts-node` for quicker
  iteration.
- Voice decoding uses the pure-JS `opusscript` codec and `libsodium-wrappers`
  for encryption so the bot runs without any native build step. If you need
  better performance under heavy load, you can swap in `@discordjs/opus` and
  `sodium-native` instead — both are drop-in replacements that prism-media
  and `@discordjs/voice` will pick up automatically once installed.
- Memory usage scales with `RECORD_WINDOW_SECONDS` and the number of distinct
  speakers seen since joining (each gets their own fixed-size buffer, roughly
  `RECORD_WINDOW_SECONDS × 192 KB/s`).
- ffmpeg is bundled via `ffmpeg-static`, so no system install is required.
