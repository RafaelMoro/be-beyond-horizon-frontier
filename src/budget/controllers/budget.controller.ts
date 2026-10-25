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
  CreateBudgetDto,
  DeleteBudgetDto,
  UpdateBudgetDto,
} from '../dtos/budget.dto.js';
import { BudgetService } from '../services/budget.service.js';

@Controller('budgets')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Post()
  createBudget(@Body() dto: CreateBudgetDto, @Req() req: AuthenticatedRequest) {
    return this.budgetService.createBudget(req.user.sub, dto);
  }

  @Get()
  getBudgets(@Req() req: AuthenticatedRequest) {
    return this.budgetService.findByUser(req.user.sub);
  }

  @Get(':budgetId')
  getBudget(
    @Param('budgetId') budgetId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.budgetService.findOne(req.user.sub, budgetId);
  }

  // The id is in the body (legacy contract), for PUT and DELETE.
  @Put()
  updateBudget(@Body() dto: UpdateBudgetDto, @Req() req: AuthenticatedRequest) {
    return this.budgetService.updateBudget(req.user.sub, dto);
  }

  @Delete()
  deleteBudget(@Body() dto: DeleteBudgetDto, @Req() req: AuthenticatedRequest) {
    return this.budgetService.deleteBudget(req.user.sub, dto);
  }
}
