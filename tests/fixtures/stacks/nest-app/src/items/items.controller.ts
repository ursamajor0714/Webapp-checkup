import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateItemDto } from './dto/create-item.dto';
@Controller('items')
export class ItemsController {
  @Get()
  findAll() { return []; }
  @Get(':id')
  findOne(@Param('id') id: string) { return { id }; }
  @Post()
  create(@Body() dto: CreateItemDto) { return dto; }
  @Delete(':id')
  remove(@Param('id') id: string) { return { id }; }
}
