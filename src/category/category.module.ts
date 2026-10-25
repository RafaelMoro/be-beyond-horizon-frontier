import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CategoryController } from './controllers/category.controller.js';
import { Category, CategorySchema } from './entities/category.entity.js';
import { CategoryService } from './services/category.service.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
    ]),
    // create-local checks the user exists. S8's cascade must not make UserModule import CategoryModule (cycle).
    UserModule,
  ],
  providers: [CategoryService],
  exports: [CategoryService],
  controllers: [CategoryController],
})
export class CategoryModule {}
