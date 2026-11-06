import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength
} from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ReelsService } from './reels.service';

class CreateReelDto {
  @IsString()
  @Length(1, 64)
  mediaId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  thumbnailMediaId?: string;

  @IsOptional()
  @IsIn(['9:16', '16:9'])
  aspectRatio?: '9:16' | '16:9';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  hashtags!: string[];

  @IsOptional()
  @IsString()
  @Length(8, 64)
  clientRequestId?: string;
}

class UpdateReelDto {
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  mediaId?: string;

  @IsOptional()
  @IsString()
  thumbnailMediaId?: string;

  @IsOptional()
  @IsIn(['9:16', '16:9'])
  aspectRatio?: '9:16' | '16:9';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  hashtags?: string[];
}

class ReelCommentDto {
  @IsString()
  @Length(1, 1000)
  body!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

@Controller('reels')
@UseGuards(JwtAuthGuard)
export class ReelsController {
  constructor(private readonly reelsService: ReelsService) {}

  @Post()
  async create(@Req() req: { user: JwtPayload }, @Body() dto: CreateReelDto) {
    return ok('Reel created', await this.reelsService.create(req.user.sub, dto));
  }

  @Get('feed')
  async feed(
    @Req() req: { user: JwtPayload },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'Reels feed',
      await this.reelsService.feed(req.user.sub, cursor, limit ? Number(limit) : 20)
    );
  }

  @Get('user/:idOrUsername')
  async byUser(
    @Req() req: { user: JwtPayload },
    @Param('idOrUsername') idOrUsername: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'User reels',
      await this.reelsService.listByAuthor(
        req.user.sub,
        idOrUsername,
        cursor,
        limit ? Number(limit) : 20
      )
    );
  }

  @Get(':id')
  async getOne(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Reel', await this.reelsService.getById(req.user.sub, id));
  }

  @Patch(':id')
  async update(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: UpdateReelDto
  ) {
    return ok('Reel updated', await this.reelsService.update(req.user.sub, id, dto));
  }

  @Delete(':id')
  async remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Reel deleted', await this.reelsService.deleteReel(req.user.sub, id));
  }

  @Post(':id/like')
  async like(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Liked', await this.reelsService.like(req.user.sub, id));
  }

  @Delete(':id/like')
  async unlike(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Unliked', await this.reelsService.unlike(req.user.sub, id));
  }

  @Post(':id/view')
  async view(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('View recorded', await this.reelsService.recordView(req.user.sub, id));
  }

  @Get(':id/comments')
  async listComments(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'Reel comments',
      await this.reelsService.listComments(req.user.sub, id, cursor, limit ? Number(limit) : 40)
    );
  }

  @Post(':id/comments')
  async comment(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: ReelCommentDto
  ) {
    return ok('Comment created', await this.reelsService.comment(req.user.sub, id, dto.body, dto.parentId));
  }

  @Delete(':id/comments/:commentId')
  async deleteComment(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Param('commentId') commentId: string
  ) {
    return ok('Comment deleted', await this.reelsService.deleteComment(req.user.sub, id, commentId));
  }
}
