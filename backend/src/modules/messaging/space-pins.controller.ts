import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { SpacePinsService } from './space-pins.service';

class PinDto {
  @IsIn(['dm', 'group', 'channel'])
  spaceType!: 'dm' | 'group' | 'channel';

  @IsString()
  @Length(1, 191)
  spaceId!: string;
}

class ReorderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PinDto)
  ordered!: PinDto[];
}

@Controller('messaging/pins')
@UseGuards(JwtAuthGuard)
export class SpacePinsController {
  constructor(private readonly pins: SpacePinsService) {}

  @Get()
  async list(@Req() req: { user: JwtPayload }) {
    return ok('Pins loaded', await this.pins.list(req.user.sub));
  }

  @Post()
  async pin(@Req() req: { user: JwtPayload }, @Body() dto: PinDto) {
    return ok('Pinned', await this.pins.pin(req.user.sub, dto.spaceType, dto.spaceId));
  }

  @Delete(':spaceType/:spaceId')
  async unpin(
    @Req() req: { user: JwtPayload },
    @Param('spaceType') spaceType: 'dm' | 'group' | 'channel',
    @Param('spaceId') spaceId: string
  ) {
    return ok('Unpinned', await this.pins.unpin(req.user.sub, spaceType, spaceId));
  }

  @Put('reorder')
  async reorder(@Req() req: { user: JwtPayload }, @Body() dto: ReorderDto) {
    return ok('Reordered', await this.pins.reorder(req.user.sub, dto.ordered));
  }
}
