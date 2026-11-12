import { afterEach } from 'vitest';
import { assertNoPreconditionViolations } from '../helpers/setupSignedInFirebase.js';

// Global I3 guard: fails the test that sent a PATCH without a precondition.
afterEach(() => {
  assertNoPreconditionViolations();
});
