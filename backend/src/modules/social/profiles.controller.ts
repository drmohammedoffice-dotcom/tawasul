import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ProfilesService } from './profiles.service';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9._]+$/)
  username?: string;
}

class ReportDto {
  @IsString()
  @Length(1, 40)
  targetType!: string;

  @IsString()
  @Length(1, 64)
  targetId!: string;

  @IsString()
  @Length(3, 200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

@Controller()
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @UseGuards(JwtAuthGuard)
  @Get('users/me/profile')
  async me(@Req() req: { user: JwtPayload }) {
    return ok('Profile', await this.profilesService.getProfile(req.user.sub, req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('users/me/profile')
  async updateMe(@Req() req: { user: JwtPayload }, @Body() dto: UpdateProfileDto) {
    return ok('Profile updated', await this.profilesService.updateMe(req.user.sub, dto));
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/username-available')
  async usernameAvailable(@Req() req: { user: JwtPayload }, @Query('u') u?: string) {
    return ok('Username check', await this.profilesService.checkUsernameAvailable(req.user.sub, u || ''));
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/me/follow-requests')
  async pendingRequests(@Req() req: { user: JwtPayload }) {
    return ok(
      'Follow requests',
      await this.profilesService.listPendingFollowRequests(req.user.sub)
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/:idOrUsername/profile')
  async getProfile(@Req() req: { user: JwtPayload }, @Param('idOrUsername') idOrUsername: string) {
    return ok('Profile', await this.profilesService.getProfile(req.user.sub, idOrUsername));
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/:idOrUsername/followers')
  async followers(@Req() req: { user: JwtPayload }, @Param('idOrUsername') idOrUsername: string) {
    return ok('Followers', await this.profilesService.listFollowers(req.user.sub, idOrUsername));
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/:idOrUsername/following')
  async following(@Req() req: { user: JwtPayload }, @Param('idOrUsername') idOrUsername: string) {
    return ok('Following', await this.profilesService.listFollowing(req.user.sub, idOrUsername));
  }

  @UseGuards(JwtAuthGuard)
  @Post('users/:id/follow')
  async follow(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Followed', await this.profilesService.follow(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('users/:id/follow')
  async unfollow(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Unfollowed', await this.profilesService.unfollow(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('users/:followerId/follow/accept')
  async accept(@Req() req: { user: JwtPayload }, @Param('followerId') followerId: string) {
    return ok('Accepted', await this.profilesService.acceptFollow(req.user.sub, followerId));
  }

  @UseGuards(JwtAuthGuard)
  @Post('users/:id/block')
  async block(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Blocked', await this.profilesService.block(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('users/:id/block')
  async unblock(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Unblocked', await this.profilesService.unblock(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('reports')
  async report(@Req() req: { user: JwtPayload }, @Body() dto: ReportDto) {
    return ok('Report filed', await this.profilesService.report(req.user.sub, dto));
  }
}
