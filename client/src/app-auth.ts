/**
 * Auth controller for trip-app.
 * 
 * Manages authentication state, login/logout, and auth UI rendering.
 */

import { html, css, TemplateResult } from "lit";
import { checkAuthRequired, tryAutoLogin, login, logout, setAuthFailureHandler } from "./auth";
import { clientDataCache } from "./client-data-cache";

export interface AuthState {
  authRequired: boolean;
  authChecking: boolean;
  authUser: string | null;
  authError: string | null;
  userMenuOpen: boolean;
  availableTrips: string[];
}

export interface AuthCallbacks {
  onAuthComplete: (user: string | null, lastTripId: string | null) => void;
  onLogout: () => void;
  requestUpdate: () => void;
}

export class AppAuth {
  private state: AuthState = {
    authRequired: false,
    authChecking: true,
    authUser: null,
    authError: null,
    userMenuOpen: false,
    availableTrips: []
  };

  private callbacks: AuthCallbacks;

  constructor(callbacks: AuthCallbacks) {
    this.callbacks = callbacks;
  }

  // --- Getters for state ---

  get authRequired(): boolean {
    return this.state.authRequired;
  }

  get authChecking(): boolean {
    return this.state.authChecking;
  }

  get authUser(): string | null {
    return this.state.authUser;
  }

  get authError(): string | null {
    return this.state.authError;
  }

  get userMenuOpen(): boolean {
    return this.state.userMenuOpen;
  }

  get availableTrips(): string[] {
    return this.state.availableTrips;
  }

  // --- Setters that trigger updates ---

  set authUser(value: string | null) {
    this.state.authUser = value;
    this.callbacks.requestUpdate();
  }

  // --- Lifecycle ---

  init(): void {
    // Register auth failure handler to show login screen on 401
    setAuthFailureHandler(() => {
      console.log("[app-auth] Auth failure detected - showing login screen");
      this.state.authUser = null;
      this.callbacks.requestUpdate();
    });
  }

  destroy(): void {
    setAuthFailureHandler(null);
  }

  // --- Auth check ---

  async checkAuth(): Promise<void> {
    this.state.authChecking = true;
    this.state.authError = null;
    this.callbacks.requestUpdate();

    // Check if auth is required
    this.state.authRequired = await checkAuthRequired();

    if (!this.state.authRequired) {
      this.state.authChecking = false;
      this.callbacks.requestUpdate();
      this.callbacks.onAuthComplete(null, null);
      return;
    }

    // Try auto-login with cached auth key
    const result = await tryAutoLogin();
    if (result) {
      this.state.authUser = result.auth.user;
      this.state.authChecking = false;
      this.callbacks.requestUpdate();
      
      // Refresh available trips from cache
      this.refreshAvailableTrips();
      
      this.callbacks.onAuthComplete(result.auth.user, result.lastTripId ?? null);
      return;
    }

    this.state.authChecking = false;
    this.callbacks.requestUpdate();
    this.callbacks.onAuthComplete(null, null);
  }

  refreshAvailableTrips(): void {
    const trips = clientDataCache.get<string[]>("tripList");
    if (trips && Array.isArray(trips)) {
      this.state.availableTrips = trips;
      this.callbacks.requestUpdate();
    }
  }

  // --- Login/Logout ---

  async handleLoginSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const user = formData.get("user") as string;
    const password = formData.get("password") as string;

    this.state.authError = null;
    this.callbacks.requestUpdate();

    const result = await login(user, password);

    if (result.ok) {
      this.state.authUser = user;
      this.callbacks.requestUpdate();
      this.callbacks.onAuthComplete(user, result.lastTripId ?? null);
    } else {
      this.state.authError = result.error || "Login failed";
      this.callbacks.requestUpdate();
    }
  }

  async handleLogout(): Promise<void> {
    this.state.userMenuOpen = false;
    await logout();
    this.state.authUser = null;
    this.callbacks.requestUpdate();
    this.callbacks.onLogout();
  }

  // --- User menu ---

  toggleUserMenu(e: Event): void {
    e.stopPropagation();
    this.state.userMenuOpen = !this.state.userMenuOpen;
    this.callbacks.requestUpdate();
  }

  closeUserMenuIfOpen(e: Event, authBarElement: Element | null): void {
    if (this.state.userMenuOpen) {
      const target = e.target as HTMLElement;
      if (authBarElement && !authBarElement.contains(target)) {
        this.state.userMenuOpen = false;
        this.callbacks.requestUpdate();
      }
    }
  }

  // --- Rendering ---

  renderLogin(): TemplateResult {
    return html`
      <div class="auth-container">
        <form class="auth-form" @submit=${(e: Event) => this.handleLoginSubmit(e)}>
          <h2>Travelr Login</h2>
          ${this.state.authError ? html`<div class="auth-error">${this.state.authError}</div>` : ""}
          <label for="user">Username</label>
          <input type="text" id="user" name="user" required autocomplete="username" />
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password" />
          <button type="submit">Login</button>
        </form>
      </div>
    `;
  }

  renderUserMenu(): TemplateResult {
    if (!this.state.authUser) {
      return html``;
    }
    return html`
      <div class="auth-bar">
        <div class="user-avatar" @click=${(e: Event) => this.toggleUserMenu(e)}>
          ${this.state.authUser.charAt(0)}
        </div>
        <div class="user-menu ${this.state.userMenuOpen ? 'open' : ''}">
          <div class="user-menu-header">Signed in as <strong>${this.state.authUser}</strong></div>
          <button class="user-menu-item" @click=${() => this.handleLogout()}>Logout</button>
        </div>
      </div>
    `;
  }
}

// --- CSS for auth components (to be included in trip-app styles) ---
export const authStyles = css`
  .auth-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-size: 1.2rem;
    color: #64748b;
  }

  .auth-container {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }

  .auth-form {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    width: 320px;
  }

  .auth-form h2 {
    margin: 0 0 1.5rem 0;
    color: #1e293b;
  }

  .auth-form label {
    display: block;
    margin-bottom: 0.5rem;
    color: #475569;
    font-size: 0.875rem;
  }

  .auth-form input {
    width: 100%;
    padding: 0.75rem;
    margin-bottom: 1rem;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 1rem;
    box-sizing: border-box;
  }

  .auth-form input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .auth-form button {
    width: 100%;
    padding: 0.75rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 1rem;
    cursor: pointer;
  }

  .auth-form button:hover {
    background: #2563eb;
  }

  .auth-error {
    color: #dc2626;
    margin-bottom: 1rem;
    padding: 0.5rem;
    background: #fef2f2;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .auth-bar {
    position: absolute;
    top: 0.5rem;
    right: 1rem;
    z-index: 100;
  }

  .user-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #3b82f6;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    text-transform: uppercase;
    user-select: none;
    border: 2px solid transparent;
    transition: border-color 0.15s;
  }

  .user-avatar:hover {
    border-color: #93c5fd;
  }

  .user-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.5rem;
    background: white;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
    min-width: 160px;
    padding: 0.5rem 0;
    display: none;
  }

  .user-menu.open {
    display: block;
  }

  .user-menu-header {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.875rem;
    color: #64748b;
  }

  .user-menu-item {
    display: block;
    width: 100%;
    padding: 0.5rem 1rem;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.875rem;
    color: #334155;
  }

  .user-menu-item:hover {
    background: #f1f5f9;
  }
`;
