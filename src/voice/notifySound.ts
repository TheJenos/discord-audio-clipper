import fs from 'node:fs';
import path from 'node:path';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  PlayerSubscription,
  StreamType,
  VoiceConnection,
  createAudioPlayer,
  createAudioResource,
} from '@discordjs/voice';

// A soft two-note chime (overlapping notes, gentle attack, exponential
// decay - deliberately not a sharp two-tone "alert" beep), pre-rendered as
// raw 48kHz/stereo/16-bit PCM - the same format the rest of the pipeline
// already uses (see ringBuffer.ts), so this goes straight through
// @discordjs/voice's built-in Opus encoder with no ffmpeg step at playback
// time. See docs/GUIDE.md's "Changing the confirmation chime" section to
// regenerate or retune it.
const SOUND_PATH = path.join(process.cwd(), 'assets', 'clip-notify.pcm');

/**
 * Plays a short confirmation chime into the voice channel so people get
 * immediate feedback that "please clip that" was heard, without waiting for the
 * clip itself to be mixed, encoded, and uploaded.
 */
export function playClipNotification(connection: VoiceConnection): void {
  let subscription: PlayerSubscription | undefined;
  try {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    const resource = createAudioResource(fs.createReadStream(SOUND_PATH), { inputType: StreamType.Raw });

    subscription = connection.subscribe(player);
    player.play(resource);

    const cleanup = () => subscription?.unsubscribe();
    player.once(AudioPlayerStatus.Idle, cleanup);
    player.once('error', (err) => {
      console.error('Failed to play clip notification sound:', err);
      cleanup();
    });
  } catch (err) {
    console.error('Failed to play clip notification sound:', err);
    subscription?.unsubscribe();
  }
}
