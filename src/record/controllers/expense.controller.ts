import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.interface.js';
import {
  CreateExpenseDto,
  DeleteExpenseDto,
  UpdateExpenseDto,
} from '../dtos/expense.dto.js';
import { ExpenseService } from '../services/expense.service.js';

@Controller('expenses-actions')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Get(':accountId/:month/:year')
  getExpenses(
    @Param('accountId') accountId: string,
    @Param('month') month: string,
    @Param('year') year: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.expenseService.findByAccountAndMonth({
      sub: req.user.sub,
      accountId,
      month,
      year,
    });
  }

  @Post()
  createExpense(
    @Body() dto: CreateExpenseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.expenseService.createExpense(req.user.sub, dto);
  }

  // The id is in the body (legacy contract), for PUT and DELETE.
  @Put()
  updateExpense(
    @Body() dto: UpdateExpenseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.expenseService.updateExpense(req.user.sub, dto);
  }

  @Delete()
  deleteExpense(
    @Body() dto: DeleteExpenseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.expenseService.deleteExpense(req.user.sub, dto);
  }
}
