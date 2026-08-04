import {
  before, describe, it, mock,
} from 'node:test';
import assert from 'node:assert/strict';

const readyPromises = [];
mock.module('../../../scripts/scripts.js', {
  namedExports: {
    registerToolReady: (...promises) => {
      readyPromises.push(...promises);
    },
  },
});

const catalogs = {
  fr: {
    'app.language.label': 'Langue',
    'app.title.login': 'Portail de chargement',
    'app.title.upload': 'Charger des ressources',
    'login.lead': 'Connexion en français',
    'login.form.username.label': 'Nom d’utilisateur',
    'login.form.username.placeholder': 'Utilisateur',
    'login.form.password.label': 'Mot de passe',
    'login.form.password.placeholder': 'Mot de passe',
    'login.continue': 'Continuer vers le chargement',
    'upload.metadata.title': 'Métadonnées',
    'upload.metadata.appliesToBatch': 'Pour chaque fichier',
    'upload.metadata.select': '— Sélectionner —',
    'upload.batch.label': 'Lot {number, number}',
    'upload.batch.accessibleLabel': 'Lot {number, number}',
    'upload.batch.add': 'Ajouter un lot',
    'upload.dropZone.label': 'Charger des fichiers',
    'upload.dropZone.prompt': 'Déposer les fichiers ici',
    'upload.dropZone.browse': 'Parcourir les fichiers',
    'upload.dropZone.selectFolder': 'Sélectionner un dossier',
    'upload.pathPolicy.preserve': 'Structure conservée',
    'upload.signedInAs': 'Connecté en tant que {username}',
    'user.menu.label': 'Menu utilisateur',
    'user.menu.signedInAs': 'Connecté en tant que {username}',
    'user.menu.signOut': 'Se déconnecter',
  },
  hi: {
    'app.language.label': 'भाषा',
    'app.title.login': 'अपलोड पोर्टल',
    'login.lead': 'हिन्दी में साइन इन करें',
    'login.form.username.label': 'उपयोगकर्ता नाम',
    'login.form.username.placeholder': 'उपयोगकर्ता',
    'login.form.password.label': 'पासवर्ड',
    'login.form.password.placeholder': 'पासवर्ड',
    'login.continue': 'अपलोड करने के लिए आगे बढ़ें',
  },
  ar: {
    'app.language.label': 'اللغة',
    'app.title.login': 'بوابة التحميل',
    'app.title.upload': 'تحميل الأصول',
    'login.lead': 'تسجيل الدخول بالعربية',
    'login.form.username.label': 'اسم المستخدم',
    'login.form.username.placeholder': 'اسم المستخدم',
    'login.form.password.label': 'كلمة المرور',
    'login.form.password.placeholder': 'كلمة المرور',
    'login.continue': 'المتابعة إلى التحميل',
    'upload.metadata.title': 'بيانات التعريف',
    'upload.metadata.appliesToBatch': 'لكل ملف',
    'upload.metadata.select': '— تحديد —',
    'upload.batch.label': 'الدفعة {number, number}',
    'upload.batch.accessibleLabel': 'دفعة {number, number}',
    'upload.batch.add': 'إضافة دفعة',
    'upload.dropZone.label': 'تحميل الملفات',
    'upload.dropZone.prompt': 'أفلِت الملفات هنا',
    'upload.dropZone.browse': 'استعراض الملفات',
    'upload.dropZone.selectFolder': 'تحديد مجلد',
    'upload.pathPolicy.preserve': 'تم الاحتفاظ بالبنية',
    'upload.signedInAs': 'تم تسجيل الدخول باسم {username}',
    'user.menu.label': 'قائمة المستخدم',
    'user.menu.signedInAs': 'تم تسجيل الدخول باسم {username}',
    'user.menu.signOut': 'تسجيل الخروج',
  },
  en: {
    'app.language.label': 'Language',
    'app.title.login': 'Upload portal',
    'login.lead': 'Sign in',
    'login.form.username.label': 'Username',
    'login.form.password.label': 'Password',
    'login.continue': 'Continue',
  },
};

function portalMarkup() {
  document.body.innerHTML = `
    <main><div id="asp-portal-shell" class="asp-portal-shell">
      <section id="asp-portal-header"><div id="asp-portal-brand">
        <div id="asp-portal-logo"><img alt=""></div>
        <div id="asp-portal-title"><h1></h1></div>
        <div><label id="asp-language-label" for="asp-language"></label>
          <select id="asp-language"></select>
          <p id="asp-language-message" hidden></p></div>
      </div><div id="asp-portal-banner"></div></section>
      <section><div id="asp-portal-signin">
        <p class="login-lead"></p><p id="asp-login-message" hidden></p>
        <form id="asp-login-form">
          <label id="asp-username-label" for="username"></label>
          <input id="username" required>
          <label id="asp-password-label" for="password"></label>
          <input id="password" type="password" required>
          <button id="asp-login-button"></button>
        </form>
      </div><div id="asp-upload-view" hidden></div>
      <div id="asp-confirmation-view" hidden></div></section>
      <div id="asp-modal-root"></div>
    </div></main>`;
}

