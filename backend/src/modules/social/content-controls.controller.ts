import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsString, Length } from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ContentControlsService } from './content-controls.service';

class CommentsDto {
  @IsBoolean()
  disabled!: boolean;
}

class ArchiveDto {
  @IsBoolean()
  archive!: boolean;
}

class SignalDto {
  @IsIn(['post', 'reel'])
  targetType!: 'post' | 'reel';

  @IsString()
  @Length(1, 191)
  targetId!: string;

  @IsIn(['more_like_this', 'not_interested'])
  signal!: 'more_like_this' | 'not_interested';
}

class ShareLinkDto {
  @IsIn(['post', 'reel', 'story'])
  targetType!: 'post' | 'reel' | 'story';

  @IsString()
  @Length(1, 191)
  targetId!: string;
}

class ShareDmDto extends ShareLinkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  receiverIds!: string[];
}

@Controller()
@UseGuards(JwtAuthGuard)
export class ContentControlsController {
  constructor(private readonly controls: ContentControlsService) {}

  @Patch('posts/:id/comments-disabled')
  async postComments(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: CommentsDto) {
    return ok('Updated', await this.controls.setPostComments(req.user.sub, id, dto.disabled));
  }

  @Patch('posts/:id/archive')
  async postArchive(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: ArchiveDto) {
    return ok('Updated', await this.controls.archivePost(req.user.sub, id, dto.archive));
  }

  @Patch('reels/:id/comments-disabled')
  async reelComments(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: CommentsDto) {
    return ok('Updated', await this.controls.setReelComments(req.user.sub, id, dto.disabled));
  }

  @Patch('reels/:id/archive')
  async reelArchive(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: ArchiveDto) {
    return ok('Updated', await this.controls.archiveReel(req.user.sub, id, dto.archive));
  }

  @Get('content/archive')
  async archive(@Req() req: { user: JwtPayload }) {
    return ok('Archive', await this.controls.listArchive(req.user.sub));
  }

  @Post('content/signals')
  async signal(@Req() req: { user: JwtPayload }, @Body() dto: SignalDto) {
    return ok('Signal recorded', await this.controls.recordSignal(req.user.sub, dto));
  }

  @Post('content/share-link')
  async shareLink(@Req() req: { user: JwtPayload }, @Body() dto: ShareLinkDto) {
    return ok('Share link', await this.controls.shareLink(req.user.sub, dto.targetType, dto.targetId));
  }

  @Post('content/share-dm')
  async shareDm(@Req() req: { user: JwtPayload }, @Body() dto: ShareDmDto) {
    return ok('Shared to DM', await this.controls.shareToDm(req.user.sub, dto));
  }

  @Post('content/download')
  async download(@Req() req: { user: JwtPayload }, @Body() dto: { targetType: 'post' | 'reel'; targetId: string }) {
    return ok(
      'Download URL',
      await this.controls.downloadUrl(req.user.sub, dto.targetType, dto.targetId)
    );
  }
}
