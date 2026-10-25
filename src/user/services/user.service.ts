import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcryptjs';
import { isValidObjectId, Model } from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import {
  UserCreatedDto,
  UserDeletedDto,
  UserUpdatedDto,
} from '../dtos/user-responses.dto.js';
import {
  CreateUserDto,
  ForgotPasswordDto,
  UpdateUserDto,
} from '../dtos/user.dto.js';
import { User, UserDoc } from '../entities/user.entity.js';
import {
  BCRYPT_COST,
  DELETE_USER_MESSAGE,
  EMAIL_CHANGE_ERROR,
  FORGOT_PASSWORD_MAILER,
  FORGOT_PASSWORD_MESSAGE,
  JWT_NOT_FOUND,
  PASSWORD_DIRECT_CHANGE_ERROR,
  PROFILE_UPDATE,
  USER_CREATED_MESSAGE,
  USER_EXISTS_ERROR,
  USER_NOT_FOUND_ERROR,
  RESET_PASSWORD_MESSAGE,
  WRONG_JWT_ERROR,
} from '../user.constants.js';
import type { ForgotPasswordMailer } from '../user.interface.js';
import { hashToken } from '../user.utils.js';

const NAME_FIELDS = ['firstName', 'lastName', 'middleName'] as const;
const JWT_ERROR_NAMES = new Set([
  'JsonWebTokenError',
  'TokenExpiredError',
  'NotBeforeError',
]);

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    // UserModule's own JwtModule: the one-time reset key, not the access key.
    private readonly jwtService: JwtService,
    @Inject(FORGOT_PASSWORD_MAILER)
    private readonly mailer: ForgotPasswordMailer,
  ) {}

  // Exact case: emails are not lower-cased (legacy).
  findByEmail(email: string): Promise<UserDoc | null> {
    return this.userModel.findOne({ email }).exec();
  }

  // A non-ObjectId id is "not found", not a CastError 400.
  async findById(id: string): Promise<UserDoc | null> {
    if (!isValidObjectId(id)) return null;
    return this.userModel.findById(id).exec();
  }

  async createUser(dto: CreateUserDto): Promise<GeneralResponse> {
    if (await this.findByEmail(dto.email)) {
      throw new BadRequestException(USER_EXISTS_ERROR);
    }
    const password = await bcrypt.hash(dto.password, BCRYPT_COST);
    let user: UserDoc;
    try {
      user = await this.userModel.create({ ...dto, password });
    } catch (e) {
      // A concurrent signup won the race past the pre-check; without this the catch-all answers 409.
      if ((e as { code?: unknown }).code === 11000) {
        throw new BadRequestException(USER_EXISTS_ERROR);
      }
      throw e;
    }
    const userCreated: UserCreatedDto = {
      email: user.email,
      sub: user._id.toString(),
    };
    return {
      ...INITIAL_RESPONSE,
      message: USER_CREATED_MESSAGE,
      data: { userCreated },
    };
  }

  // Legacy check order: not found, email change, password change.
  async updateUser(sub: string, dto: UpdateUserDto): Promise<GeneralResponse> {
    const user = await this.findById(sub);
    if (!user) throw new BadRequestException(USER_NOT_FOUND_ERROR);
    if (dto.email !== user.email) {
      throw new BadRequestException(EMAIL_CHANGE_ERROR);
    }
    if (dto.password !== undefined) {
      throw new BadRequestException(PASSWORD_DIRECT_CHANGE_ERROR);
    }
    // IsOptional lets null through: only strings are written.
    const $set: Partial<Pick<User, (typeof NAME_FIELDS)[number]>> = {};
    for (const field of NAME_FIELDS) {
      const value = dto[field];
      if (typeof value === 'string') $set[field] = value;
    }
    const updated = await this.userModel
      .findByIdAndUpdate(sub, { $set }, { returnDocument: 'after' })
      .exec();
    if (!updated) throw new BadRequestException(USER_NOT_FOUND_ERROR);
    const userUpdated: UserUpdatedDto = {
      email: updated.email,
      firstName: updated.firstName,
      middleName: updated.middleName,
      lastName: updated.lastName,
    };
    return {
      ...INITIAL_RESPONSE,
      message: PROFILE_UPDATE,
      data: { userUpdated },
    };
  }

  // No cascade to the user's other collections yet (D7, lands in S8).
  async deleteUser(sub: string): Promise<GeneralResponse> {
    // `sub` comes from the guard, which already proved it is a valid, existing id.
    const deleted = await this.userModel.findByIdAndDelete(sub).exec();
    if (!deleted) throw new BadRequestException(USER_NOT_FOUND_ERROR);
    const userDeleted: UserDeletedDto = {
      email: deleted.email,
      firstName: deleted.firstName,
      lastName: deleted.lastName,
    };
    return {
      ...INITIAL_RESPONSE,
      message: DELETE_USER_MESSAGE,
      data: { userDeleted },
    };
  }

  // Always 201: an unknown email must not be distinguishable (no write, no send).
  async forgotPassword({ email }: ForgotPasswordDto): Promise<GeneralResponse> {
    const user = await this.findByEmail(email);
    if (user) {
      const oneTimeToken = await this.jwtService.signAsync({
        sub: user._id.toString(),
      });
      // Overwrites any pending token, cancelling the older link.
      await this.userModel
        .updateOne(
          { _id: user._id },
          { $set: { oneTimeToken: hashToken(oneTimeToken) } },
        )
        .exec();
      await this.mailer.sendForgotPasswordEmail({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        oneTimeToken,
      });
    }
    return {
      ...INITIAL_RESPONSE,
      message: FORGOT_PASSWORD_MESSAGE,
      data: null,
    };
  }

  async resetPassword(
    oneTimeToken: string,
    password: string,
  ): Promise<GeneralResponse> {
    let sub: string;
    try {
      ({ sub } = await this.jwtService.verifyAsync<{ sub: string }>(
        oneTimeToken,
      ));
    } catch (e) {
      // Legacy contract: jsonwebtoken's own message ('jwt expired', 'invalid signature'…). The only place a library
      // message is passed through, by design; those messages carry no user data.
      if (e instanceof Error && JWT_ERROR_NAMES.has(e.name)) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
    const user = await this.findById(sub);
    if (!user) throw new BadRequestException(USER_NOT_FOUND_ERROR);
    const stored = user.oneTimeToken;
    if (!stored) throw new BadRequestException(JWT_NOT_FOUND);
    if (hashToken(oneTimeToken) !== stored) {
      throw new BadRequestException(WRONG_JWT_ERROR);
    }
    // One conditional write: a concurrent reset that already consumed the token makes this match nothing.
    const { matchedCount } = await this.userModel
      .updateOne(
        { _id: user._id, oneTimeToken: stored },
        {
          $set: {
            password: await bcrypt.hash(password, BCRYPT_COST),
            passwordChangedAt: new Date(),
          },
          $unset: { oneTimeToken: '' },
        },
      )
      .exec();
    if (matchedCount === 0) throw new BadRequestException(WRONG_JWT_ERROR);
    return { ...INITIAL_RESPONSE, message: RESET_PASSWORD_MESSAGE, data: null };
  }
}
