import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
export class CreateItemDto {
  @IsString()
  @MaxLength(20)
  name: string;

  @IsInt()
  @Min(0)
  @Max(100)
  qty: number;

  @IsOptional()
  @IsEmail()
  email?: string;
}
