async function loadCSS(href) {
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`head > link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.append(link);
    } else {
      resolve();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadCSS('https://tools.aem.live/errors/errors.css');

  const description = document.querySelector('p');
  const { hostname } = window.location;
  const rso = hostname.split('.')[0];
  const suffix = hostname.split('.')[2] === 'page' ? '.page' : '.live';

  description.innerHTML = `Your request has been blocked, please use <a href="https://${rso}.aem.${suffix}" target="_blank">${rso}.aem.live</a> instead.<br><br>
    See <a href="https://www.aem.live/developer/upgrade" target="_blank">https://www.aem.live/developer/upgrade</a> for more information.`;
});

const style = document.createElement('style');
style.textContent = 'body { display: none; }';
document.head.append(style);
