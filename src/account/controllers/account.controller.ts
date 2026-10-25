import { Body, Controller, Delete, Get, Post, Put, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.interface.js';
import {
  CreateAccountDto,
  DeleteAccountDto,
  UpdateAccountDto,
} from '../dtos/account.dto.js';
import { AccountService } from '../services/account.service.js';

@Controller('account-actions')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get()
  getAccounts(@Req() req: AuthenticatedRequest) {
    return this.accountService.findByUser(req.user.sub);
  }

  @Post()
  createAccount(
    @Body() dto: CreateAccountDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.accountService.createAccount(req.user.sub, dto);
  }

  // The id is in the body (legacy contract), for PUT and DELETE.
  @Put()
  updateAccount(
    @Body() dto: UpdateAccountDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.accountService.updateAccount(req.user.sub, dto);
  }

  @Delete()
  deleteAccount(
    @Body() dto: DeleteAccountDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.accountService.deleteAccount(req.user.sub, dto);
  }
}
