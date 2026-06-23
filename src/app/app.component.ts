import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../environments/environment';

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous?: boolean;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onaudioend?: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionEventLike = {
  results: {
    length: number;
    [index: number]: {
      isFinal?: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type RecognitionPurpose = 'conversation' | 'interruption';

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentity = {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme: string;
      size: string;
      shape: string;
      width?: number;
      text?: string;
    },
  ) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdentity;
      };
    };
  }
}

type EmergencyContact = {
  name: string;
  relationship: string;
  phone: string;
};

type Medication = {
  name: string;
  schedule: string;
  colorOrShape: string;
};

type AuthMode = 'login' | 'registro';

type AuthForm = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type AuthUser = {
  id?: number;
  name: string;
  email: string;
  provider: 'email' | 'google';
};

type SeniorProfile = {
  personName: string;
  nickname: string;
  mobilityLevel: string;
  positivityState: 'alto' | 'medio' | 'bajo' | '';
  generalMood: string;
  particularity: string;
  mobilityDetails: string;
  hasPreexistingDisease: boolean;
  preexistingDisease: string;
  requiresMedication: boolean;
  medications: Medication[];
  wakeTime: string;
  sleepTime: string;
  mainRoom: string;
  favoriteColor: string;
  favoriteTheme: string;
  dailyActivities: string;
  weeklyActivities: string;
  happinessTriggers: string;
  relaxationTriggers: string;
  sadnessTriggers: string;
  annoyanceTriggers: string;
  caregiverNotes: string;
  seniorNotes: string;
  emergencyContacts: EmergencyContact[];
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewInit {
  @ViewChild('googleButton') private googleButton?: ElementRef<HTMLDivElement>;

  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly apiUrl = `${this.apiBaseUrl}/api/gemini`;
  private readonly profileStorageKey = 'geriafab_senior_profile';
  private readonly authSessionStorageKey = 'geriafab_auth_session';
  private readonly authTokenStorageKey = 'geriafab_auth_token';
  private recognition: SpeechRecognitionInstance | null = null;
  private listenIgnoreUntil = 0;
  private speechInterrupted = false;
  private pauseTimer: number | null = null;
  private recognitionRestartTimer: number | null = null;
  private interruptionDetectionTimer: number | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  recognizing = false;
  isSpeaking = false;
  isThinking = false;
  conversationEnabled = false;
  assistantSpeechPhase: 'idle' | 'started' | 'paused' | 'ended' | 'interrupted' = 'idle';
  userSpeechPhase: 'idle' | 'speaking' | 'paused' | 'ended' | 'interrupted' = 'idle';
  status = 'microfono apagado';
  transcript = '';
  reply = '';
  showCaptions = true;
  selectedPanel: 'transcript' | 'music' = 'transcript';
  selectedView: 'registro' | 'asistente' = 'asistente';
  settingsOpen = false;
  settingsUnlockOpen = false;
  settingsPassword = '';
  settingsUnlockMessage = '';
  currentProfileStep = 0;
  readonly profileSteps = [
    'Datos',
    'Salud',
    'Preferencias',
    'Notas',
    'Emergencia',
    'Riesgos',
  ];
  profileSaved = false;
  musicResults: Array<{ title: string; artist: string }> = [];
  profile: SeniorProfile = this.createEmptyProfile();
  authMode: AuthMode = 'login';
  authMessage = '';
  authUser: AuthUser | null = null;
  authToken = '';
  googleClientIdConfigured = false;
  private googleButtonRendered = false;
  authForm: AuthForm = {
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  };

  constructor() {
    this.loadAuthSession();
    void this.restoreSession();
  }

  ngAfterViewInit(): void {
    void this.renderGoogleButton();
  }

  get isAuthenticated(): boolean {
    return this.authUser !== null;
  }

  public get showDuplicateEmailRecovery(): boolean {
    const normalizedMessage = this.authMessage
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return this.authMode === 'registro' && normalizedMessage.includes('correo ya esta registrado');
  }

  setAuthMode(mode: AuthMode): void {
    this.authMode = mode;
    this.authMessage = '';
    this.authForm.password = '';
    this.authForm.confirmPassword = '';
  }

  public switchToLoginWithCurrentEmail(): void {
    const email = this.authForm.email;
    this.setAuthMode('login');
    this.authForm.email = email;
    this.authMessage = 'Ingresa tu contrasena para continuar con ese correo.';
  }

  submitAuth(): void {
    if (this.authMode === 'login') {
      void this.loginWithEmail();
      return;
    }

    void this.registerWithEmail();
  }

  async signInWithGoogle(): Promise<void> {
    const clientId = this.googleClientId;
    if (!clientId) {
      this.authMessage = 'Configura el Client ID de Google para activar esta opcion.';
      return;
    }

    try {
      await this.loadGoogleIdentityScript();
      await this.renderGoogleButton();
    } catch (error) {
      this.authMessage = this.errorMessage(error, 'No se pudo cargar Google Login.');
    }
  }

  logout(): void {
    if (this.authToken) {
      void this.postJson('/api/auth/logout', {}).catch((error) => {
        console.error('No se pudo cerrar la sesion en backend', error);
      });
    }

    this.authUser = null;
    this.authToken = '';
    this.authMessage = '';
    this.authForm.password = '';
    this.authForm.confirmPassword = '';

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.authSessionStorageKey);
      localStorage.removeItem(this.authTokenStorageKey);
    }
  }

  setView(view: 'registro' | 'asistente'): void {
    this.selectedView = view;
  }

  requestSettingsAccess(): void {
    this.settingsPassword = '';
    this.settingsUnlockMessage = '';
    this.settingsUnlockOpen = true;
  }

  cancelSettingsAccess(): void {
    this.settingsPassword = '';
    this.settingsUnlockMessage = '';
    this.settingsUnlockOpen = false;
  }

  async unlockSettings(): Promise<void> {
    const email = this.authUser?.email || '';
    const password = this.settingsPassword;

    if (!email || !password) {
      this.settingsUnlockMessage = 'Ingresa la contrasena del apoderado.';
      return;
    }

    try {
      await this.postJson('/api/auth/login', { email, password });
      this.cancelSettingsAccess();
      this.openSettings();
    } catch (error) {
      this.settingsUnlockMessage = this.errorMessage(error, 'Contrasena incorrecta.');
    }
  }

  openSettings(): void {
    this.currentProfileStep = 0;
    this.profileSaved = false;
    this.settingsOpen = true;
    this.selectedView = 'registro';
  }

  startPersonalization(): void {
    this.currentProfileStep = 0;
    this.profileSaved = false;
    this.settingsOpen = true;
    this.selectedView = 'registro';
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.selectedView = 'asistente';
  }

  goToProfileStep(index: number): void {
    this.currentProfileStep = Math.min(Math.max(index, 0), this.profileSteps.length - 1);
  }

  nextProfileStep(): void {
    this.goToProfileStep(this.currentProfileStep + 1);
  }

  previousProfileStep(): void {
    this.goToProfileStep(this.currentProfileStep - 1);
  }

  get isFirstProfileStep(): boolean {
    return this.currentProfileStep === 0;
  }

  get isLastProfileStep(): boolean {
    return this.currentProfileStep === this.profileSteps.length - 1;
  }

  addMedication(): void {
    this.profile.medications.push({ name: '', schedule: '', colorOrShape: '' });
    this.profileSaved = false;
  }

  removeMedication(index: number): void {
    if (this.profile.medications.length <= 1) {
      this.profile.medications[0] = { name: '', schedule: '', colorOrShape: '' };
      return;
    }

    this.profile.medications.splice(index, 1);
    this.profileSaved = false;
  }

  addEmergencyContact(): void {
    this.profile.emergencyContacts.push({ name: '', relationship: '', phone: '' });
    this.profileSaved = false;
  }

  removeEmergencyContact(index: number): void {
    if (this.profile.emergencyContacts.length <= 2) {
      this.profile.emergencyContacts[index] = { name: '', relationship: '', phone: '' };
      return;
    }

    this.profile.emergencyContacts.splice(index, 1);
    this.profileSaved = false;
  }

  async saveProfile(): Promise<void> {
    this.saveProfileLocally();

    if (!this.authToken) {
      this.profileSaved = true;
      this.closeSettings();
      return;
    }

    try {
      await this.postJson('/api/profile', { profile: this.profile });
      this.profileSaved = true;
    } catch (error) {
      console.error('No se pudo guardar el perfil en backend', error);
      this.profileSaved = true;
    }

    this.closeSettings();
  }

  resetProfile(): void {
    this.profile = this.createEmptyProfile();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.profileStorageKey);
    }
    this.profileSaved = false;
  }

  private async loadProfile(): Promise<void> {
    if (this.authToken) {
      try {
        const response = await this.getJson<{ profile: SeniorProfile | null }>('/api/profile');
        if (response.profile) {
          this.profile = {
            ...this.createEmptyProfile(),
            ...response.profile,
          };
          this.ensureMinimumRows();
          this.saveProfileLocally();
          return;
        }
      } catch (error) {
        console.error('No se pudo cargar el perfil desde backend', error);
      }
    }

    if (typeof localStorage === 'undefined') {
      return;
    }
    const savedProfile = localStorage.getItem(this.profileStorageKey);

    if (!savedProfile) {
      return;
    }

    try {
      this.profile = {
        ...this.createEmptyProfile(),
        ...JSON.parse(savedProfile),
      };
      this.ensureMinimumRows();
    } catch {
      this.profile = this.createEmptyProfile();
    }
  }

  private loadAuthSession(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    this.authToken = localStorage.getItem(this.authTokenStorageKey) || '';
    const savedSession = localStorage.getItem(this.authSessionStorageKey);
    if (!savedSession) {
      return;
    }

    try {
      this.authUser = JSON.parse(savedSession) as AuthUser;
    } catch {
      localStorage.removeItem(this.authSessionStorageKey);
      this.authUser = null;
    }
  }

  private async restoreSession(): Promise<void> {
    if (!this.authToken) {
      this.clearAuthSession();
      await this.loadProfile();
      return;
    }

    try {
      const session = await this.getJson<{ user: AuthUser }>('/api/auth/me');
      this.setAuthSession(session.user, this.authToken);
      await this.loadProfile();
    } catch {
      this.clearAuthSession();
      await this.loadProfile();
    }
  }

  private get googleClientId(): string {
    if (typeof document === 'undefined') {
      return '';
    }

    return document.querySelector<HTMLMetaElement>('meta[name="google-client-id"]')?.content.trim() || '';
  }

  private async renderGoogleButton(): Promise<void> {
    const clientId = this.googleClientId;
    this.googleClientIdConfigured = Boolean(clientId);
    if (!clientId || this.googleButtonRendered || !this.googleButton?.nativeElement) {
      return;
    }

    await this.loadGoogleIdentityScript();
    const googleIdentity = window.google?.accounts?.id;
    if (!googleIdentity) {
      throw new Error('Google Identity Services no esta disponible');
    }

    googleIdentity.initialize({
      client_id: clientId,
      callback: (response) => void this.handleGoogleCredential(response),
    });
    googleIdentity.renderButton(this.googleButton.nativeElement, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      width: 320,
      text: 'continue_with',
    });
    this.googleButtonRendered = true;
  }

  private loadGoogleIdentityScript(): Promise<void> {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('Google Login solo esta disponible en navegador'));
    }
    if (window.google?.accounts?.id) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('No se pudo cargar Google Login')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar Google Login'));
      document.head.appendChild(script);
    });
  }

  private async handleGoogleCredential(response: GoogleCredentialResponse): Promise<void> {
    if (!response.credential) {
      this.authMessage = 'Google no devolvio una credencial valida.';
      return;
    }

    try {
      const session = await this.postJson<{ token: string; user: AuthUser }>('/api/auth/google', {
        credential: response.credential,
      });
      this.setAuthSession(session.user, session.token);
      this.authMessage = 'Sesion iniciada con Google.';
      await this.loadProfile();
    } catch (error) {
      this.authMessage = this.errorMessage(error, 'No se pudo iniciar sesion con Google.');
    }
  }

  private async loginWithEmail(): Promise<void> {
    const email = this.authForm.email.trim().toLowerCase();
    const password = this.authForm.password;

    if (!email || !password) {
      this.authMessage = 'Ingresa correo y contrasena.';
      return;
    }

    try {
      const session = await this.postJson<{ token: string; user: AuthUser }>('/api/auth/login', { email, password });
      this.setAuthSession(session.user, session.token);
      this.authMessage = 'Sesion iniciada.';
      await this.loadProfile();
    } catch (error) {
      this.authMessage = this.errorMessage(error, 'Correo o contrasena incorrectos.');
    }
  }

  private async registerWithEmail(): Promise<void> {
    const name = this.authForm.name.trim();
    const email = this.authForm.email.trim().toLowerCase();
    const password = this.authForm.password;

    if (!name || !email || !password) {
      this.authMessage = 'Completa nombre, correo y contrasena.';
      return;
    }

    if (password.length < 6) {
      this.authMessage = 'La contrasena debe tener al menos 6 caracteres.';
      return;
    }

    if (password !== this.authForm.confirmPassword) {
      this.authMessage = 'Las contrasenas no coinciden.';
      return;
    }

    try {
      const session = await this.postJson<{ token: string; user: AuthUser }>('/api/auth/register', { name, email, password });
      this.setAuthSession(session.user, session.token);
      this.authMessage = 'Cuenta creada. Personaliza la ficha del adulto mayor.';
      this.startPersonalization();
    } catch (error) {
      this.authMessage = this.errorMessage(error, 'No se pudo crear el registro.');
    }
  }

  private setAuthSession(user: AuthUser, token = ''): void {
    this.authUser = user;
    this.authToken = token;

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.authSessionStorageKey, JSON.stringify(user));
      if (token) {
        localStorage.setItem(this.authTokenStorageKey, token);
      }
    }
  }

  private clearAuthSession(): void {
    this.authUser = null;
    this.authToken = '';

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.authSessionStorageKey);
      localStorage.removeItem(this.authTokenStorageKey);
    }
  }

  private saveProfileLocally(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(this.profileStorageKey, JSON.stringify(this.profile));
  }

  private async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: this.apiHeaders(),
      body: JSON.stringify(body),
    });

    return this.readJsonResponse<T>(response);
  }

  private async getJson<T = unknown>(path: string): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: 'GET',
      headers: this.apiHeaders(false),
    });

    return this.readJsonResponse<T>(response);
  }

  private apiHeaders(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = {};

    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  private async readJsonResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload && typeof payload.detail === 'string' ? payload.detail : 'Error del servidor';
      throw new Error(detail);
    }

    return payload as T;
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  private ensureMinimumRows(): void {
    if (!Array.isArray(this.profile.medications) || this.profile.medications.length === 0) {
      this.profile.medications = [{ name: '', schedule: '', colorOrShape: '' }];
    }

    if (!Array.isArray(this.profile.emergencyContacts)) {
      this.profile.emergencyContacts = [];
    }

    while (this.profile.emergencyContacts.length < 2) {
      this.profile.emergencyContacts.push({ name: '', relationship: '', phone: '' });
    }
  }

  private createEmptyProfile(): SeniorProfile {
    return {
      personName: '',
      nickname: '',
      mobilityLevel: '',
      positivityState: '',
      generalMood: '',
      particularity: '',
      mobilityDetails: '',
      hasPreexistingDisease: false,
      preexistingDisease: '',
      requiresMedication: false,
      medications: [{ name: '', schedule: '', colorOrShape: '' }],
      wakeTime: '',
      sleepTime: '',
      mainRoom: '',
      favoriteColor: '',
      favoriteTheme: '',
      dailyActivities: '',
      weeklyActivities: '',
      happinessTriggers: '',
      relaxationTriggers: '',
      sadnessTriggers: '',
      annoyanceTriggers: '',
      caregiverNotes: '',
      seniorNotes: '',
      emergencyContacts: [
        { name: '', relationship: '', phone: '' },
        { name: '', relationship: '', phone: '' },
      ],
    };
  }

  setPanel(panel: 'transcript' | 'music'): void {
    this.selectedPanel = panel;
    if (panel === 'music') {
      this.musicResults = [];
    }
  }

  searchMusic(query: string): void {
    const q = (query || '').trim();
    if (!q) {
      this.musicResults = [];
      return;
    }

    this.musicResults = [
      { title: `${q} (Single)`, artist: 'Artista Ejemplo' },
      { title: `${q} - Remix`, artist: 'DJ Demo' },
      { title: `Live ${q}`, artist: 'Banda Demo' }
    ];
  }

  toggleListening(): void {
    if (this.isSpeaking) {
      this.conversationEnabled = true;
      this.userSpeechPhase = 'interrupted';
      this.interruptSpeech();
      setTimeout(() => this.startRecognition(), 120);
      return;
    }

    if (this.conversationEnabled || this.recognizing) {
      this.conversationEnabled = false;
      this.clearRecognitionRestart();
      this.clearInterruptionDetection();
      this.stopRecognition();
      return;
    }

    this.conversationEnabled = true;
    this.userSpeechPhase = 'idle';
    this.startRecognition();
  }

  private startRecognition(purpose: RecognitionPurpose = 'conversation'): void {
    if (purpose === 'conversation') {
      this.clearRecognitionRestart();
    }

    if (
      !this.conversationEnabled ||
      this.isThinking ||
      (purpose === 'conversation' && this.isSpeaking) ||
      (purpose === 'interruption' && !this.isSpeaking)
    ) {
      return;
    }

    if (this.recognizing) {
      return;
    }

    try {
      this.recognition = this.createRecognition(purpose);

      if (!this.recognition) {
        this.reply = 'Tu navegador no soporta reconocimiento de voz.';
        this.conversationEnabled = false;
        this.status = 'microfono apagado';
        return;
      }

      this.recognition.start();
      this.recognizing = true;
      this.status = purpose === 'interruption' ? 'asistente hablando' : 'escuchando';
    } catch (e) {
      console.error('No se pudo iniciar reconocimiento', e);
      this.recognizing = false;
      this.recognition = null;
      this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
      this.scheduleRecognitionRestart(350);
    }
  }

  private createRecognition(purpose: RecognitionPurpose): SpeechRecognitionInstance | null {
    const windowWithSpeech = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition =
      windowWithSpeech.SpeechRecognition ?? windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onspeechstart = () => this.handleUserSpeechStart();
    recognition.onspeechend = () => this.handleUserSpeechPause();
    recognition.onaudioend = () => this.handleUserSpeechEnd();
    recognition.onresult = (event) => {
      if (Date.now() < this.listenIgnoreUntil) {
        return;
      }

      if (purpose === 'interruption') {
        this.handleUserSpeechStart();
        return;
      }

      if (this.isSpeaking) {
        return;
      }

      const result = event.results[event.results.length - 1];
      if (result.isFinal === false) {
        this.handleUserSpeechStart();
        return;
      }

      const text = result[0].transcript.trim();
      if (!text) {
        return;
      }

      this.handleUserSpeechEnd();
      this.transcript = text;
      this.isThinking = true;
      this.status = 'pensando';
      this.stopRecognition(false);
      void this.sendPromptToBackend(text);
    };
    recognition.onend = () => {
      this.recognizing = false;
      if (this.recognition === recognition) {
        this.recognition = null;
      }

      if (purpose === 'interruption') {
        if (this.conversationEnabled && this.isSpeaking) {
          this.status = 'asistente hablando';
          this.startInterruptionDetection(250);
          return;
        }

        if (this.conversationEnabled && !this.isThinking) {
          this.scheduleRecognitionRestart(250);
        }
        return;
      }

      if (this.conversationEnabled && !this.isSpeaking && !this.isThinking) {
        this.status = 'escuchando';
        this.scheduleRecognitionRestart(250);
        return;
      }

      if (this.isSpeaking) {
        this.status = 'hablando';
        return;
      }

      this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
    };
    recognition.onerror = (event) => {
      const error = (event as { error?: string }).error ?? '';
      if (error !== 'no-speech' && error !== 'aborted') {
        console.error('Recognition error', event);
      }
      this.recognizing = false;
      if (this.recognition === recognition) {
        this.recognition = null;
      }

      if (purpose === 'interruption') {
        if (this.conversationEnabled && this.isSpeaking) {
          this.status = 'asistente hablando';
          return;
        }

        if (this.conversationEnabled && !this.isThinking) {
          this.scheduleRecognitionRestart(350);
        }
        return;
      }

      if (this.conversationEnabled && !this.isSpeaking && !this.isThinking) {
        this.status = error === 'no-speech' ? 'listo para escuchar' : 'escuchando';
        this.scheduleRecognitionRestart(error === 'no-speech' ? 900 : 500);
        return;
      }

      if (this.isSpeaking) {
        this.status = 'hablando';
        return;
      }

      this.status = 'microfono apagado';
    };

    return recognition;
  }

  private stopRecognition(updateStatus = true): void {
    try {
      this.recognition?.stop();
    } catch {
      // Some browsers throw if stop is called after recognition has already ended.
    }

    this.recognizing = false;
    if (updateStatus) {
      this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
    }
  }

  private scheduleRecognitionRestart(delayMs: number): void {
    this.clearRecognitionRestart();

    if (!this.conversationEnabled) {
      return;
    }

    this.recognitionRestartTimer = window.setTimeout(() => {
      this.recognitionRestartTimer = null;
      this.startRecognition();
    }, delayMs);
  }

  private clearRecognitionRestart(): void {
    if (this.recognitionRestartTimer !== null) {
      window.clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = null;
    }
  }

  private clearInterruptionDetection(): void {
    if (this.interruptionDetectionTimer !== null) {
      window.clearTimeout(this.interruptionDetectionTimer);
      this.interruptionDetectionTimer = null;
    }
  }

  private handleUserSpeechStart(): void {
    if (Date.now() < this.listenIgnoreUntil) {
      return;
    }

    this.clearPauseTimer();

    if (this.isSpeaking) {
      this.userSpeechPhase = 'interrupted';
      this.status = 'interrupcion detectada';
      this.conversationEnabled = true;
      this.interruptSpeech();
      setTimeout(() => this.startRecognition(), 120);
      return;
    }

    this.userSpeechPhase = 'speaking';
    this.status = 'usuario hablando';
  }

  private handleUserSpeechPause(): void {
    if (this.isSpeaking || this.isThinking) {
      return;
    }

    this.userSpeechPhase = 'paused';
    this.status = 'pausa detectada';
    this.clearPauseTimer();
    this.pauseTimer = window.setTimeout(() => this.handleUserSpeechEnd(), 700);
  }

  private handleUserSpeechEnd(): void {
    if (this.isSpeaking || this.isThinking) {
      return;
    }

    this.clearPauseTimer();
    this.userSpeechPhase = 'ended';
    this.status = 'frase terminada';
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer !== null) {
      window.clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  private async sendPromptToBackend(text: string): Promise<void> {
    this.isThinking = true;
    this.userSpeechPhase = 'ended';
    this.status = 'pensando';
    this.reply = 'Escribiendo...';

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.apiHeaders(),
        body: JSON.stringify({ prompt: text, profile: this.profile })
      });
      const textReply = await response.text();

      if (!response.ok) {
        this.reply = `Error: ${textReply}`;
        this.finishThinking();
        return;
      }

      this.reply = textReply;
      this.speak(textReply);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error desconocido';
      this.reply = `Fallo en backend: ${message}`;
      this.finishThinking();
    }
  }

  private finishThinking(): void {
    this.isThinking = false;
    this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
    this.scheduleRecognitionRestart(250);
  }

  private speak(text: string): void {
    if (!window.speechSynthesis) {
      this.finishThinking();
      return;
    }

    this.isThinking = false;
    this.isSpeaking = true;
    this.assistantSpeechPhase = 'started';
    this.userSpeechPhase = 'idle';
    this.status = 'hablando';
    this.stopRecognition(false);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.onstart = () => {
      this.assistantSpeechPhase = 'started';
      this.status = 'asistente hablando';
    };
    utterance.onpause = () => {
      this.assistantSpeechPhase = 'paused';
      this.status = 'asistente en pausa';
    };
    utterance.onresume = () => {
      this.assistantSpeechPhase = 'started';
      this.status = 'asistente hablando';
    };
    utterance.onend = () => {
      this.isSpeaking = false;
      this.currentUtterance = null;
      this.clearInterruptionDetection();

      if (this.speechInterrupted) {
        this.speechInterrupted = false;
        return;
      }

      this.assistantSpeechPhase = 'ended';
      this.listenIgnoreUntil = Date.now() + 250;
      this.status = this.conversationEnabled ? 'escuchando' : 'microfono apagado';
      this.scheduleRecognitionRestart(300);
    };
    utterance.onerror = () => {
      this.isSpeaking = false;
      this.currentUtterance = null;
      this.clearInterruptionDetection();
      this.assistantSpeechPhase = 'ended';
      this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
      this.scheduleRecognitionRestart(250);
    };

    this.currentUtterance = utterance;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  private startInterruptionDetection(delayMs = 600): void {
    this.clearInterruptionDetection();

    if (!this.conversationEnabled) {
      return;
    }

    if (delayMs >= 600) {
      this.listenIgnoreUntil = Date.now() + delayMs;
    }

    this.interruptionDetectionTimer = window.setTimeout(() => {
      this.interruptionDetectionTimer = null;
      if (!this.isSpeaking || !this.conversationEnabled) {
        return;
      }

      this.startRecognition('interruption');
    }, delayMs);
  }

  private interruptSpeech(): void {
    this.clearInterruptionDetection();

    if (window.speechSynthesis) {
      this.speechInterrupted = true;
      speechSynthesis.cancel();
    }

    this.isSpeaking = false;
    this.isThinking = false;
    this.assistantSpeechPhase = 'interrupted';
    this.userSpeechPhase = 'interrupted';
    this.listenIgnoreUntil = 0;
    this.status = this.conversationEnabled ? 'escuchando' : 'microfono apagado';
    this.scheduleRecognitionRestart(120);
  }

  get voiceStatusText(): string {
    if (this.assistantSpeechPhase === 'interrupted') return 'Interrupcion detectada';
    if (this.isSpeaking && this.assistantSpeechPhase === 'paused') return 'Asistente en pausa';
    if (this.isSpeaking && this.assistantSpeechPhase === 'started') return 'Asistente hablando';
    if (this.assistantSpeechPhase === 'ended' && !this.recognizing && !this.isThinking) return 'Asistente termino';
    if (this.isSpeaking) return 'Hablando';
    if (this.isThinking) return 'Pensando';
    if (this.userSpeechPhase === 'interrupted') return 'Interrupcion detectada';
    if (this.userSpeechPhase === 'speaking') return 'Usuario hablando';
    if (this.userSpeechPhase === 'paused') return 'Pausa detectada';
    if (this.userSpeechPhase === 'ended') return 'Frase terminada';
    if (this.recognizing) return 'Escuchando';
    if (this.conversationEnabled) return 'Listo para escuchar';
    return 'Microfono apagado';
  }

  get micIcon(): string {
    if (this.isSpeaking) return '!';
    if (this.isThinking) return '...';
    if (this.recognizing || this.conversationEnabled) return 'ON';
    return 'OFF';
  }

  get micLabel(): string {
    if (this.isSpeaking) return 'Puedes interrumpir hablando';
    if (this.isThinking) return 'Procesando tu mensaje';
    if (this.assistantSpeechPhase === 'interrupted') return 'Interrupcion detectada';
    if (this.assistantSpeechPhase === 'ended' && !this.recognizing) return 'Asistente termino';
    if (this.userSpeechPhase === 'interrupted') return 'Interrupcion detectada';
    if (this.userSpeechPhase === 'speaking') return 'Usuario hablando';
    if (this.userSpeechPhase === 'paused') return 'Pausa detectada';
    if (this.userSpeechPhase === 'ended') return 'Frase terminada';
    if (this.recognizing) return 'Escuchando';
    if (this.conversationEnabled) return 'Conversacion activa';
    return 'Microfono apagado';
  }

  get micHelpText(): string {
    if (this.isSpeaking) return 'Habla y cortare la respuesta para escucharte.';
    if (this.isThinking) return 'Espera un momento.';
    if (this.assistantSpeechPhase === 'interrupted') return 'El usuario corto la respuesta.';
    if (this.assistantSpeechPhase === 'ended' && !this.recognizing) return 'La respuesta termino.';
    if (this.userSpeechPhase === 'interrupted') return 'Corte la respuesta para escucharte.';
    if (this.userSpeechPhase === 'speaking') return 'Sigue hablando, te estoy escuchando.';
    if (this.userSpeechPhase === 'paused') return 'Detecte una pausa breve.';
    if (this.userSpeechPhase === 'ended') return 'Envio tu frase al asistente.';
    if (this.recognizing) return 'Habla ahora con claridad.';
    if (this.conversationEnabled) return 'Te escuchare cuando termines de hablar.';
    return 'Toca el microfono una vez para iniciar la conversacion.';
  }
}


