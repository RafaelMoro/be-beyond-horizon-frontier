import { Body, Controller, Delete, Post, Put, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.interface.js';
import {
  CreateIncomeDto,
  DeleteIncomeDto,
  UpdateIncomeDto,
} from '../dtos/income.dto.js';
import { IncomeService } from '../services/income.service.js';

@Controller('incomes-actions')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  @Post()
  createIncome(@Body() dto: CreateIncomeDto, @Req() req: AuthenticatedRequest) {
    return this.incomeService.createIncome(req.user.sub, dto);
  }

  // The id is in the body (legacy contract), for PUT and DELETE.
  @Put()
  updateIncome(@Body() dto: UpdateIncomeDto, @Req() req: AuthenticatedRequest) {
    return this.incomeService.updateIncome(req.user.sub, dto);
  }

  @Delete()
  deleteIncome(@Body() dto: DeleteIncomeDto, @Req() req: AuthenticatedRequest) {
    return this.incomeService.deleteIncome(req.user.sub, dto);
  }
}
