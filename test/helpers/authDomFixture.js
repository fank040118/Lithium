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

  <div id="sync-conflict-overlay" class="overlay overlay-mid sync-conflict-overlay hidden" role="alertdialog" aria-modal="true" aria-labelledby="sync-conflict-title">
    <div class="dialog-card sync-conflict-card">
      <h2 id="sync-conflict-title" class="sync-conflict-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/>
          <path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>
          <path d="M2 2l20 20"/>
        </svg>
        <span data-i18n="dialog.syncConflict.title">本地与云端数据不一致</span>
      </h2>
      <p id="sync-conflict-text" class="sync-conflict-text"></p>
      <p id="sync-conflict-account-warn" class="sync-conflict-warn hidden"></p>
      <div class="sync-conflict-compare">
        <div id="sync-conflict-local" class="sync-conflict-side">
          <div class="sync-conflict-side-label" data-field="label"></div>
          <div class="sync-conflict-side-timelabel" data-field="timeLabel"></div>
          <div class="sync-conflict-side-time" data-field="time"></div>
          <div class="sync-conflict-side-count" data-field="shortcuts"></div>
          <div class="sync-conflict-side-count" data-field="folders"></div>
        </div>
        <div id="sync-conflict-cloud" class="sync-conflict-side">
          <div class="sync-conflict-side-label" data-field="label"></div>
          <div class="sync-conflict-side-timelabel" data-field="timeLabel"></div>
          <div class="sync-conflict-side-time" data-field="time"></div>
          <div class="sync-conflict-side-count" data-field="shortcuts"></div>
          <div class="sync-conflict-side-count" data-field="folders"></div>
        </div>
      </div>
      <p id="sync-conflict-error" class="sync-conflict-error hidden" role="alert"></p>
      <div class="dialog-actions sync-conflict-actions">
        <button type="button" id="sync-conflict-use-local" class="btn-secondary" data-i18n="dialog.syncConflict.useLocal">使用本地</button>
        <button type="button" id="sync-conflict-use-cloud" class="btn-secondary" data-i18n="dialog.syncConflict.useCloud">使用云端</button>
      </div>
      <div id="sync-conflict-signout-row" class="sync-conflict-signout hidden">
        <span data-i18n="dialog.syncConflict.wrongAccount">登错账号？</span>
        <button type="button" id="sync-conflict-signout" class="forgot-password-btn" data-i18n="dialog.syncConflict.signOut">退出登录</button>
      </div>
    </div>
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
