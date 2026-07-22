// Tipos de autenticación (login / registro).

export type AuthMode = 'login' | 'registro';

export type AuthForm = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type AuthUser = {
  id?: number;
  name: string;
  email: string;
  provider: 'email' | 'google';
};
