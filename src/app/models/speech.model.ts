// Tipos del reconocimiento de voz (Web Speech API) usados por el asistente.

export type SpeechRecognitionInstance = {
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

export type SpeechRecognitionEventLike = {
  results: {
    length: number;
    [index: number]: {
      isFinal?: boolean;
      [index: number]: {
        transcript: string;
        confidence?: number;
      };
    };
  };
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export type RecognitionPurpose = 'conversation' | 'interruption';
