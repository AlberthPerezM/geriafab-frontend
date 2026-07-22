import { Injectable } from '@angular/core';
import { MusicResult } from '../../models';
import { ApiService } from './api.service';

/**
 * Busqueda de musica contra la API de YouTube. Solo encapsula la llamada externa
 * y el mapeo de resultados; la reproduccion y el estado de UI viven en el
 * componente porque dependen del iframe del reproductor.
 */
@Injectable({ providedIn: 'root' })
export class MusicService {
  constructor(private readonly api: ApiService) {}

  async search(query: string): Promise<MusicResult[]> {
    return this.api.getJson<MusicResult[]>(`/api/youtube/search?q=${encodeURIComponent(query)}`);
  }
}
