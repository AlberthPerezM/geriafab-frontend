import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { MusicResult, YouTubeSearchResponse } from '../../models';

/**
 * Busqueda de musica contra la API de YouTube. Solo encapsula la llamada externa
 * y el mapeo de resultados; la reproduccion y el estado de UI viven en el
 * componente porque dependen del iframe del reproductor.
 */
@Injectable({ providedIn: 'root' })
export class MusicService {
  private readonly apiKey = environment.youtubeApiKey;

  async search(query: string): Promise<MusicResult[]> {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet` +
      `&q=${encodeURIComponent(query)}&type=video&key=${this.apiKey}` +
      `&maxResults=8&relevanceLanguage=es`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('No se pudo buscar musica. Intenta de nuevo.');
    }

    const data = (await response.json()) as YouTubeSearchResponse;
    return (data.items ?? [])
      .filter((item) => item?.id?.videoId)
      .map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
      }));
  }
}
