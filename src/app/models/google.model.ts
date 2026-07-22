// Tipos de Google Identity Services (login con Google) y la extensión de Window.

export type GoogleCredentialResponse = {
  credential?: string;
};

export type GoogleIdentity = {
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
