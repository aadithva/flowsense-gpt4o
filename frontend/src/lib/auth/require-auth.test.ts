import { describe, it, expect } from 'vitest';
import { getAuthenticatedUser, UnauthorizedError } from './require-auth';

describe('require-auth', () => {
  describe('getAuthenticatedUser', () => {
    it('should return anonymous user (auth disabled)', async () => {
      const result = await getAuthenticatedUser();
      expect(result.oid).toBe('00000000-0000-0000-0000-000000000000');
      expect(result.email).toBe('anonymous@localhost');
      expect(result.name).toBe('Anonymous User');
    });
  });

  describe('UnauthorizedError', () => {
    it('should have correct name and message', () => {
      const error = new UnauthorizedError('Custom message');
      expect(error.name).toBe('UnauthorizedError');
      expect(error.message).toBe('Custom message');
    });

    it('should use default message when none provided', () => {
      const error = new UnauthorizedError();
      expect(error.message).toBe('Unauthorized');
    });
  });
});
