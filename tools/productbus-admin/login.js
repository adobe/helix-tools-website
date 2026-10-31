/**
 * ProductBus Admin - Login page (OTP flow)
 */

import { apiFetch, setAuthState } from './api.js';
import { showToast, escapeHtml } from './ui.js';

function navigate(search) {
  window.history.pushState({}, '', `${window.location.pathname}?${search}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function readError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

export async function render(container, ctx) {
  const { org, site } = ctx;

  container.innerHTML = `
    <div class="login-wrap">
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

    const resetSubmit = () => {
      submitBtn.disabled = false;
      submitBtn.textContent = loginState ? 'Verify' : 'Send Code';
    };

    try {
      if (!loginState) {
        // Step 1: Request OTP
        const email = form.querySelector('#login-email').value;
        const resp = await apiFetch(org, site, 'auth/login', {
          method: 'POST',
          body: JSON.stringify({ email }),
          skipAuthRedirect: true,
        });
        if (!resp.ok) {
          showToast(await readError(resp), 'error');
          resetSubmit();
          return;
        }
        const next = await resp.json();
        loginState = { ...next, email };

        // Switch to OTP entry
        form.innerHTML = `
          <div class="form-field">
            <label for="otp-email">Email</label>
            <input type="text" id="otp-email" value="${escapeHtml(email)}" disabled>
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
          loginState = null;
          render(container, ctx);
        });
        const otpInput = form.querySelector('#otp-code');
        otpInput.focus();
        otpInput.addEventListener('input', () => {
          otpInput.classList.remove('input-error');
        });
      } else {
        // Step 2: Verify OTP
        const otpInput = form.querySelector('#otp-code');
        const code = otpInput.value;
        const resp = await apiFetch(org, site, 'auth/callback', {
          method: 'POST',
          body: JSON.stringify({
            email: loginState.email,
            code,
            hash: loginState.hash,
            exp: loginState.exp,
          }),
          skipAuthRedirect: true,
        });
        if (resp.status === 401) {
          otpInput.classList.add('input-error');
          otpInput.focus();
          otpInput.select();
          showToast('Invalid code', 'error');
          resetSubmit();
          return;
        }
        if (!resp.ok) {
          showToast(await readError(resp), 'error');
          resetSubmit();
          return;
        }
        const result = await resp.json();

        setAuthState(org, site, {
          token: result.token,
          email: result.email,
          roles: result.roles,
          org: result.org,
          site: result.site,
        });

        const p = new URLSearchParams();
        p.set('org', org);
        p.set('site', site);
        p.set('page', 'orders');
        navigate(p.toString());
      }
    } catch (error) {
      showToast(error.message || 'Login failed', 'error');
      resetSubmit();
    }
  });
}

export function destroy() {}
