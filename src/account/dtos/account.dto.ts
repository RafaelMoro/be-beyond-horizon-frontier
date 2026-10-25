import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

// Develop's CreateAccountDto: same decorators, same order. D17: the card fields are optional, alias stays required.
export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  readonly title: string;

  @IsString()
  @IsNotEmpty()
  readonly alias: string;

  @IsString()
  @IsNotEmpty()
  readonly accountType: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly accountProvider?: string;

  @IsNumber()
  @IsNotEmpty()
  readonly amount: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly terminationFourDigits?: string;

  @IsString()
  @IsNotEmpty()
  readonly backgroundColor: string;

  @IsString()
  @IsNotEmpty()
  readonly color: string;
}

// Develop's UpdateAccountDto (PartialType of create), written by hand: all 8 fields, so a GET echo passes the whitelist.
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly alias?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly accountType?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly accountProvider?: string;

  @IsOptional()
  @IsNumber()
  @IsNotEmpty()
  readonly amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly terminationFourDigits?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly backgroundColor?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly color?: string;

  @IsMongoId()
  @IsNotEmpty()
  readonly accountId: string;
}

export class DeleteAccountDto {
  @IsMongoId()
  @IsNotEmpty()
  readonly accountId: string;
}
