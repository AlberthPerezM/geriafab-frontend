import { Injectable } from '@angular/core';
import { ProfileSummary, SeniorProfile } from '../../models';
import { ApiService } from './api.service';

/**
 * Logica de datos de las fichas de adultos mayores: llamadas al backend,
 * almacenamiento local y valores por defecto del formulario. No guarda estado
 * de vista; el componente mantiene el perfil activo.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  readonly maxProfiles = 2;
  private readonly profileStorageKey = 'geriafab_senior_profile';
  private readonly activeProfileStorageKey = 'geriafab_active_profile_id';

  constructor(private readonly api: ApiService) {}

  // --- API backend ---

  list(): Promise<{ profiles: ProfileSummary[] }> {
    return this.api.getJson<{ profiles: ProfileSummary[] }>('/api/profiles');
  }

  get(id: number): Promise<{ profile: SeniorProfile | null }> {
    return this.api.getJson<{ profile: SeniorProfile | null }>(`/api/profiles/${id}`);
  }

  create(profile: SeniorProfile): Promise<{ profile: SeniorProfile }> {
    return this.api.postJson<{ profile: SeniorProfile }>('/api/profiles', { profile });
  }

  update(id: number, profile: SeniorProfile): Promise<{ profile: SeniorProfile }> {
    return this.api.putJson<{ profile: SeniorProfile }>(`/api/profiles/${id}`, { profile });
  }

  remove(id: number, password: string): Promise<unknown> {
    return this.api.deleteJson(`/api/profiles/${id}`, { password });
  }

  // --- Almacenamiento local ---

  saveLocally(profile: SeniorProfile): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(this.profileStorageKey, JSON.stringify(profile));
  }

  loadLocal(): SeniorProfile | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const saved = localStorage.getItem(this.profileStorageKey);
    if (!saved) {
      return null;
    }
    try {
      const profile = { ...this.createEmpty(), ...JSON.parse(saved) } as SeniorProfile;
      this.ensureMinimumRows(profile);
      return profile;
    } catch {
      return null;
    }
  }

  clearLocal(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.profileStorageKey);
    }
  }

  getStoredActiveId(): number | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(this.activeProfileStorageKey);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }

  setStoredActiveId(id: number | null): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    if (id === null) {
      localStorage.removeItem(this.activeProfileStorageKey);
    } else {
      localStorage.setItem(this.activeProfileStorageKey, String(id));
    }
  }

  // --- Valores por defecto y normalizacion del formulario ---

  ensureMinimumRows(profile: SeniorProfile): void {
    if (!Array.isArray(profile.medications) || profile.medications.length === 0) {
      profile.medications = [{ name: '', schedule: '', colorOrShape: '' }];
    }

    if (!Array.isArray(profile.emergencyContacts)) {
      profile.emergencyContacts = [];
    }

    while (profile.emergencyContacts.length < 2) {
      profile.emergencyContacts.push({ name: '', relationship: '', phone: '' });
    }
  }

  createEmpty(): SeniorProfile {
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
}
