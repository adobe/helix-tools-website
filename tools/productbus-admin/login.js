/**
 * ProductBus Admin - Login page (OTP flow)
 */

import { apiFetch, setAuthState } from './api.js';
import { showToast } from './ui.js';

export async function render(container, ctx) {
  const { org, site } = ctx;
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect') || '';

  container.innerHTML = `
    <div class="login-container">
      <h1>ProductBus Admin Login</h1>
      <p class="subtitle">Enter your email to receive a verification code</p>
      <form class="login-form" id="login-form">
        <div class="form-field">
          <label for="login-email">Email</label>
          <input type="email" id="login-email" name="email" required placeholder="you@example.com">
        </div>
        <div class="button-group">
          <button type="submit" class="button">Send Code</button>
        </div>
      </form>
    </div>
  `;

  const form = document.getElementById('login-form');
  let loginState = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait...';

    try {
      if (!loginState) {
        // Step 1: Request OTP
        const email = form.querySelector('#login-email').value;
        const resp = await apiFetch(org, site, 'auth/login', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        loginState = await resp.json();
        loginState.email = email;

        // Switch to OTP entry
        form.innerHTML = `
          <div class="form-field">
            <label>Email</label>
            <input type="text" value="${email}" disabled>
          </div>
          <div class="form-field">
            <label for="otp-code">Verification Code</label>
            <input type="text" id="otp-code" name="code" required
              placeholder="123456" maxlength="6" pattern="[0-9]{6}"
              autocomplete="one-time-code" inputmode="numeric">
            <p class="field-hint">Enter the 6-digit code sent to your email</p>
          </div>
          <div class="button-group">
            <button type="button" class="button outline" id="login-back-btn">Back</button>
            <button type="submit" class="button">Verify</button>
          </div>
        `;

        form.querySelector('#login-back-btn').addEventListener('click', () => {
          render(container, ctx);
        });
        form.querySelector('#otp-code').focus();
      } else {
        // Step 2: Verify OTP
        const code = form.querySelector('#otp-code').value;
        const resp = await apiFetch(org, site, 'auth/callback', {
          method: 'POST',
          body: JSON.stringify({
            email: loginState.email,
            code,
            hash: loginState.hash,
            exp: loginState.exp,
          }),
        });
        const result = await resp.json();

        setAuthState(org, site, {
          token: result.token,
          email: result.email,
          roles: result.roles,
          org: result.org,
          site: result.site,
        });

        if (redirect) {
          window.location.href = redirect;
        } else {
          const p = new URLSearchParams(window.location.search);
          p.set('page', 'orders');
          p.delete('redirect');
          window.location.href = `${window.location.pathname}?${p.toString()}`;
        }
      }
    } catch (error) {
      showToast(error.message || 'Login failed', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = loginState ? 'Verify' : 'Send Code';
    }
  });
}

export function destroy() {}
