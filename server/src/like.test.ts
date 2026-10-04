import { describe, expect, it } from 'vitest';

import { containing } from './like.js';

describe('containing', () => {
  it('matches the characters typed, wildcards and escapes included', () => {
    expect(containing('a_b')).toBe('%a\\_b%');
    expect(containing('50%')).toBe('%50\\%%');
    expect(containing('back\\slash')).toBe('%back\\\\slash%');
  });
});
