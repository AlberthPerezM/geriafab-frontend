import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { AuthService, ProfileService } from './core/services';

const user = { id: 1, name: 'Apoderado', email: 'test@example.com', provider: 'email' as const };

describe('Entrada a perfiles', () => {
  let auth: AuthService;
  let profiles: ProfileService;

  beforeEach(async () => {
    localStorage.removeItem('geriafab_auth_session');
    localStorage.removeItem('geriafab_auth_token');
    localStorage.removeItem('geriafab_active_profile_id');
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
    spyOn<any>(AppComponent.prototype, 'startReminderClock').and.stub();
    auth = TestBed.inject(AuthService);
    profiles = TestBed.inject(ProfileService);
    spyOn(profiles, 'get').and.callFake(async id => ({ profile: { ...profiles.createEmpty(), id, personName: 'Oscar' } }));
    spyOn(auth, 'fetchCurrentUser').and.resolveTo({ user });
  });

  async function checkEntry(hasProfiles: boolean, restored: boolean): Promise<void> {
    spyOn(profiles, 'list').and.resolveTo({ profiles: hasProfiles ? [{ id: 1, personName: 'Oscar' }] : [] });
    if (restored) {
      localStorage.setItem('geriafab_auth_session', JSON.stringify(user));
      localStorage.setItem('geriafab_auth_token', 'test-token');
    }
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    if (!restored) {
      spyOn(auth, 'login').and.callFake(async () => { auth.setSession(user, 'test-token'); return user; });
      fixture.componentInstance.authForm.email = user.email;
      fixture.componentInstance.authForm.password = 'password';
      fixture.componentInstance.submitAuth();
      await new Promise(resolve => setTimeout(resolve, 20));
      await fixture.whenStable();
    }
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.profile-selection-page') !== null).toBe(hasProfiles);
    expect(el.querySelector('.settings-panel') !== null).toBe(!hasProfiles);
    expect(el.querySelector('.voice-stage')).toBeNull();
    fixture.destroy();
  }

  it('muestra el selector al iniciar sesion con perfiles', async () => checkEntry(true, false));
  it('abre la creacion al iniciar sesion sin perfiles', async () => checkEntry(false, false));
  it('muestra el selector al recuperar una sesion con perfiles', async () => checkEntry(true, true));
  it('abre la creacion al recuperar una sesion sin perfiles', async () => checkEntry(false, true));
});
