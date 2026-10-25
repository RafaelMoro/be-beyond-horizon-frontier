import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Resend } from 'resend';
import config from '../../config.js';
import type {
  ForgotPasswordMail,
  ForgotPasswordMailer,
} from '../../user/user.interface.js';
import {
  FORGOT_PASSWORD_SUBJECT,
  MAIL_SEND_TIMEOUT_MS,
} from '../mail.constants.js';
import { renderResetPassword } from '../templates/reset-password.js';

// Log lines never carry the recipient, names, URL, token or Resend's `message` (it can contain addresses).
@Injectable()
export class MailService implements ForgotPasswordMailer {
  private readonly logger = new Logger('ForgotPasswordMailer');
  // null when a key is blank: `new Resend()` falls back to process.env and throws without a key.
  private readonly resend: Resend | null;

  constructor(
    @Inject(config.KEY) private readonly c: ConfigType<typeof config>,
  ) {
    const { resendApiKey, email } = c.mailer;
    this.resend = resendApiKey && email ? new Resend(resendApiKey) : null;
  }

  // Never rejects: UserService.forgotPassword has no try/catch, and a 500 only for known emails would enumerate them.
  async sendForgotPasswordEmail({
    email,
    firstName,
    lastName,
    oneTimeToken,
  }: ForgotPasswordMail): Promise<void> {
    if (!this.resend) {
      this.logger.warn('forgot-password mail not configured');
      return;
    }
    const url = `${this.c.frontendUri}/reset-password/${oneTimeToken}`;
    try {
      const html = await renderResetPassword({ url, firstName, lastName });
      // An aborted (timed-out) fetch comes back as `{ error }`, not a throw.
      const { data, error } = await this.resend.emails.send(
        {
          from: this.c.mailer.email as string,
          to: email,
          subject: FORGOT_PASSWORD_SUBJECT,
          html,
        },
        { signal: AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS) },
      );
      if (error) {
        this.logger.error(
          `forgot-password mail failed (${error.name}, ${error.statusCode})`,
        );
        return;
      }
      this.logger.log(`forgot-password mail sent (${data?.id})`);
    } catch (e) {
      this.logger.error(
        `forgot-password mail failed (${e instanceof Error ? e.name : 'unknown'})`,
      );
    }
  }
}
