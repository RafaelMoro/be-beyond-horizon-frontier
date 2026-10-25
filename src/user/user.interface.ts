// Legacy `hostname` dropped: S3 builds the reset link from FRONTEND_URI.
export interface ForgotPasswordMail {
  email: string;
  firstName: string;
  lastName: string;
  oneTimeToken: string;
}

export interface ForgotPasswordMailer {
  sendForgotPasswordEmail(mail: ForgotPasswordMail): Promise<void>;
}
