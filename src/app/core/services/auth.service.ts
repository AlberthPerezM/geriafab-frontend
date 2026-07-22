import { Injectable } from '@angular/core';
import { AuthUser } from '../../models';
import { ApiService } from './api.service';

/**
 * Estado y operaciones de autenticacion: usuario/token en memoria, persistencia
 * en localStorage y llamadas al backend. El token se propaga al ApiService para
 * que todas las peticiones salgan autenticadas.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionKey = 'geriafab_auth_session';
  private readonly tokenKey = 'geriafab_auth_token';

  user: AuthUser | null = null;
  token = '';

  constructor(private readonly api: ApiService) {}

  get isAuthenticated(): boolean {
    return this.user !== null;
  }

  /** Carga sesion/token guardados en el navegador (sin validar contra backend). */
  loadStored(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    this.token = localStorage.getItem(this.tokenKey) || '';
    this.api.setAuthToken(this.token);

    const savedSession = localStorage.getItem(this.sessionKey);
    if (!savedSession) {
      return;
    }

    try {
      this.user = JSON.parse(savedSession) as AuthUser;
    } catch {
      localStorage.removeItem(this.sessionKey);
      this.user = null;
    }
  }

  fetchCurrentUser(): Promise<{ user: AuthUser }> {
    return this.api.getJson<{ user: AuthUser }>('/api/auth/me');
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const session = await this.api.postJson<{ token: string; user: AuthUser }>(
      '/api/auth/login',
      { email, password },
    );
    this.setSession(session.user, session.token);
    return session.user;
  }

  async register(name: string, email: string, password: string): Promise<AuthUser> {
    const session = await this.api.postJson<{ token: string; user: AuthUser }>(
      '/api/auth/register',
      { name, email, password },
    );
    this.setSession(session.user, session.token);
    return session.user;
  }

  async loginWithGoogle(credential: string): Promise<AuthUser> {
    const session = await this.api.postJson<{ token: string; user: AuthUser }>(
      '/api/auth/google',
      { credential },
    );
    this.setSession(session.user, session.token);
    return session.user;
  }

  logout(): void {
    if (this.token) {
      void this.api.postJson('/api/auth/logout', {}).catch((error) => {
        console.error('No se pudo cerrar la sesion en backend', error);
      });
    }
    this.clearSession();
  }

  setSession(user: AuthUser, token = ''): void {
    this.user = user;
    this.token = token;
    this.api.setAuthToken(token);

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.sessionKey, JSON.stringify(user));
      if (token) {
        localStorage.setItem(this.tokenKey, token);
      }
    }
  }

  clearSession(): void {
    this.user = null;
    this.token = '';
    this.api.setAuthToken('');

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.sessionKey);
      localStorage.removeItem(this.tokenKey);
    }
  }
}
