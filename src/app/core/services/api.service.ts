import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * Cliente HTTP central del frontend. Concentra la URL base, el token de sesion
 * y el manejo uniforme de respuestas/errores para que el resto de servicios no
 * repita logica de fetch.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl;
  private authToken = '';

  setAuthToken(token: string): void {
    this.authToken = token || '';
  }

  get token(): string {
    return this.authToken;
  }

  getJson<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  putJson<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  deleteJson<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  headers(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = {};

    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  isUnauthorized(error: unknown): boolean {
    return error instanceof Error && (error as Error & { status?: number }).status === 401;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const hasBody = body !== undefined;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(hasBody),
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });

    return this.readJsonResponse<T>(response);
  }

  private async readJsonResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload && typeof payload.detail === 'string' ? payload.detail : 'Error del servidor';
      const error = new Error(detail) as Error & { status: number };
      error.status = response.status;
      throw error;
    }

    return payload as T;
  }
}
