const SIDEKICK_ID = 'igkmdomcgoebiipaifhmpfjhbjccggml';

export const NO_SIDEKICK = 'no-sidekick';

export function getSidekickId() {
  return localStorage.getItem('aem-sidekick-id')?.trim() || SIDEKICK_ID;
}

export async function messageSidekick(message, callback, timeout = 500) {
  return new Promise((resolve) => {
    const { chrome } = window;
    if (chrome?.runtime?.sendMessage) {
      let resolved = false;
      chrome.runtime.sendMessage(
        getSidekickId(),
        message,
        (response) => {
          if (response) {
            if (callback) callback(response);
            resolved = true;
            resolve(response);
          }
        },
      );
      setTimeout(() => {
        if (!resolved) resolve(NO_SIDEKICK);
      }, timeout);
    } else {
      resolve(NO_SIDEKICK);
    }
  });
}
