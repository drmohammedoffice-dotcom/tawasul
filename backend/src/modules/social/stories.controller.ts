import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { StoriesService } from './stories.service';

class CreateStoryDto {
  @IsString()
  @Length(1, 64)
  mediaId!: string;

  @IsOptional()
  @IsIn(['everyone', 'close_friends', 'family'])
  audience?: 'everyone' | 'close_friends' | 'family';

  @IsOptional()
  @IsBoolean()
  commentsDisabled?: boolean;
}

class ReactStoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  emoji!: string;
}

class ReplyStoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post()
  async create(@Req() req: { user: JwtPayload }, @Body() dto: CreateStoryDto) {
    return ok(
      'Story created',
      await this.storiesService.create(req.user.sub, dto.mediaId, dto.audience || 'everyone', {
        commentsDisabled: dto.commentsDisabled === true
      })
    );
  }

  @Get('feed')
  async feed(@Req() req: { user: JwtPayload }) {
    return ok('Stories feed', await this.storiesService.feed(req.user.sub));
  }

  @Post(':id/view')
  async view(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Story viewed', await this.storiesService.view(req.user.sub, id));
  }

  @Get(':id/insights')
  async insights(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Story insights', await this.storiesService.insights(req.user.sub, id));
  }

  @Post(':id/react')
  async react(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: ReactStoryDto) {
    return ok('Story reaction saved', await this.storiesService.react(req.user.sub, id, dto.emoji));
  }

  @Get(':id/replies')
  async replies(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Story replies', await this.storiesService.listReplies(req.user.sub, id));
  }

  @Post(':id/replies')
  async reply(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: ReplyStoryDto) {
    return ok('Story reply created', await this.storiesService.reply(req.user.sub, id, dto.body));
  }

  @Delete(':id')
  async remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Story deleted', await this.storiesService.remove(req.user.sub, id));
  }
}
