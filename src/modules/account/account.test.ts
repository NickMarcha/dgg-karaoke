import { afterEach, describe, expect, it } from 'vitest';

import { takeSignInReturnTo } from './account';

describe('takeSignInReturnTo', () => {
  afterEach(() => sessionStorage.clear());

  it('goes back to the page the sign-in started on, once', () => {
    sessionStorage.setItem('sign-in-return-to', '/remote-mic/?room=abcde');

    expect(takeSignInReturnTo()).toBe('/remote-mic/?room=abcde');
    expect(takeSignInReturnTo()).toBe('/menu/');
  });

  it('goes to the menu without one', () => {
    expect(takeSignInReturnTo()).toBe('/menu/');
  });

  // Session storage is this site's alone, but a path is all it should ever hold
  it('never leaves the site', () => {
    sessionStorage.setItem('sign-in-return-to', '//evil.test/');
    expect(takeSignInReturnTo()).toBe('/menu/');

    sessionStorage.setItem('sign-in-return-to', '/\\evil.test/');
    expect(takeSignInReturnTo()).toBe('/menu/');

    sessionStorage.setItem('sign-in-return-to', 'https://evil.test/');
    expect(takeSignInReturnTo()).toBe('/menu/');
  });
});
