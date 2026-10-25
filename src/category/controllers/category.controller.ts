import { Body, Controller, Delete, Get, Post, Put, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.interface.js';
import { Public } from '../../auth/decorators/public.decorator.js';
import {
  CreateCategoryDto,
  CreateLocalCategoriesDto,
  DeleteCategoryDto,
  UpdateCategoryDto,
} from '../dtos/category.dto.js';
import { CategoryService } from '../services/category.service.js';

@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  getCategories(@Req() req: AuthenticatedRequest) {
    return this.categoryService.findByUser(req.user.sub);
  }

  @Post()
  createCategory(
    @Body() dto: CreateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categoryService.createCategory(req.user.sub, dto);
  }

  @Put()
  updateCategory(
    @Body() dto: UpdateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categoryService.updateCategory(req.user.sub, dto);
  }

  // The id is in the body (legacy contract).
  @Delete()
  deleteCategory(
    @Body() dto: DeleteCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categoryService.deleteCategory(req.user.sub, dto);
  }

  // Public (legacy contract, D4); the service decides who may be seeded.
  @Public()
  @Post('create-local-categories')
  createLocalCategories(@Body() dto: CreateLocalCategoriesDto) {
    return this.categoryService.createLocalCategories(dto.sub);
  }
}
