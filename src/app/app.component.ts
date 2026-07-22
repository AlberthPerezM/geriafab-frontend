import { AfterViewInit, Component, ElementRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../environments/environment';
import {
  AuthForm,
  AuthMode,
  AuthUser,
  EmergencyContact,
  GoogleCredentialResponse,
  GoogleIdentity,
  Medication,
  MusicCommand,
  MusicResult,
  ProfileSummary,
  RecognitionPurpose,
  SeniorProfile,
  SpeechRecognitionConstructor,
  SpeechRecognitionEventLike,
  SpeechRecognitionInstance,
} from './models';
import { ApiService, AuthService, MusicService, ProfileService } from './core/services';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewInit {
  @ViewChild('googleButton') private googleButton?: ElementRef<HTMLDivElement>;
  @ViewChild('musicFrame') private musicFrame?: ElementRef<HTMLIFrameElement>;

  private readonly apiUrl = `${environment.apiBaseUrl}/api/gemini`;
  private recognition: SpeechRecognitionInstance | null = null;
  private listenIgnoreUntil = 0;
  private speechInterrupted = false;
  private pauseTimer: number | null = null;
  private recognitionRestartTimer: number | null = null;
  private interruptionDetectionTimer: number | null = null;
  private speechMouthTimer: number | null = null;
  private reminderTimer: number | null = null;
  private readonly triggeredReminders = new Set<string>();
  private pendingProfileAfterReauth: { profile: SeniorProfile; profileId: number | null; email: string } | null = null;

  recognizing = false;
  isSpeaking = false;
  speechMouthOpen = false;
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
  managerOpen = false;
  settingsUnlockOpen = false;
  settingsUnlockTarget: 'settings' | 'manager' = 'settings';
  settingsFromManager = false;
  settingsPassword = '';
  settingsUnlockMessage = '';
  deleteProfileId: number | null = null;
  deleteProfilePassword = '';
  deleteProfileError = '';
  deletingProfile = false;
  currentProfileStep = 0;
  readonly profileSteps = [
    'Datos',
    'Salud',
    'Preferencias',
    'Notas',
    'Emergencia',
  ];
  profileSaved = false;
  profileSaving = false;
  profileSaveError = '';
  profiles: ProfileSummary[] = [];
  activeProfileId: number | null = null;
  musicResults: MusicResult[] = [];
  musicQuery = '';
  musicLoading = false;
  musicError = '';
  currentVideoId = '';
  showMusicPanel = false;
  musicVolume = 50;
  musicPaused = false;
  showChatPanel = false;
  showContactsPanel = false;
  activeReminder: { title: string; message: string; time: string } | null = null;
  reminderPosition: { x: number; y: number } | null = null;
  private reminderDragOffset: { x: number; y: number } | null = null;
  private currentMusicIndex = -1;
  profile!: SeniorProfile;
  authMode: AuthMode = 'login';
  authMessage = '';
  googleClientIdConfigured = false;
  readonly showGoogleLogin = false;
  private googleButtonRendered = false;
  authForm: AuthForm = {
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  };

  constructor(
    private readonly sanitizer: DomSanitizer,
    private readonly zone: NgZone,
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly profileService: ProfileService,
    private readonly musicService: MusicService,
  ) {
    this.profile = this.profileService.createEmpty();
    this.auth.loadStored();
    void this.restoreSession();
  }

  ngAfterViewInit(): void {
    void this.renderGoogleButton();
    this.startReminderClock();
  }

  get isAuthenticated(): boolean {
    return this.auth.isAuthenticated;
  }

  get authUser(): AuthUser | null {
    return this.auth.user;
  }

  get authToken(): string {
    return this.auth.token;
  }

  get maxProfiles(): number {
    return this.profileService.maxProfiles;
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
      this.authMessage = this.api.errorMessage(error, 'No se pudo cargar Google Login.');
    }
  }

  logout(): void {
    this.auth.logout();
    this.authMessage = '';
    this.authForm.password = '';
    this.authForm.confirmPassword = '';
  }

  setView(view: 'registro' | 'asistente'): void {
    this.selectedView = view;
  }

  requestSettingsAccess(): void {
    this.settingsUnlockTarget = 'settings';
    this.settingsPassword = '';
    this.settingsUnlockMessage = '';
    this.settingsUnlockOpen = true;
  }

  /** Abre el gestor "Ficha de adulto mayor" (lista con editar/eliminar/nuevo). */
  requestManagerAccess(): void {
    this.settingsUnlockTarget = 'manager';
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
      await this.api.postJson('/api/auth/login', { email, password });
      const target = this.settingsUnlockTarget;
      this.cancelSettingsAccess();
      if (target === 'manager') {
        this.openManager();
      } else {
        this.openSettings();
      }
    } catch (error) {
      this.settingsUnlockMessage = this.api.errorMessage(error, 'Contrasena incorrecta.');
    }
  }

  /** Abre la ficha de configuracion del adulto mayor activo. */
  openSettings(fromManager = false): void {
    this.currentProfileStep = 0;
    this.profileSaved = false;
    this.profileSaveError = '';
    this.settingsFromManager = fromManager;
    this.managerOpen = false;
    this.settingsOpen = true;
    this.selectedView = 'registro';
  }

  /** Abre la lista de adultos mayores registrados. */
  openManager(): void {
    this.settingsOpen = false;
    this.managerOpen = true;
    this.selectedView = 'registro';
  }

  closeManager(): void {
    this.managerOpen = false;
    this.selectedView = 'asistente';
  }

  startPersonalization(): void {
    this.currentProfileStep = 0;
    this.profileSaved = false;
    this.profileSaveError = '';
    this.settingsOpen = true;
    this.selectedView = 'registro';
  }

  closeSettings(): void {
    this.settingsOpen = false;
    if (this.settingsFromManager) {
      this.settingsFromManager = false;
      this.openManager();
    } else {
      this.selectedView = 'asistente';
    }
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
    if (this.profileSaving) {
      return;
    }

    this.profileSaving = true;
    this.profileSaved = false;
    this.profileSaveError = '';
    this.profileService.saveLocally(this.profile);

    if (!this.authToken) {
      this.profileSaved = true;
      this.profileSaving = false;
      this.openAssistantAfterProfileSave();
      return;
    }

    try {
      if (this.profile.id) {
        // Perfil existente: actualiza su ficha.
        const response = await this.profileService.update(this.profile.id, this.profile);
        this.applyLoadedProfile(response.profile);
      } else {
        // Perfil nuevo: lo crea y adopta el id devuelto.
        const response = await this.profileService.create(this.profile);
        this.applyLoadedProfile(response.profile);
        this.setActiveProfileId(response.profile.id ?? null);
      }
      await this.loadProfilesList();
      this.profileSaved = true;
      this.openAssistantAfterProfileSave();
    } catch (error) {
      console.error('No se pudo guardar el perfil en backend', error);
      if (this.api.isUnauthorized(error)) {
        this.pendingProfileAfterReauth = {
          profile: structuredClone(this.profile),
          profileId: this.profile.id ?? this.activeProfileId,
          email: this.authUser?.email.toLowerCase() ?? '',
        };
        this.auth.clearSession();
        this.settingsOpen = false;
        this.managerOpen = false;
        this.authMode = 'login';
        this.authMessage = 'Tu sesion vencio. Inicia sesion nuevamente; conservamos la ficha y la guardaremos al entrar.';
        return;
      }
      this.profileSaveError = this.api.errorMessage(
        error,
        'No se pudieron guardar los datos. Intenta nuevamente.',
      );
    } finally {
      this.profileSaving = false;
    }
  }

  markProfileDirty(): void {
    if (this.profileSaving) return;
    this.profileSaved = false;
    this.profileSaveError = '';
  }

  private openAssistantAfterProfileSave(): void {
    this.settingsOpen = false;
    this.managerOpen = false;
    this.settingsFromManager = false;
    this.selectedView = 'asistente';
  }

  resetProfile(): void {
    this.profile = this.profileService.createEmpty();
    this.profileService.ensureMinimumRows(this.profile);
    this.profileService.clearLocal();
    this.profileSaved = false;
  }

  get canAddProfile(): boolean {
    return this.profiles.length < this.maxProfiles;
  }

  /** Desde el gestor: crea un adulto mayor nuevo y abre su ficha. */
  startNewProfile(): void {
    if (!this.canAddProfile) {
      return;
    }
    this.newProfile();
    this.openSettings(true);
  }

  /** Desde el gestor: abre la ficha de configuracion del adulto seleccionado. */
  async editProfile(id: number): Promise<void> {
    await this.switchProfile(id);
    this.openSettings(true);
  }

  /** Prepara el formulario para registrar un adulto mayor nuevo. */
  newProfile(): void {
    if (!this.canAddProfile) {
      return;
    }
    this.setActiveProfileId(null);
    this.profile = this.profileService.createEmpty();
    this.profileService.ensureMinimumRows(this.profile);
    this.currentProfileStep = 0;
    this.profileSaved = false;
    this.profileService.clearLocal();
  }

  /** Cambia el perfil activo y carga su ficha e historial. */
  async switchProfile(id: number): Promise<void> {
    if (id === this.activeProfileId) {
      return;
    }
    this.setActiveProfileId(id);
    await this.loadActiveProfile();
    this.currentProfileStep = 0;
    this.profileSaved = true;
  }

  requestDeleteProfile(id: number): void {
    this.deleteProfileId = id;
    this.deleteProfilePassword = '';
    this.deleteProfileError = '';
  }

  cancelDeleteProfile(): void {
    if (this.deletingProfile) return;
    this.deleteProfileId = null;
    this.deleteProfilePassword = '';
    this.deleteProfileError = '';
  }

  async confirmDeleteProfile(): Promise<void> {
    const id = this.deleteProfileId;
    if (!this.authToken || id === null || !this.deleteProfilePassword || this.deletingProfile) {
      return;
    }
    this.deletingProfile = true;
    this.deleteProfileError = '';
    try {
      await this.profileService.remove(id, this.deleteProfilePassword);
    } catch (error) {
      console.error('No se pudo eliminar el perfil', error);
      this.deleteProfileError = this.api.errorMessage(error, 'No se pudo eliminar la ficha.');
      this.deletingProfile = false;
      return;
    }
    this.deletingProfile = false;
    this.cancelDeleteProfile();
    if (this.activeProfileId === id) {
      this.setActiveProfileId(null);
    }
    await this.loadProfilesList();
    const next = this.profiles[0]?.id ?? null;
    if (next !== null) {
      this.setActiveProfileId(next);
      await this.loadActiveProfile();
    } else {
      this.newProfile();
    }
  }

  private setActiveProfileId(id: number | null): void {
    this.activeProfileId = id;
    this.profileService.setStoredActiveId(id);
  }

  private applyLoadedProfile(profile: SeniorProfile): void {
    this.profile = {
      ...this.profileService.createEmpty(),
      ...profile,
    };
    this.profileService.ensureMinimumRows(this.profile);
    this.profileService.saveLocally(this.profile);
  }

  private async loadProfilesList(): Promise<void> {
    if (!this.authToken) {
      this.profiles = [];
      return;
    }
    try {
      const response = await this.profileService.list();
      this.profiles = response.profiles ?? [];
    } catch (error) {
      console.error('No se pudo cargar la lista de perfiles', error);
      this.profiles = [];
    }
  }

  private async loadActiveProfile(): Promise<void> {
    if (!this.authToken || this.activeProfileId === null) {
      return;
    }
    try {
      const response = await this.profileService.get(this.activeProfileId);
      if (response.profile) {
        this.applyLoadedProfile(response.profile);
      }
    } catch (error) {
      console.error('No se pudo cargar el perfil activo', error);
    }
  }

  private async loadProfile(): Promise<void> {
    if (this.authToken) {
      await this.loadProfilesList();

      if (this.profiles.length > 0) {
        const stored = this.profileService.getStoredActiveId();
        const exists = this.profiles.some((p) => p.id === stored);
        this.setActiveProfileId(exists ? stored : this.profiles[0].id);
        await this.loadActiveProfile();
        return;
      }

      // Cuenta autenticada sin perfiles todavia: formulario en blanco.
      this.setActiveProfileId(null);
      this.profile = this.profileService.createEmpty();
      this.profileService.ensureMinimumRows(this.profile);
      return;
    }

    // Modo no autenticado: un solo perfil en localStorage.
    const local = this.profileService.loadLocal();
    if (local) {
      this.profile = local;
    }
  }

  private async restoreSession(): Promise<void> {
    if (!this.authToken) {
      this.auth.clearSession();
      await this.loadProfile();
      return;
    }

    try {
      const session = await this.auth.fetchCurrentUser();
      this.auth.setSession(session.user, this.authToken);
      await this.loadProfile();
    } catch {
      this.auth.clearSession();
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
      await this.auth.loginWithGoogle(response.credential);
      await this.finishLogin('Sesion iniciada con Google.');
    } catch (error) {
      this.authMessage = this.api.errorMessage(error, 'No se pudo iniciar sesion con Google.');
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
      await this.auth.login(email, password);
      await this.finishLogin('Sesion iniciada.');
    } catch (error) {
      this.authMessage = this.api.errorMessage(error, 'Correo o contrasena incorrectos.');
    }
  }

  private async finishLogin(successMessage: string): Promise<void> {
    const pending = this.pendingProfileAfterReauth;
    const currentEmail = this.authUser?.email.toLowerCase() ?? '';

    if (pending && pending.email === currentEmail) {
      try {
        const response = pending.profileId !== null
          ? await this.profileService.update(pending.profileId, pending.profile)
          : await this.profileService.create(pending.profile);
        this.pendingProfileAfterReauth = null;
        this.applyLoadedProfile(response.profile);
        this.setActiveProfileId(response.profile.id ?? pending.profileId);
        await this.loadProfilesList();
        this.profileSaved = true;
        this.openAssistantAfterProfileSave();
        this.authMessage = 'Sesion iniciada. La ficha pendiente se guardo correctamente.';
        return;
      } catch (error) {
        console.error('No se pudo guardar la ficha pendiente despues de iniciar sesion', error);
        this.authMessage = this.api.errorMessage(error, 'Sesion iniciada, pero no se pudo guardar la ficha pendiente.');
        return;
      }
    }

    await this.loadProfile();
    this.authMessage = pending
      ? 'Sesion iniciada. El borrador pertenece a otra cuenta y no se modifico.'
      : successMessage;
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
      await this.auth.register(name, email, password);
      this.authMessage = 'Cuenta creada. Personaliza la ficha del adulto mayor.';
      this.startPersonalization();
    } catch (error) {
      this.authMessage = this.api.errorMessage(error, 'No se pudo crear el registro.');
    }
  }

  replayLastReply(): void {
    if (!this.reply || this.isSpeaking || this.isThinking) {
      return;
    }
    this.speak(this.reply);
  }

  setPanel(panel: 'transcript' | 'music'): void {
    this.selectedPanel = panel;
  }

  async searchMusic(query?: string, voiceTriggered = false): Promise<void> {
    const q = (query ?? this.musicQuery).trim();
    if (!q) {
      this.musicResults = [];
      return;
    }

    this.musicQuery = q;
    this.musicLoading = true;
    this.musicError = '';
    this.musicResults = [];
    this.selectedPanel = 'music';
    // Abrimos el panel de una vez para que también se vean los mensajes de error.
    this.showMusicPanel = true;

    try {
      this.musicResults = await this.musicService.search(q);
      if (this.musicResults.length === 0) {
        this.musicError = 'No se encontraron resultados para esa búsqueda.';
        this.showMusicPanel = true;
      } else {
        this.showMusicPanel = true;
        if (voiceTriggered) {
          this.playSongAt(0);
          this.reply = `Reproduciendo: ${this.musicResults[0].title}.`;
        }
      }
    } catch (error) {
      this.musicError = this.api.errorMessage(error, 'Error al conectar con YouTube. Verifica tu conexión.');
    } finally {
      this.musicLoading = false;
    }
  }

  playMusic(videoId: string): void {
    const index = this.musicResults.findIndex(song => song.videoId === videoId);
    this.currentMusicIndex = index;
    this.showMusicPanel = true;
    this.selectedPanel = 'music';
    if (window.speechSynthesis) {
      speechSynthesis.cancel();
    }
    this.isSpeaking = false;
    this.isThinking = false;
    this.stopSpeechMouthMotion();
    this.clearInterruptionDetection();
    this.currentVideoId = videoId;
    this.musicPaused = false;
    this.status = 'reproduciendo música';
    // El video arranca en silencio; subimos al volumen cómodo cuando cargue.
    // (onMusicFrameLoad también lo hace; este timer es un respaldo.)
    window.setTimeout(() => this.applyVolume(), 1200);
    // Mantenemos el micrófono vivo pero en "modo comando": mientras suene la
    // música solo obedecemos órdenes de control (siguiente, detén, cierra…).
    // Cualquier otro sonido —normalmente la propia canción entrando por el
    // micrófono— se descarta y nunca llega al asistente.
    this.enterMusicCommandMode();
  }

  private enterMusicCommandMode(): void {
    this.conversationEnabled = true;
    // Ignoramos un instante para no captar el arranque del tema como comando.
    this.listenIgnoreUntil = Date.now() + 1200;
    this.clearRecognitionRestart();
    this.stopRecognition(false);
    this.scheduleRecognitionRestart(500);
  }

  private reactivateMicAfterMusic(): void {
    // Al terminar la música devolvemos el micrófono a la conversación normal.
    if (!this.conversationEnabled) {
      this.status = 'microfono apagado';
      return;
    }
    this.listenIgnoreUntil = Date.now() + 300;
    this.status = 'escuchando';
    this.scheduleRecognitionRestart(300);
  }

  playSongAt(index: number): void {
    const song = this.musicResults[index];
    if (!song) {
      this.reply = 'No encontré una canción para reproducir.';
      this.speak(this.reply);
      return;
    }

    this.reply = `Reproduciendo: ${song.title}.`;
    this.playMusic(song.videoId);
  }

  playNextSong(): void {
    if (this.musicResults.length === 0) {
      this.reply = 'Primero dime qué música quieres escuchar.';
      this.speak(this.reply);
      return;
    }

    const nextIndex = this.currentMusicIndex >= 0
      ? (this.currentMusicIndex + 1) % this.musicResults.length
      : 0;
    this.playSongAt(nextIndex);
  }

  stopMusic(): void {
    this.currentVideoId = '';
    this.currentMusicIndex = -1;
    this.musicPaused = false;
    this.reactivateMicAfterMusic();
  }

  // Envía una orden al reproductor de YouTube incrustado (necesita enablejsapi=1).
  private sendPlayerCommand(func: string, args: unknown[] = []): void {
    const win = this.musicFrame?.nativeElement?.contentWindow;
    if (!win) return;
    win.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }

  // Aplica el volumen elegido y quita el silencio inicial. El reproductor
  // arranca muteado (mute=1) y tarda en cargar, así que reintentamos varias
  // veces hasta que el player responde.
  private applyVolume(): void {
    let intentos = 0;
    const enviar = () => {
      this.sendPlayerCommand('setVolume', [this.musicVolume]);
      if (this.musicVolume === 0) {
        this.sendPlayerCommand('mute');
      } else {
        this.sendPlayerCommand('unMute');
      }
      if (++intentos < 5) {
        window.setTimeout(enviar, 600);
      }
    };
    enviar();
  }

  // El <iframe> terminó de cargar el reproductor: momento ideal para subir el
  // volumen desde el silencio inicial.
  onMusicFrameLoad(): void {
    this.applyVolume();
  }

  volumeUp(): void {
    this.musicVolume = Math.min(100, this.musicVolume + 20);
    this.applyVolume();
  }

  volumeDown(): void {
    this.musicVolume = Math.max(0, this.musicVolume - 20);
    this.applyVolume();
  }

  muteMusic(): void {
    this.musicVolume = 0;
    this.sendPlayerCommand('mute');
  }

  pauseMusic(): void {
    if (!this.currentVideoId) return;
    this.musicPaused = true;
    this.sendPlayerCommand('pauseVideo');
  }

  resumeMusic(): void {
    if (!this.currentVideoId) return;
    this.musicPaused = false;
    this.sendPlayerCommand('playVideo');
  }

  togglePlayPause(): void {
    if (this.musicPaused) {
      this.resumeMusic();
    } else {
      this.pauseMusic();
    }
  }

  openMusicPanel(): void {
    this.showMusicPanel = true;
    this.selectedPanel = 'music';
    if (this.musicResults.length === 0) {
      this.recommendMusic();
    }
  }

  closeMusicPanel(): void {
    this.showMusicPanel = false;
    this.currentVideoId = '';
    this.musicResults = [];
    this.musicQuery = '';
    this.musicError = '';
    this.currentMusicIndex = -1;
    this.reactivateMicAfterMusic();
  }

  openChatPanel(): void {
    this.showChatPanel = true;
    this.selectedPanel = 'transcript';
  }

  closeChatPanel(): void {
    this.showChatPanel = false;
  }

  get knownContacts(): EmergencyContact[] {
    return this.profile.emergencyContacts.filter((contact) =>
      Boolean(contact.name?.trim() || contact.phone?.trim()),
    );
  }

  closeContactsPanel(): void {
    this.showContactsPanel = false;
  }

  dismissReminder(): void {
    this.activeReminder = null;
    this.reminderPosition = null;
    this.reminderDragOffset = null;
  }

  startReminderDrag(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest('button, a')) return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    this.reminderPosition = { x: rect.left, y: rect.top };
    this.reminderDragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  moveReminder(event: PointerEvent): void {
    if (!this.reminderDragOffset) return;
    const element = event.currentTarget as HTMLElement;
    const maxX = Math.max(8, window.innerWidth - element.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - element.offsetHeight - 8);
    this.reminderPosition = {
      x: Math.min(maxX, Math.max(8, event.clientX - this.reminderDragOffset.x)),
      y: Math.min(maxY, Math.max(8, event.clientY - this.reminderDragOffset.y)),
    };
  }

  endReminderDrag(event: PointerEvent): void {
    this.reminderDragOffset = null;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }

  recommendMusic(): void {
    const query =
      this.profile.favoriteTheme?.trim() ||
      this.profile.happinessTriggers?.split(',')[0]?.trim() ||
      'música popular en español';
    this.showMusicPanel = true;
    void this.searchMusic(query, false);
  }

  // Guardamos la URL ya saneada y solo la recreamos cuando cambia el video.
  // Si devolviéramos un objeto nuevo en cada ciclo de detección de cambios,
  // Angular recargaría el <iframe> y la canción se reiniciaría a cada rato.
  private cachedVideoId = '';
  private cachedVideoUrl: SafeResourceUrl | null = null;

  get currentVideoUrl(): SafeResourceUrl | null {
    if (!this.currentVideoId) {
      this.cachedVideoId = '';
      this.cachedVideoUrl = null;
      return null;
    }
    if (this.currentVideoId !== this.cachedVideoId) {
      this.cachedVideoId = this.currentVideoId;
      // Arranca en silencio (mute=1) para no reventar los oídos; en cuanto el
      // reproductor está listo subimos suave al volumen elegido (ver applyVolume).
      this.cachedVideoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://www.youtube.com/embed/${this.currentVideoId}?autoplay=1&enablejsapi=1&playsinline=1&mute=1`
      );
    }
    return this.cachedVideoUrl;
  }

  get currentVideoWatchUrl(): string {
    return this.currentVideoId ? `https://www.youtube.com/watch?v=${this.currentVideoId}` : '#';
  }

  private detectMusicQuery(text: string): string | null {
    const command = this.detectMusicCommand(text);
    return command?.type === 'search' ? command.query : null;
  }

  private normalizeCommandText(text: string): string {
    return text.toLowerCase()
      .replace(/[áàäâã]/g, 'a').replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i').replace(/[óòöôõ]/g, 'o')
      .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n');
  }

  private detectChatCommand(text: string): 'open' | 'close' | null {
    const t = this.normalizeCommandText(text);
    const target = /\b(conversacion|transcripcion|chat|mensajes|dialogo)\b/;

    if (/\b(cierra|cerrar|quita|quitar|oculta|ocultar|esconde|guarda)\b/.test(t) && target.test(t)) {
      return 'close';
    }

    if (/\b(abre|abrir|muestra|muestrame|ensena|ensename|ver)\b/.test(t) && target.test(t)) {
      return 'open';
    }

    return null;
  }

  private detectContactsCommand(text: string): 'open' | 'close' | null {
    const t = this.normalizeCommandText(text);
    const target = /\b(contacto|contactos|persona|personas|conocido|conocidos|telefono|telefonos|numero|numeros)\b/;
    const intent = /\b(contactar|contactarme|comunicar|comunicarme|llamar|llama|hablar)\b/;

    if (/\b(cierra|cerrar|cierralo|cierrala|quita|quitar|oculta|ocultar|esconde)\b/.test(t) &&
        (target.test(t) || (this.showContactsPanel && /\b(ventana|panel|lista|la|eso)\b/.test(t)))) {
      return 'close';
    }
    if ((/\b(abre|abrir|muestra|muestrame|ensena|ensename|ver)\b/.test(t) && target.test(t)) || intent.test(t)) {
      return 'open';
    }
    return null;
  }

  private isCloseAnyWindowCommand(text: string): boolean {
    const t = this.normalizeCommandText(text);
    const close = /\b(cierra|cerrar|cierralo|cierrala|quita|quitar|oculta|ocultar|apaga|apagar|deten|detener)\b/.test(t);
    const genericWindow = /\b(ventana|ventanas|aviso|alarma|recordatorio|panel|todo)\b/.test(t);
    return close && genericWindow && Boolean(
      this.activeReminder || this.showContactsPanel || this.showChatPanel || this.showMusicPanel,
    );
  }

  private closeEveryOpenWindow(): void {
    this.dismissReminder();
    this.showContactsPanel = false;
    this.showChatPanel = false;
    if (this.showMusicPanel) {
      this.closeMusicPanel();
    }
  }

  // Números hablados a dígito: "tres" -> 3, "tercera" -> 3, "5" -> 5.
  private readonly numberWords: Record<string, number> = {
    uno: 1, una: 1, primer: 1, primero: 1, primera: 1,
    dos: 2, segundo: 2, segunda: 2,
    tres: 3, tercer: 3, tercero: 3, tercera: 3,
    cuatro: 4, cuarto: 4, cuarta: 4,
    cinco: 5, quinto: 5, quinta: 5,
    seis: 6, sexto: 6, sexta: 6,
    siete: 7, septimo: 7, septima: 7, setimo: 7, setima: 7,
    ocho: 8, octavo: 8, octava: 8,
    nueve: 9, noveno: 9, novena: 9,
    diez: 10, decimo: 10, decima: 10,
    once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
    dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  };

  private wordOrDigitToNumber(token: string): number | null {
    if (/^\d+$/.test(token)) {
      const n = parseInt(token, 10);
      return n >= 1 && n <= 50 ? n : null;
    }
    return this.numberWords[token] ?? null;
  }

  // Devuelve el número de canción (1..N) si el texto pide reproducir por posición.
  // Es conservador: evita confundir búsquedas con números ("pon 3 metros sobre
  // el cielo") con la selección de un elemento de la lista.
  private detectSongNumber(t: string): number | null {
    // A) "numero 3", "el numero tres".
    const explicit = t.match(/\bnumero\s+([a-z]+|\d{1,2})\b/);
    if (explicit) {
      const n = this.wordOrDigitToNumber(explicit[1]);
      if (n !== null) return n;
    }

    // B) verbo de reproducir + (opcional la/el/cancion/tema) + número al final.
    const verbNum = t.match(
      /\b(?:pon|ponme|ponle|reproduce|reproducir|toca|tocar|escucha|escuchar|oye|oir|dame|selecciona|seleccione|elige|elije|quiero|quisiera|salta|salte|ve|vamos)\b(?:\s+a)?(?:\s+la|\s+el)?(?:\s+(?:cancion|tema|pista|opcion|numero))?\s+([a-z]+|\d{1,2})(?:\s+(?:cancion|tema|pista))?\s*$/,
    );
    if (verbNum) {
      const n = this.wordOrDigitToNumber(verbNum[1]);
      if (n !== null) return n;
    }

    // C) ordinal al final ("la tercera", "la primera cancion"), solo si el texto
    // tiene intención musical, para no capturar preguntas como "cual fue la primera".
    const hasMusicIntent =
      /\b(pon|ponme|ponle|reproduce|reproducir|toca|tocar|escucha|escuchar|oye|oir|dame|selecciona|elige|quiero|quisiera|cancion|tema|pista|musica|numero)\b/.test(t);
    if (hasMusicIntent) {
      const ordinal = t.match(
        /\b(?:la|el)?\s*(primer|primera|primero|segunda|segundo|tercer|tercera|tercero|cuarta|cuarto|quinta|quinto|sexta|sexto|septima|septimo|octava|octavo|novena|noveno|decima|decimo)\b(?:\s+(?:cancion|tema|pista))?\s*$/,
      );
      if (ordinal) {
        const n = this.wordOrDigitToNumber(ordinal[1]);
        if (n !== null) return n;
      }
    }

    // D) En contexto de música (sonando o lista abierta con resultados), aceptar
    // números "pelados": "la 5", "el 6", "cancion 5" o simplemente "cinco".
    if (this.currentVideoId || (this.showMusicPanel && this.musicResults.length > 0)) {
      const bare = t.match(
        /^(?:pon\s+|reproduce\s+|toca\s+|escucha\s+|dame\s+|quiero\s+)?(?:la\s+|el\s+)?(?:cancion\s+|tema\s+|pista\s+|numero\s+|opcion\s+)?([a-z]+|\d{1,2})$/,
      );
      if (bare) {
        const n = this.wordOrDigitToNumber(bare[1]);
        if (n !== null) return n;
      }
    }

    return null;
  }

  private detectMusicCommand(text: string): MusicCommand | null {
    const t = this.normalizeCommandText(text);
    const playing = !!this.currentVideoId;
    const panelOpen = this.showMusicPanel;
    // No le robamos al chat el "cierra la conversación".
    const chatTarget = /\b(conversacion|transcripcion|chat|mensajes|dialogo)\b/.test(t);
    const musicTarget = /\b(lista|ventana|reproduccion|reproductor|musica|cancion|tema|pista|video|youtube|panel)\b/.test(t);

    // ── Cerrar la lista/ventana de música ──────────────────────────────
    // Fluido: basta "cierra", "ciérralo", "quítalo", "oculta eso" si el panel
    // está abierto y no se refiere a la conversación.
    if (!chatTarget &&
        /\b(cierra|cerrar|cierralo|cierrala|cierre|quita|quitar|quitalo|quitala|oculta|ocultar|ocultalo|esconde|esconder|guarda|minimiza|saca)\b/.test(t) &&
        (musicTarget || panelOpen)) {
      return { type: 'close' };
    }

    // ── Abrir la lista/ventana ─────────────────────────────────────────
    if (/\b(abre|abrir|abreme|muestra|muestrame|ensena|ensename|ver|despliega)\b/.test(t) &&
        /\b(lista|ventana|reproduccion|reproductor|musica|panel|canciones|youtube)\b/.test(t)) {
      return { type: 'open' };
    }

    // ── Volumen: silenciar / subir / bajar ─────────────────────────────
    if (/\b(silencia|silencio|mudo|mutea|mutear|enmudece|quita el sonido|sin sonido|callate|calla)\b/.test(t)) {
      return { type: 'mute' };
    }
    if ((/\b(sube|subir|subele|subelo|aumenta|aumentar|incrementa)\b/.test(t) && (/\b(volumen|sonido|musica|lo|le|la)\b/.test(t) || playing)) ||
        /\bmas\s+(alto|fuerte|duro|volumen)\b/.test(t)) {
      return { type: 'volumeUp' };
    }
    if ((/\b(baja|bajar|bajale|bajalo|reduce|reducir|disminuye|disminuir)\b/.test(t) && (/\b(volumen|sonido|musica|lo|le|la)\b/.test(t) || playing)) ||
        /\bmas\s+(bajo|suave|despacio|bajito)\b/.test(t) ||
        /\bmenos\s+(volumen|sonido)\b/.test(t)) {
      return { type: 'volumeDown' };
    }

    // ── Pausar / reanudar (solo si hay algo sonando) ───────────────────
    // "para" queda fuera a propósito: es demasiado común en las letras y
    // pausaría la canción sola; se usa "pausa" o "detente".
    if (playing && /\b(pausa|pausala|pausalo|pausar|pausame|pausela|detente|deten|stop)\b/.test(t)) {
      return { type: 'pause' };
    }
    if (playing && /\b(reanuda|reanudar|continua|continuar|resume|dale play|reanudala)\b/.test(t)) {
      return { type: 'resume' };
    }

    // ── Detener del todo (quitar la música) ────────────────────────────
    if (/\b(deten|detener|apaga|apagar|apagala|quita|quitar|corta|cortar|termina|terminar|ya no)\b.*\b(musica|cancion|tema|reproduccion|video|sonido)\b/.test(t) ||
        (playing && /\b(apagala|apagalo|cortala|cortalo)\b/.test(t))) {
      return { type: 'stop' };
    }

    // ── Siguiente canción ──────────────────────────────────────────────
    if (/\b(siguiente|proxima|proximo|pon otra|otra cancion|otra musica|otro tema|cambia de cancion|cambia la cancion|cambia de musica|cambia el tema|cambia la musica|adelanta)\b/.test(t)) {
      return { type: 'next' };
    }

    if (/\b(reproduce|pon|toca)\b.*\b(primera|primer resultado|la uno|numero uno)\b/.test(t)) {
      return { type: 'first' };
    }

    // Reproducir una canción por su número: "pon la número 3", "reproduce la
    // tercera", "la canción dos", "escuchar la 5", "la 6" o solo "cinco".
    const numbered = this.detectSongNumber(t);
    if (numbered !== null) {
      return { type: 'play', index: numbered - 1 };
    }

    if (/\b(pon|reproduce|toca|busca|quiero escuchar)\b.*\b(musica|canciones)\b\s*$/.test(t)) {
      return {
        type: 'search',
        query: this.profile.favoriteTheme?.trim() || 'música popular en español',
      };
    }

    const patterns = [
      /(?:pon|ponme|ponle|reproduce|reproducir|toca|tocar|busca|buscar|escucha|escuchar|escuchemos|oye|oir|oigamos|quiero escuchar|quiero oir|quisiera escuchar)\s+(?:la\s+|el\s+|las\s+|los\s+)?(?:musica|cancion|canciones|tema|el tema|la cancion)?\s*(?:de\s+)?(.+)/,
      /(?:musica|cancion|canciones)\s+(?:de\s+)?(.+)/,
      /(?:poner|buscar|reproducir)\s+(?:musica|cancion|canciones|el tema)?\s*(?:de\s+)?(.+)/,
      /(?:quiero|queria|quisiera)\s+(?:escuchar|oir)\s+(.+)/,
    ];
    for (const pattern of patterns) {
      const match = t.match(pattern);
      if (match?.[1]) return { type: 'search', query: match[1].trim() };
    }
    return null;
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
    let interruptionSpeechStartedAt = 0;
    recognition.onspeechstart = () => this.zone.run(() => {
      if (purpose === 'interruption') {
        interruptionSpeechStartedAt = Date.now();
        return;
      }
      this.handleUserSpeechStart();
    });
    recognition.onspeechend = () => this.zone.run(() => {
      if (purpose !== 'interruption') this.handleUserSpeechPause();
    });
    recognition.onaudioend = () => this.zone.run(() => {
      if (purpose !== 'interruption') this.handleUserSpeechEnd();
    });
    recognition.onresult = (event) => this.zone.run(() => {
      if (Date.now() < this.listenIgnoreUntil) {
        return;
      }

      if (purpose === 'interruption') {
        const result = event.results[event.results.length - 1];
        const alternative = result[0];
        const text = alternative.transcript.trim();
        const speechDuration = interruptionSpeechStartedAt > 0
          ? Date.now() - interruptionSpeechStartedAt
          : 0;

        // Esperamos una frase final reconocible: onspeechstart por sí solo también
        // se dispara con golpes, gritos, televisión y eco de los parlantes.
        if (result.isFinal !== false && this.isHumanInterruption(text, alternative.confidence, speechDuration)) {
          this.transcript = text;
          this.stopRecognition(false);
          this.interruptSpeech();
          void this.sendPromptToBackend(text);
        }
        return;
      }

      if (this.isSpeaking || this.isThinking) {
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

      // Modo comando durante la reproducción: aceptamos órdenes de música
      // (control, buscar otra, por número…) y de conversación. Todo lo demás
      // (la letra de la canción captada por el micro) se descarta y seguimos
      // escuchando, sin llamar al asistente. Ignoramos 'open' porque el panel
      // ya está abierto.
      if (this.currentVideoId) {
        if (this.isCloseAnyWindowCommand(text)) {
          this.handleUserSpeechEnd();
          this.transcript = text;
          this.stopRecognition(false);
          this.closeEveryOpenWindow();
          this.reply = 'Listo, cerré la ventana.';
          this.speak(this.reply);
          return;
        }
        const contactsCommand = this.detectContactsCommand(text);
        const command = contactsCommand ? null : this.detectMusicCommand(text);
        const chatCommand = this.detectChatCommand(text);
        const isActionable = command !== null && command.type !== 'open';

        if (!isActionable && !chatCommand && !contactsCommand) {
          this.scheduleRecognitionRestart(250);
          return;
        }

        this.handleUserSpeechEnd();
        this.transcript = text;
        this.stopRecognition(false);
        if (contactsCommand) {
          this.handleContactsCommand(contactsCommand);
        } else if (command !== null && isActionable) {
          this.handleMusicCommand(command);
        } else if (chatCommand) {
          this.handleChatCommand(chatCommand);
        }
        return;
      }

      this.handleUserSpeechEnd();
      this.transcript = text;
      this.isThinking = true;
      this.status = 'pensando';
      this.stopRecognition(false);
      void this.sendPromptToBackend(text);
    });
    recognition.onend = () => this.zone.run(() => {
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
    });
    recognition.onerror = (event) => this.zone.run(() => {
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
    });

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

  // Detecta y ejecuta cualquier comando de voz local (música o conversación)
  // ANTES de tocar la UI de "pensando", para que una orden no muestre el chat
  // ni gaste el backend por error. Devuelve true si el texto era un comando.
  private tryHandleVoiceCommand(text: string): boolean {
    if (this.isCloseAnyWindowCommand(text)) {
      this.closeEveryOpenWindow();
      this.isThinking = false;
      this.reply = 'Listo, cerré la ventana.';
      this.speak(this.reply);
      return true;
    }

    const contactsCommand = this.detectContactsCommand(text);
    if (contactsCommand) {
      this.handleContactsCommand(contactsCommand);
      return true;
    }

    const musicCommand = this.detectMusicCommand(text);
    if (musicCommand) {
      this.handleMusicCommand(musicCommand);
      return true;
    }

    const chatCommand = this.detectChatCommand(text);
    if (chatCommand) {
      this.handleChatCommand(chatCommand);
      return true;
    }

    return false;
  }

  private handleContactsCommand(action: 'open' | 'close'): void {
    this.isThinking = false;
    if (action === 'close') {
      this.closeContactsPanel();
      this.reply = 'Listo, cerré los contactos.';
      this.speak(this.reply);
      return;
    }

    this.showContactsPanel = true;
    this.reply = this.knownContacts.length > 0
      ? 'Aquí tienes las personas conocidas y sus números.'
      : 'Todavía no hay personas ni números guardados en la ficha.';
    this.speak(this.reply);
  }

  private handleChatCommand(action: 'open' | 'close'): void {
    this.isThinking = false;

    if (action === 'close') {
      this.closeChatPanel();
      this.reply = 'Listo, cerré la conversación.';
      this.speak(this.reply);
      return;
    }

    this.openChatPanel();
    this.reply = 'Aquí tienes la conversación.';
    this.speak(this.reply);
  }

  private async sendPromptToBackend(text: string): Promise<void> {
    this.userSpeechPhase = 'ended';

    if (this.tryHandleVoiceCommand(text)) {
      return;
    }

    this.isThinking = true;
    this.status = 'pensando';
    this.reply = 'Escribiendo...';
    this.showChatPanel = true;

    // Cortafuegos: si el backend no responde en 25 s abortamos para que la
    // conversación no se quede colgada en "pensando".
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.api.headers(),
        body: JSON.stringify({ prompt: text, profile: this.profile, profileId: this.activeProfileId }),
        signal: controller.signal,
      });
      const textReply = await response.text();

      if (!response.ok) {
        this.reply = 'Tuve un problema para responder. ¿Puedes repetirlo?';
        console.error('Backend respondió con error', response.status, textReply);
        this.speak(this.reply);
        return;
      }

      const cleanReply = textReply.trim();
      if (!cleanReply) {
        this.reply = 'No recibí respuesta. ¿Puedes repetirlo?';
        this.speak(this.reply);
        return;
      }

      this.reply = cleanReply;
      this.speak(cleanReply);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      this.reply = aborted
        ? 'Estoy tardando en responder. Intenta de nuevo, por favor.'
        : 'No pude conectarme. Revisa tu conexión e inténtalo otra vez.';
      console.error('Fallo al contactar el backend', error);
      this.speak(this.reply);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private handleMusicCommand(musicCommand: MusicCommand): void {
    this.showMusicPanel = true;
    // Un comando de música nunca debe quedar en estado "pensando".
    this.isThinking = false;

    switch (musicCommand.type) {
      case 'close':
        this.closeMusicPanel();
        this.reply = 'Listo, cerré la lista de música.';
        this.speak(this.reply);
        return;

      case 'open':
        this.openMusicPanel();
        this.reply = this.musicResults.length > 0
          ? 'Aquí tienes la lista de música.'
          : 'Abro la lista y busco algo de música para ti.';
        this.speak(this.reply);
        return;

      case 'stop':
        this.stopMusic();
        this.reply = 'Listo, detuve la música.';
        this.speak(this.reply);
        return;

      case 'first':
        this.playSongAt(0);
        return;

      case 'play':
        if (this.musicResults.length === 0) {
          this.reply = 'Primero dime qué música quieres y luego elígela por su número.';
          this.speak(this.reply);
          return;
        }
        if (musicCommand.index < 0 || musicCommand.index >= this.musicResults.length) {
          this.reply = `Tengo ${this.musicResults.length} canciones en la lista. Dime un número del 1 al ${this.musicResults.length}.`;
          this.speak(this.reply);
          return;
        }
        this.playSongAt(musicCommand.index);
        return;

      case 'next':
        this.playNextSong();
        return;

      case 'pause':
        this.pauseMusic();
        this.reply = 'Pausado.';
        this.keepListeningAfterControl();
        return;

      case 'resume':
        this.resumeMusic();
        this.reply = 'Sigo la música.';
        this.keepListeningAfterControl();
        return;

      case 'volumeUp':
        this.volumeUp();
        this.reply = `Volumen al ${this.musicVolume} por ciento.`;
        this.keepListeningAfterControl();
        return;

      case 'volumeDown':
        this.volumeDown();
        this.reply = `Volumen al ${this.musicVolume} por ciento.`;
        this.keepListeningAfterControl();
        return;

      case 'mute':
        this.muteMusic();
        this.reply = 'Silencié la música.';
        this.keepListeningAfterControl();
        return;

      case 'search':
        this.reply = `Abriré la ventana de música y buscaré: ${musicCommand.query}.`;
        this.speak(this.reply, () => void this.searchMusic(musicCommand.query, true));
        return;
    }
  }

  private finishThinking(): void {
    this.isThinking = false;
    this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
    this.scheduleRecognitionRestart(250);
  }

  // Para comandos rápidos (volumen, pausa) que no hablan: no interrumpimos la
  // canción con voz, pero dejamos el micrófono listo para el siguiente comando.
  private keepListeningAfterControl(): void {
    this.isThinking = false;
    this.status = this.currentVideoId ? 'reproduciendo música' : 'escuchando';
    if (this.conversationEnabled) {
      this.listenIgnoreUntil = Date.now() + 400;
      this.scheduleRecognitionRestart(400);
    }
  }

  private speak(text: string, afterSpeech?: () => void): void {
    if (!window.speechSynthesis) {
      this.finishThinking();
      afterSpeech?.();
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
    utterance.onstart = () => this.zone.run(() => {
      this.assistantSpeechPhase = 'started';
      this.status = 'asistente hablando';
      this.startSpeechMouthMotion();
      // Activa el reconocimiento paralelo para que una frase humana pueda
      // interrumpir la síntesis sin necesidad de pulsar el botón.
      this.startInterruptionDetection(650);
    });
    utterance.onpause = () => this.zone.run(() => {
      this.assistantSpeechPhase = 'paused';
      this.status = 'asistente en pausa';
      this.stopSpeechMouthMotion();
    });
    utterance.onresume = () => this.zone.run(() => {
      this.assistantSpeechPhase = 'started';
      this.status = 'asistente hablando';
      this.startSpeechMouthMotion();
    });
    utterance.onboundary = () => this.pulseSpeechMouth();
    utterance.onend = () => this.zone.run(() => {
      this.isSpeaking = false;
      this.stopSpeechMouthMotion();
      this.clearInterruptionDetection();

      if (this.speechInterrupted) {
        this.speechInterrupted = false;
        return;
      }

      this.assistantSpeechPhase = 'ended';
      this.listenIgnoreUntil = Date.now() + 250;
      afterSpeech?.();

      this.status = this.conversationEnabled ? 'escuchando' : 'microfono apagado';
      this.scheduleRecognitionRestart(300);
    });
    utterance.onerror = () => this.zone.run(() => {
      this.isSpeaking = false;
      this.stopSpeechMouthMotion();
      this.clearInterruptionDetection();
      this.assistantSpeechPhase = 'ended';
      this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
      this.scheduleRecognitionRestart(250);
      afterSpeech?.();
    });

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  private startSpeechMouthMotion(): void {
    this.clearSpeechMouthTimer();
    this.pulseSpeechMouth();
    this.speechMouthTimer = window.setInterval(() => this.pulseSpeechMouth(), 220);
  }

  private pulseSpeechMouth(): void {
    if (!this.isSpeaking) {
      return;
    }

    this.speechMouthOpen = true;
    window.setTimeout(() => {
      this.speechMouthOpen = false;
    }, 110);
  }

  private stopSpeechMouthMotion(): void {
    this.clearSpeechMouthTimer();
    this.speechMouthOpen = false;
  }

  private clearSpeechMouthTimer(): void {
    if (this.speechMouthTimer !== null) {
      window.clearInterval(this.speechMouthTimer);
      this.speechMouthTimer = null;
    }
  }

  private isHumanInterruption(text: string, confidence = 0, durationMs = 0): boolean {
    const normalized = this.normalizeCommandText(text)
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized || normalized.length < 3) {
      return false;
    }

    const words = normalized.split(' ').filter((word) => word.length > 1);
    const explicitSingleWord = /^(geria|oye|para|basta|espera|detente|escucha|no|si)$/.test(normalized);
    if (words.length < 2 && !explicitSingleWord) {
      return false;
    }

    // Algunos motores informan confianza 0 cuando no la calculan. Solo se
    // descartan resultados cuando sí existe una puntuación y es muy baja.
    if (confidence > 0 && confidence < 0.35) {
      return false;
    }
    if (durationMs > 0 && durationMs < 250 && !explicitSingleWord) {
      return false;
    }

    // Evita que el micrófono confunda la propia voz sintetizada de GeriaBot
    // con una interrupción del usuario.
    const spokenReply = this.normalizeCommandText(this.reply)
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (spokenReply && normalized.length >= 4 && spokenReply.includes(normalized)) {
      return false;
    }

    return true;
  }

  private startReminderClock(): void {
    if (this.reminderTimer !== null) {
      window.clearInterval(this.reminderTimer);
    }
    this.checkScheduledReminders();
    this.reminderTimer = window.setInterval(() => this.checkScheduledReminders(), 15000);
  }

  private checkScheduledReminders(): void {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const reminders: Array<{ key: string; title: string; message: string; time: string }> = [];

    if (this.profile.wakeTime === time) {
      reminders.push({ key: 'wake', title: 'Alarma para despertar', message: 'Es hora de levantarse.', time });
    }
    if (this.profile.sleepTime === time) {
      reminders.push({ key: 'sleep', title: 'Recordatorio para dormir', message: 'Es hora de prepararte para dormir.', time });
    }

    if (this.profile.requiresMedication) {
      const dueMedications = this.profile.medications.filter((medication) => medication.schedule === time);
      if (dueMedications.length > 0) {
        const description = dueMedications.map((medication) => {
          const name = medication.name?.trim() || 'tu medicamento';
          const appearance = medication.colorOrShape?.trim();
          return appearance ? `${name}, ${appearance}` : name;
        }).join('; ');
        reminders.push({
          key: `medication-${time}`,
          title: 'Hora de tus pastillas',
          message: `Debes tomar: ${description}.`,
          time,
        });
      }
    }

    for (const reminder of reminders) {
      const dailyKey = `${day}-${reminder.key}`;
      if (this.triggeredReminders.has(dailyKey)) continue;
      this.triggeredReminders.add(dailyKey);
      this.reminderPosition = null;
      this.activeReminder = reminder;
      this.reply = reminder.message;
      // La alarma deja el micrófono preparado para poder apagarla por voz,
      // incluso si la conversación estaba inactiva antes del aviso.
      this.conversationEnabled = true;
      this.speak(`${reminder.title}. ${reminder.message}`);
    }
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
    this.stopSpeechMouthMotion();
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
    if (this.currentVideoId && !this.isSpeaking && !this.isThinking) {
      return "Sonando música. Di: 'siguiente', 'pausa', 'sube/baja el volumen', 'la número 3', 'cierra' o 'detén la música'.";
    }
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