async function waitFor(predicate) {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
  assert.fail('Timed out waiting for localized portal state');
}

describe('localized portal UI', () => {
  const catalogRequests = [];

  before(async () => {
    portalMarkup();
    window.history.replaceState(null, '', '/?org=customer&lang=fr');
    const fetchStub = async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl === './portal-config.json') {
        return new Response(JSON.stringify({
          apiBaseUrl: 'https://api.example.com',
          org: '',
          locale: 'en',
          uploadHostSuffixes: ['.adobeaemcloud.com'],
          branding: { title: 'Configured brand', logoSrc: '/icons/adobe.svg' },
        }));
      }
      if (requestUrl.endsWith('/i18n/manifest.json')) {
        return new Response(JSON.stringify({
          defaultLocale: 'en',
          catalogs: Object.fromEntries(Object.keys(catalogs).map((locale) => [
            locale,
            { url: `./${locale}.hash.json`, sha256: locale },
          ])),
        }));
      }
      const catalogLocale = requestUrl.match(/\/(en|fr|hi|ar)\.hash\.json$/)?.[1];
      if (catalogLocale) {
        catalogRequests.push(catalogLocale);
        return new Response(JSON.stringify(catalogs[catalogLocale]));
      }
      if (requestUrl.includes('/portal-branding/login?')) return new Response('{}');
      if (requestUrl.includes('/session?') && options.method === 'POST') {
        return new Response(JSON.stringify({
          sessionToken: 'memory-token',
          expiresAt: Date.now() + 60000,
          username: 'vendor.user',
          vendor: { vendorId: 'vendor-one', name: 'Vendor Display Name' },
          metadataSchema: {
            editable: [{
              id: 'campaignTitle',
              label: 'Campaign title',
              labelByLocale: { en: 'Campaign title', fr: 'Titre de campagne', ar: 'عنوان الحملة' },
              type: 'text',
            }],
            required: [],
            prepopulated: {},
          },
          portalLocalization: {
            supportedLocales: ['en', 'fr', 'hi', 'ar'],
            defaultLocale: 'fr',
          },
          uploadPathPolicy: { mode: 'preserve' },
          limits: { maxFileBytes: 1000, maxBatch: 10 },
        }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    global.fetch = fetchStub;
    window.fetch = fetchStub;
    await import('../../../tools/asset-sourcing-portal/asset-sourcing-portal.js');
    assert.equal(readyPromises.length, 1);
    await Promise.all(readyPromises);
    assert.equal(
      document.documentElement.lang,
      'fr',
      document.getElementById('asp-login-message').textContent,
    );
  });

  it('preserves credentials while rendering Hindi and Arabic RTL', async () => {
    const username = document.getElementById('username');
    const password = document.getElementById('password');
    const selector = document.getElementById('asp-language');
    username.value = 'remember-user';
    password.value = 'remember-password';

    selector.value = 'hi';
    selector.dispatchEvent(new window.Event('change'));
    await waitFor(() => document.documentElement.lang === 'hi');
    assert.equal(document.getElementById('asp-username-label').textContent, 'उपयोगकर्ता नाम');
    assert.equal(username.value, 'remember-user');
    assert.equal(password.value, 'remember-password');

    selector.value = 'ar';
    selector.dispatchEvent(new window.Event('change'));
    await waitFor(() => document.documentElement.lang === 'ar');
    assert.equal(document.documentElement.dir, 'rtl');
    assert.equal(username.value, 'remember-user');
    assert.equal(password.dir, 'ltr');
  });

  it('keeps French metadata state across authenticated locale changes', async () => {
    const selector = document.getElementById('asp-language');
    selector.value = 'fr';
    selector.dispatchEvent(new window.Event('change'));
    await waitFor(() => document.documentElement.lang === 'fr');
    document.getElementById('asp-login-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await waitFor(() => !document.getElementById('asp-upload-view').hidden);

    const label = [...document.querySelectorAll('label')]
      .find((item) => item.textContent === 'Titre de campagne');
    assert.ok(label);
    const input = document.getElementById(label.htmlFor);
    input.value = 'Unchanged metadata';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    selector.value = 'ar';
    selector.dispatchEvent(new window.Event('change'));
    await waitFor(() => document.documentElement.lang === 'ar');
    assert.equal(document.getElementById(label.htmlFor).value, 'Unchanged metadata');
    assert.ok([...document.querySelectorAll('label')]
      .some((item) => item.textContent === 'عنوان الحملة'));
    assert.deepEqual(catalogRequests, ['fr', 'hi', 'ar']);
    document.querySelector('.account-menu-trigger').click();
    [...document.querySelectorAll('.account-menu-item')].at(-1).click();
  });
});
