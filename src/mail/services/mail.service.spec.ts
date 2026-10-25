import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import config from '../../config.js';
import { FORGOT_PASSWORD_SUBJECT } from '../mail.constants.js';
import { MailService } from './mail.service.js';

const { send, ResendMock } = vi.hoisted(() => {
  const send = vi.fn();
  const ResendMock = vi.fn(function (this: { emails: unknown }) {
    this.emails = { send };
  });
  return { send, ResendMock };
});
vi.mock('resend', () => ({ Resend: ResendMock }));

const mail = {
  email: 'secret@example.invalid',
  firstName: 'Secretfirst',
  lastName: 'Secretlast',
  oneTimeToken: 'raw.one.time',
};
const url = 'http://localhost:4100/reset-password/raw.one.time';
const configured = {
  email: 'no-reply@example.com',
  resendApiKey: 're_test_fake',
};

describe('MailService', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  const build = async (mailer: { email?: string; resendApiKey?: string }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: config.KEY,
          useValue: { frontendUri: 'http://localhost:4100', mailer },
        },
      ],
    }).compile();
    log.mockClear(); // drop Nest's own "dependencies initialized" line
    return module.get(MailService);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Nothing identifying in any log line, whatever the outcome.
    const logged = JSON.stringify(
      [log, warn, error].flatMap((s) => s.mock.calls),
    );
    for (const secret of [
      'secret@example.invalid',
      'Secretfirst',
      'Secretlast',
      'raw.one.time',
      'reset-password',
    ]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it.each([
    {},
    { email: 'no-reply@example.com' },
    { resendApiKey: 're_test_fake' },
    { email: '', resendApiKey: '' },
  ])('not configured (%o) → fixed warning, no client', async (mailer) => {
    const service = await build(mailer);
    await expect(
      service.sendForgotPasswordEmail(mail),
    ).resolves.toBeUndefined();
    expect(ResendMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('forgot-password mail not configured');
  });

  it('sends the reset mail with a timeout signal', async () => {
    send.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
    const service = await build(configured);
    await expect(
      service.sendForgotPasswordEmail(mail),
    ).resolves.toBeUndefined();
    expect(ResendMock).toHaveBeenCalledWith('re_test_fake');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      {
        from: 'no-reply@example.com',
        to: 'secret@example.invalid',
        subject: FORGOT_PASSWORD_SUBJECT,
        html: expect.any(String),
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(send.mock.calls[0][0].html).toContain(`href="${url}"`);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('forgot-password mail sent (msg-1)');
    expect(error).not.toHaveBeenCalled();
  });

  it('Resend { error } → logs name and status only, resolves', async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        statusCode: 403,
        message: 'not allowed for secret@example.invalid',
      },
    });
    const service = await build(configured);
    await expect(
      service.sendForgotPasswordEmail(mail),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'forgot-password mail failed (validation_error, 403)',
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('send throws → logs the error name only, resolves', async () => {
    send.mockRejectedValue(new TypeError('boom secret@example.invalid'));
    const service = await build(configured);
    await expect(
      service.sendForgotPasswordEmail(mail),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'forgot-password mail failed (TypeError)',
    );
  });
});
