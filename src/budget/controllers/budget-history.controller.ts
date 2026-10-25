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
  AddRecordToBudgetHistoryDto,
  CreateBudgetHistoryDto,
  DeleteBudgetHistoryDto,
  RemoveRecordFromBudgetHistoryDto,
  UpdateBudgetHistoryDto,
} from '../dtos/budget-history.dto.js';
import { BudgetHistoryService } from '../services/budget-history.service.js';

@Controller('budget-history')
export class BudgetHistoryController {
  constructor(private readonly historyService: BudgetHistoryService) {}

  @Post()
  createHistory(
    @Body() dto: CreateBudgetHistoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.createHistory(req.user.sub, dto);
  }

  @Post('add-record')
  addRecord(
    @Body() dto: AddRecordToBudgetHistoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.addRecord(req.user.sub, dto);
  }

  @Post('delete-record')
  removeRecord(
    @Body() dto: RemoveRecordFromBudgetHistoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.removeRecord(req.user.sub, dto);
  }

  @Get()
  getHistories(@Req() req: AuthenticatedRequest) {
    return this.historyService.findByUser(req.user.sub);
  }

  @Get(':budgetHistoryId')
  getHistory(
    @Param('budgetHistoryId') budgetHistoryId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.findOne(req.user.sub, budgetHistoryId);
  }

  // The id is in the body (legacy contract), for PUT and DELETE.
  @Put()
  updateHistory(
    @Body() dto: UpdateBudgetHistoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.updateHistory(req.user.sub, dto);
  }

  @Delete()
  deleteHistory(
    @Body() dto: DeleteBudgetHistoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.deleteHistory(req.user.sub, dto);
  }
}
