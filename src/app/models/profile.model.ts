// Perfil del adulto mayor y sus datos asociados.

export type EmergencyContact = {
  name: string;
  relationship: string;
  phone: string;
};

export type Medication = {
  name: string;
  schedule: string;
  colorOrShape: string;
};

export type ProfileSummary = {
  id: number;
  personName: string;
};

export type SeniorProfile = {
  id?: number;
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
