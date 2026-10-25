import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

// Develop's CreateBudgetsDto: same fields, order and decorators, all required. No IsIn on typeBudget (E6.Q5).
export class CreateBudgetDto {
  @IsString()
  @IsNotEmpty()
  readonly name: string;

  @IsString()
  readonly description: string;

  // 'periodic' | 'one-time' (TS-only in develop).
  @IsString()
  @IsNotEmpty()
  readonly typeBudget: string;

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  readonly startDate: Date;

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  readonly endDate: Date;

  @IsNumber()
  @IsNotEmpty()
  readonly currentAmount: number;

  @IsNumber()
  @IsNotEmpty()
  readonly limit: number;

  // daily, weekly, monthly, yearly, bi-weekly, bi-monthly, XMonths, XWeeks, XDays
  @IsString()
  readonly period: string;

  @IsBoolean()
  readonly isActive: boolean;

  @IsDate()
  @Type(() => Date)
  readonly nextResetDate: Date;

  // Format "DD:MM:YYYY | DD:MM:YYYY"; elements unchecked (develop).
  @IsArray()
  readonly previousPeriods: string[];
}

// Develop's UpdateBudgetDto (PartialType of create), written by hand.
export class UpdateBudgetDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly name?: string;

  @IsOptional()
  @IsString()
  readonly description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly typeBudget?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  readonly startDate?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  readonly endDate?: Date;

  @IsOptional()
  @IsNumber()
  @IsNotEmpty()
  readonly currentAmount?: number;

  @IsOptional()
  @IsNumber()
  @IsNotEmpty()
  readonly limit?: number;

  @IsOptional()
  @IsString()
  readonly period?: string;

  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  readonly nextResetDate?: Date;

  @IsOptional()
  @IsArray()
  readonly previousPeriods?: string[];

  @IsMongoId()
  @IsNotEmpty()
  readonly budgetId: string;
}

export class DeleteBudgetDto {
  @IsMongoId()
  @IsNotEmpty()
  readonly budgetId: string;
}
