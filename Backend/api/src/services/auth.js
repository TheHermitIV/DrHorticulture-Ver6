import { createHash, timingSafeEqual } from 'node:crypto';

import { AppError } from '../errors.js';

// Hashing first gives both sides the same length, which timingSafeEqual needs, so a wrong guess
// takes as long as a right one whatever its length.
function sameSecret(given, expected) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// One shared account from LOGIN_USERNAME and LOGIN_PASSWORD.
// TODO(decision): replace with real user accounts (Supabase Auth, spec task 6.2) and issue a
// token the scan routes check; today a login only gates the app's UI.
export function createAuthService({ username, password }) {
  return {
    login(credentials, log) {
      const given = {
        username: typeof credentials?.username === 'string' ? credentials.username : '',
        password: typeof credentials?.password === 'string' ? credentials.password : '',
      };
      if (!given.username || !given.password) {
        throw new AppError('VALIDATION_ERROR', 'Enter a username and password.');
      }
      if (!username || !password) {
        log.warn('login attempted but LOGIN_USERNAME or LOGIN_PASSWORD is not set');
        throw new AppError('UNAUTHORIZED', 'Incorrect username or password.');
      }
      // Both checks always run, so the response time doesn't reveal which one failed.
      const usernameOk = sameSecret(given.username, username);
      const passwordOk = sameSecret(given.password, password);
      if (!usernameOk || !passwordOk) {
        throw new AppError('UNAUTHORIZED', 'Incorrect username or password.');
      }
      return { username };
    },
  };
}
