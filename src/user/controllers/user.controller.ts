import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.interface.js';
import { Public } from '../../auth/decorators/public.decorator.js';
import {
  CreateUserDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateUserDto,
} from '../dtos/user.dto.js';
import { UserService } from '../services/user.service.js';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Public()
  @Post()
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  @Put()
  modifyUser(@Body() dto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
    return this.userService.updateUser(req.user.sub, dto);
  }

  @Delete()
  deleteUser(@Req() req: AuthenticatedRequest) {
    return this.userService.deleteUser(req.user.sub);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.userService.forgotPassword(dto);
  }

  // The token is in the path: never log the URL (the filters log the route pattern only).
  @Public()
  @Post('reset-password/:oneTimeToken')
  resetPassword(
    @Param('oneTimeToken') oneTimeToken: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.userService.resetPassword(oneTimeToken, dto.password);
  }
}
