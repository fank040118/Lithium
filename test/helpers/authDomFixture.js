export function mountAuthDom() {
  document.body.innerHTML = `
    <div id="sync-status-text" class="sidebar-sync-status"></div>
    <p id="sync-conflict-hint" class="sidebar-sync-hint hidden"></p>
    <div id="sync-login-section"></div>
    <div id="sync-logged-section" class="hidden"></div>
    <button id="sync-upload-btn"></button>
    <button id="sync-download-btn"></button>
    <button id="sync-delete-account-btn"></button>

    <div id="login-consent-overlay" class="overlay hidden">
      <button id="login-consent-cancel"></button>
      <button id="login-consent-agree"></button>
    </div>

    <div id="delete-account-overlay" class="overlay hidden">
      <button id="delete-account-cancel"></button>
      <button id="delete-account-confirm" disabled>确认删除(5)</button>
    </div>

    <div id="login-overlay" class="overlay hidden">
      <div class="auth-tabs">
        <button class="auth-tab active" data-mode="login"></button>
        <button class="auth-tab" data-mode="signup"></button>
      </div>
      <div id="auth-pane-login" class="auth-pane">
        <input id="login-email" type="email">
        <input id="login-password" type="password">
        <button id="forgot-password-btn"></button>
        <p id="login-error"></p>
        <button id="login-submit-btn"></button>
      </div>
      <div id="auth-pane-signup" class="auth-pane hidden">
        <input id="signup-email" type="email">
        <input id="signup-password" type="password">
        <input id="signup-password-confirm" type="password">
        <p id="signup-error"></p>
        <button id="signup-submit-btn"></button>
      </div>
      <div id="auth-pane-verify" class="auth-pane hidden">
        <span id="verify-email-target"></span>
        <p id="verify-status"></p>
        <button id="verify-check-btn"></button>
        <button id="verify-resend-btn"></button>
      </div>
      <button id="login-skip-btn"></button>
    </div>
  `;
}
