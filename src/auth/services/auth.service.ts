import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import { UserService } from '../../user/services/user.service.js';
import { DUMMY_PASSWORD_HASH, LOGIN_ERROR } from '../auth.constants.js';
import type { LoginBody } from '../auth.interface.js';

const isFilled = (v: unknown): v is string => typeof v === 'string' && v !== '';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    body: LoginBody,
  ): Promise<{ accessToken: string; response: GeneralResponse }> {
    const { email, password } = body ?? {};
    // Legacy passport "missing credentials"; also keeps `{ $gt: '' }` away from findOne.
    if (!isFilled(email) || !isFilled(password)) {
      throw new UnauthorizedException();
    }

    const user = await this.userService.findByEmail(email);
    const ok = await bcrypt.compare(
      password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !ok) throw new UnauthorizedException(LOGIN_ERROR);

    const accessToken = await this.jwtService.signAsync({
      sub: user._id.toString(),
    });
    const { _id, firstName, lastName, middleName } = user;
    return {
      accessToken,
      response: {
        ...INITIAL_RESPONSE,
        data: {
          user: { _id, email: user.email, firstName, lastName, middleName },
        },
      },
    };
  }
}
