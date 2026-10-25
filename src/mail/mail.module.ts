import { Module } from '@nestjs/common';
import { FORGOT_PASSWORD_MAILER } from '../user/user.constants.js';
import { MailService } from './services/mail.service.js';

@Module({
  // useExisting: the token and MailService are one instance, so e2e spies on the token hit what UserService holds.
  providers: [
    MailService,
    { provide: FORGOT_PASSWORD_MAILER, useExisting: MailService },
  ],
  exports: [FORGOT_PASSWORD_MAILER],
})
export class MailModule {}
