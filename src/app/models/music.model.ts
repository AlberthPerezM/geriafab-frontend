// Tipos de la función de música: resultados de YouTube y comandos de voz.

export type MusicResult = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
};

export type YouTubeSearchResponse = {
  items: Array<{
    id: { videoId: string };
    snippet: {
      title: string;
      channelTitle: string;
      thumbnails: {
        default?: { url: string };
        medium?: { url: string };
      };
    };
  }>;
};

export type MusicCommand =
  | { type: 'stop' }
  | { type: 'first' }
  | { type: 'next' }
  | { type: 'play'; index: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'volumeUp' }
  | { type: 'volumeDown' }
  | { type: 'mute' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'search'; query: string };
