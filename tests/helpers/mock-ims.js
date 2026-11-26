/* eslint-env node */
import { mock } from 'node:test';

/**
 * Mocks utils/ims.js: signIn() succeeds at once and stores a token, unless `completeSignIn`
 * is false. Call before importing the code under test.
 * @param {{ token?: string }} [initial] state that reset() restores
 * @returns {{ token?: string, completeSignIn: boolean, signIns: number, reset: () => void }}
 */
export default function mockIms(initial = {}) {
  const ims = {
    reset() {
      Object.assign(ims, {
        token: undefined, completeSignIn: true, signIns: 0, ...initial,
      });
    },
  };
  ims.reset();
  const signIn = async () => {
    ims.signIns += 1;
    if (ims.completeSignIn) ims.token = 'ims-token';
    return ims.completeSignIn;
  };
  mock.module('../../utils/ims.js', {
    exports: {
      addImsToken: () => {},
      ensureSignedIn: async () => !!ims.token || signIn(),
      getImsToken: () => ims.token,
      requireSignIn: async () => {},
      signIn,
      waitForIms: async () => true,
    },
  });
  return ims;
}
