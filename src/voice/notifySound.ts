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

// Raw 48kHz/stereo/16-bit PCM - the same format the rest of the pipeline
// already uses (see ringBuffer.ts), so this goes straight through
// @discordjs/voice's built-in Opus encoder with no ffmpeg step at playback
// time. Regenerate with: ffmpeg -f lavfi -i "sine=..." ... -f s16le assets/clip-notify.pcm
const SOUND_PATH = path.join(process.cwd(), 'assets', 'clip-notify.pcm');

/**
 * Plays a short confirmation chime into the voice channel so people get
 * immediate feedback that "clip that" was heard, without waiting for the
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
