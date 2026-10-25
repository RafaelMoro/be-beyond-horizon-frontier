import { Logger } from '@nestjs/common';
import { FORGOT_PASSWORD_MAILER } from './user.constants.js';
import type { ForgotPasswordMailer } from './user.interface.js';
import { UserModule } from './user.module.js';

describe('no-op forgot-password mailer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a fixed warning, never the email or token', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    // Only the provider, not the whole module (no DB/config needed).
    const provider = (
      Reflect.getMetadata('providers', UserModule) as unknown[]
    ).find(
      (p) => (p as { provide?: unknown }).provide === FORGOT_PASSWORD_MAILER,
    ) as { useValue: ForgotPasswordMailer };
    await provider.useValue.sendForgotPasswordEmail({
      email: 'secret@example.invalid',
      firstName: 'A',
      lastName: 'B',
      oneTimeToken: 'raw.one.time',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('forgot-password mail not configured');
  });
});
