import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { FocusProfileService } from './focus-profile.service';

class UpdateFocusProfileDto {
  @IsOptional()
  @IsString()
  @Length(0, 80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  bio?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2048)
  avatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  hideBrowseProfile?: boolean;
}

@Controller('focus/profile')
@UseGuards(JwtAuthGuard)
export class FocusProfileController {
  constructor(private readonly profiles: FocusProfileService) {}

  @Get()
  async get(@Req() req: { user: JwtPayload }) {
    const profile = await this.profiles.getOrCreate(req.user.sub);
    return ok('Focus profile', profile);
  }

  @Patch()
  async update(@Req() req: { user: JwtPayload }, @Body() dto: UpdateFocusProfileDto) {
    const profile = await this.profiles.update(req.user.sub, dto);
    return ok('Focus profile updated', profile);
  }
}
