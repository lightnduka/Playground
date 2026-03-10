import { TestBed } from '@angular/core/testing';
import { App } from './app.component';

describe('App', () => {
  it('creates the app', async () => {
    await TestBed.configureTestingModule({
      imports: [App]
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
