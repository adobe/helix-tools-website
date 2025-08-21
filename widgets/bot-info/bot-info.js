import { toClassName } from '../../scripts/aem.js';

export default function decorate(widget) {
  try {
    const params = new URLSearchParams(window.location.search);
    const org = toClassName(params.get('org'));
    const site = toClassName(params.get('site'));
    const user = params.get('user');
    const url = params.get('url');

    // set content source link
    const contentSource = document.querySelector('.bot-info-content-source');
    const authorUrl = new URL(url.replace('https://content.da.live', 'https://da.live#'));

    if (!user) {
      const userElement = document.querySelector('.bot-info-user');
      userElement.closest('li').setAttribute('aria-hidden', true);

      const adminNote = document.querySelector('.bot-info-admin-note');
      adminNote.setAttribute('aria-hidden', true);

      const adminNoteNoUser = document.querySelector('.bot-info-no-user');
      adminNoteNoUser.removeAttribute('aria-hidden');
    }

    if (authorUrl.protocol === 'https:') {
      const editUrl = authorUrl.toString();

      const editLink = document.createElement('a');
      editLink.href = editUrl;
      editLink.textContent = editUrl;
      contentSource.textContent = '';
      contentSource.appendChild(editLink);

      const orgElement = document.querySelector('.bot-info-org');
      orgElement.textContent = org;

      const userElement = document.querySelector('.bot-info-user');
      userElement.textContent = user;

      const siteElement = document.querySelector('.bot-info-site');
      siteElement.textContent = site;

      const previewLink = document.querySelector('.bot-info-preview');
      previewLink.href = `https://main--${site}--${org}.aem.page/`;
      previewLink.textContent = `https://main--${site}--${org}.aem.page/`;

      const liveLink = document.querySelector('.bot-info-live');
      liveLink.href = `https://main--${site}--${org}.aem.live/`;
      liveLink.textContent = `https://main--${site}--${org}.aem.live/`;

      widget.querySelectorAll('.bot-info-user-admin').forEach((link) => {
        link.href = `https://labs.aem.live/tools/user-admin/index.html?org=${org}&site=${site}`;
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    const alert = document.querySelector('.bot-info-alert');
    alert.ariaHidden = false;
    const success = document.querySelector('.bot-info-success');
    success.ariaHidden = true;
  }
}
