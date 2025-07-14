const SIDEKICK_ID = 'igkmdomcgoebiipaifhmpfjhbjccggml';

export const NO_SIDEKICK = 'no-sidekick';

/**
 * Sends a message to the Sidekick extension.
 * @param {Object} message The message
 * @param {Function} [callback] The callback function
 */
export async function messageSidekick(message, callback) {
  return new Promise((resolve) => {
    const { chrome } = window;
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      let messageResolved = false;
      chrome.runtime.sendMessage(
        localStorage.getItem('aem-sidekick-id')?.trim() || SIDEKICK_ID,
        message,
        (response) => {
          if (response) {
            if (callback) {
              callback(response);
            }
            messageResolved = true;
            resolve(response);
          }
        },
      );

      setTimeout(() => {
        if (!messageResolved) {
          // eslint-disable-next-line no-console
          console.warn('Sidekick message not received in time');
          resolve(NO_SIDEKICK);
        }
      }, 5000);
    }
  });
}
