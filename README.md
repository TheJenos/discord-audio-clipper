# Discord Audio Clipper

A Discord bot that joins a voice channel, keeps a rolling in-memory recording
of everyone talking, and lets anyone grab an mp3 clip of the last few minutes
on command.

This README is a quickstart. For architecture, the full audio pipeline,
every command and config option, production deployment notes, and
troubleshooting, see **[docs/GUIDE.md](docs/GUIDE.md)**.

## How it works

- `/join` connects the bot to your current voice channel. From that point on,
  it keeps **one fixed-size rolling buffer for the whole channel** (default:
  5 minutes, and never more than that) of already-mixed PCM audio — everyone
  is summed into the same stream as they speak, and anything older than the
  window is overwritten as new audio comes in. Nothing is written to disk
  while recording, so the "tape" is always just the most recent window and
  never grows unbounded.
- `/clip [seconds]` reads the requested window out of that buffer (default
  and max come from your config), encodes it to mp3 via ffmpeg, and uploads
  it. The mp3 is written to the OS temp directory only for the few seconds it
  takes to encode and upload, then deleted.
- `/leave` disconnects and drops the buffer. The bot also leaves
  automatically once everyone else has left the channel — after a short grace
  period (default 10s), in case everyone just briefly dropped out.
- `/autojoin enable` / `/autojoin disable` toggles automatic joining per
  server. While on, the bot connects and starts recording on its own as soon
  as more than 3 people (configurable) are together in a voice channel — no
  need to run `/join`. `/autojoin status` shows the current settings, and
  `/autojoin exclude add|remove <channel>` keeps specific channels (like an
  AFK lobby) from ever triggering it. All of this is saved to disk, so it
  survives a bot restart.
- `/voiceclip enable` / `/voiceclip disable` turns on saying **"please clip that"**
  out loud to grab a clip hands-free — the bot plays a short chime into the
  voice channel to confirm it heard you, then posts the last 30 seconds
  (configurable) to `/voiceclip channel set <channel>` if you've set one, or
  the voice channel's own text chat otherwise. Detection runs on a free,
  fully offline [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
  keyword-spotting model — no account, API key, or per-use cost, but it
  needs a one-time setup step by whoever runs the bot — see
  [docs/GUIDE.md](docs/GUIDE.md#6-voiceclip-clip-that-setup).

## Setup

1. Create an application and bot at the
   [Discord Developer Portal](https://discord.com/developers/applications).
   Under **Bot**, copy the token. Under **OAuth2 → General**, copy the
   Application (Client) ID.
2. Invite the bot to your server with the `bot` and `applications.commands`
   scopes, and the **Connect** + **Speak** + **View Channel** permissions.
   Speak is used for the short "heard you" chime `/voiceclip` plays back —
   without it, everything else still works, you just lose that audio cue.
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
| `RECORD_WINDOW_SECONDS`  | How much audio to keep in the rolling buffer (max `300`)  | `300`   |
| `DEFAULT_CLIP_SECONDS`   | Default clip length when `/clip` is used with no argument | `300`   |
| `AUTO_JOIN_MIN_MEMBERS`  | Humans required in a channel to trigger auto-join         | `4`     |
| `LEAVE_GRACE_SECONDS`    | Delay before auto-leaving an emptied channel               | `10`    |
| `DATA_DIR`               | Where per-guild settings are persisted (JSON file)         | `./data`|
| `KWS_ENCODER_PATH`, `KWS_DECODER_PATH`, `KWS_JOINER_PATH`, `KWS_TOKENS_PATH` | Paths to the sherpa-onnx keyword-spotting model's files, required for `/voiceclip` | — |
| `KWS_KEYWORDS_PATH`      | Path to the generated "please clip that" keywords file, required for `/voiceclip` | — |
| `KWS_SCORE`, `KWS_THRESHOLD` | Optional overrides for detection sensitivity          | *(from file)* |
| `WAKE_WORD_CLIP_SECONDS` | How many seconds "please clip that" grabs                         | `30`    |
| `ASR_ENCODER_PATH`, `ASR_DECODER_PATH`, `ASR_TOKENS_PATH` | Paths to an offline sherpa-onnx Whisper model, for an optional second trigger check by transcription instead of keyword spotting | — |
| `WAKE_WORD_PHRASES`      | Comma-separated trigger phrases the transcription check matches   | `please clip that` |
| `VERBOSE` (or `--verbose`) | Logs every transcript the transcription check produces, not just ones that match a trigger phrase | off |

`/clip` accepts an optional `seconds` argument, capped at
`RECORD_WINDOW_SECONDS`.

Auto-join is off by default in every server; use `/autojoin enable` to turn
it on and `/autojoin disable` to turn it back off. It only kicks in while the
bot isn't already connected in that server, and skips any channel added with
`/autojoin exclude add`. These settings live in `<DATA_DIR>/settings.json`
(gitignored) and are read back on startup.

`/voiceclip` behaves the same way, but `/voiceclip enable` refuses to turn on
until all five `KWS_*` paths (or all three `ASR_*` paths) are set. Run
`npm run setup-voiceclip` to fetch the free KWS model, generate a "please
clip that" keywords file, and write those paths into `.env` automatically.
The `ASR_*` transcription check is optional and independent of KWS — either
one detecting the phrase triggers a clip — and can be set up the same way
with `npm run setup-voiceclip -- --with-asr`. See
[docs/GUIDE.md](docs/GUIDE.md#6-voiceclip-clip-that-setup) for details and
manual steps for both.

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
- Memory usage scales with `RECORD_WINDOW_SECONDS` only — one buffer per
  guild, roughly `RECORD_WINDOW_SECONDS × 192 KB/s`, no matter how many
  people are talking.
- ffmpeg is bundled via `ffmpeg-static`, so no system install is required.
