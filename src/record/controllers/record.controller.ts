import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.interface.js';
import { CreateTransferDto } from '../dtos/transfer.dto.js';
import { RecordService } from '../services/record.service.js';

@Controller('records')
export class RecordController {
  constructor(private readonly recordService: RecordService) {}

  @Get('expenses-and-incomes/:accountId/:month/:year')
  getExpensesAndIncomes(
    @Param('accountId') accountId: string,
    @Param('month') month: string,
    @Param('year') year: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.recordService.findByAccountAndMonth({
      sub: req.user.sub,
      accountId,
      month,
      year,
    });
  }

  @Post('transfer')
  createTransfer(
    @Body() dto: CreateTransferDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.recordService.createTransfer(req.user.sub, dto);
  }
}
