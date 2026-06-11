import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

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

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  private readonly apiUrl = 'http://localhost:8000/api/gemini';
  private recognition: SpeechRecognitionInstance | null = null;
  private listenIgnoreUntil = 0;
  private speechInterrupted = false;
  private pauseTimer: number | null = null;
  private recognitionRestartTimer: number | null = null;

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
  musicResults: Array<{ title: string; artist: string }> = [];

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
      this.stopRecognition();
      return;
    }

    this.conversationEnabled = true;
    this.userSpeechPhase = 'idle';
    this.startRecognition();
  }

  private startRecognition(): void {
    this.clearRecognitionRestart();

    if (!this.conversationEnabled || this.isSpeaking || this.isThinking) {
      return;
    }

    if (this.recognizing) {
      return;
    }

    try {
      this.recognition = this.createRecognition();

      if (!this.recognition) {
        this.reply = 'Tu navegador no soporta reconocimiento de voz.';
        this.conversationEnabled = false;
        this.status = 'microfono apagado';
        return;
      }

      this.recognition.start();
      this.recognizing = true;
      this.status = 'escuchando';
    } catch (e) {
      console.error('No se pudo iniciar reconocimiento', e);
      this.recognizing = false;
      this.recognition = null;
      this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
      this.scheduleRecognitionRestart(350);
    }
  }

  private createRecognition(): SpeechRecognitionInstance | null {
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
      if (this.isSpeaking || Date.now() < this.listenIgnoreUntil) {
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
      console.error('Recognition error', event);
      this.recognizing = false;
      if (this.recognition === recognition) {
        this.recognition = null;
      }

      if (this.conversationEnabled && !this.isSpeaking && !this.isThinking) {
        this.status = 'escuchando';
        this.scheduleRecognitionRestart(500);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text })
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
      this.assistantSpeechPhase = 'ended';
      this.status = this.conversationEnabled ? 'listo para escuchar' : 'microfono apagado';
      this.scheduleRecognitionRestart(250);
    };

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  private startInterruptionDetection(): void {
    if (!this.conversationEnabled) {
      return;
    }

    this.listenIgnoreUntil = Date.now() + 600;

    setTimeout(() => {
      if (!this.isSpeaking || !this.conversationEnabled) {
        return;
      }

      try {
        this.recognition = this.createRecognition();
        this.recognition?.start();
        this.recognizing = true;
      } catch {
        this.recognizing = false;
        this.recognition = null;
      }
    }, 600);
  }

  private interruptSpeech(): void {
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
    if (this.isSpeaking) return 'Presiona para interrumpir';
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
    if (this.isSpeaking) return 'Toca el boton para cortar la voz y responder.';
    if (this.isThinking) return 'Espera un momento.';
    if (this.assistantSpeechPhase === 'interrupted') return 'El usuario corto la respuesta.';
    if (this.assistantSpeechPhase === 'ended' && !this.recognizing) return 'La respuesta termino.';
    if (this.userSpeechPhase === 'interrupted') return 'Corte la respuesta para escucharte.';
    if (this.userSpeechPhase === 'speaking') return 'Sigue hablando, te estoy escuchando.';
    if (this.userSpeechPhase === 'paused') return 'Detecte una pausa breve.';
    if (this.userSpeechPhase === 'ended') return 'Envio tu frase al asistente.';
    if (this.recognizing) return 'Habla ahora con claridad.';
    if (this.conversationEnabled) return 'Te escuchare cuando termines de hablar.';
    return 'Toca el boton para iniciar la conversacion.';
  }
}
