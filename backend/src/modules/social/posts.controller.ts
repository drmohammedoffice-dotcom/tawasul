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
import { PostsService } from './posts.service';

class CreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  mediaIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  hashtags!: string[];

  @IsOptional()
  @IsIn(['1:1', '3:4'])
  aspectRatio?: '1:1' | '3:4';

  @IsOptional()
  @IsString()
  @Length(8, 64)
  clientRequestId?: string;
}

class CommentDto {
  @IsString()
  @Length(1, 1000)
  body!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  mediaIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  hashtags?: string[];

  @IsOptional()
  @IsIn(['1:1', '3:4'])
  aspectRatio?: '1:1' | '3:4';
}

@Controller()
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post('posts')
  async create(@Req() req: { user: JwtPayload }, @Body() dto: CreatePostDto) {
    return ok('Post created', await this.postsService.create(req.user.sub, dto));
  }

  @Get('feed')
  async feed(
    @Req() req: { user: JwtPayload },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok('Feed', await this.postsService.feed(req.user.sub, cursor, limit ? Number(limit) : 20));
  }

  @Get('explore')
  async explore(
    @Req() req: { user: JwtPayload },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'Explore',
      await this.postsService.explore(req.user.sub, cursor, limit ? Number(limit) : 36)
    );
  }

  @Get('hashtags/:tag')
  async hashtag(
    @Req() req: { user: JwtPayload },
    @Param('tag') tag: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'Hashtag',
      await this.postsService.hashtagFeed(req.user.sub, tag, cursor, limit ? Number(limit) : 20)
    );
  }

  @Post('posts/:id/view')
  async view(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('View recorded', await this.postsService.view(req.user.sub, id));
  }

  @Post('posts/:id/like')
  async like(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Liked', await this.postsService.like(req.user.sub, id));
  }

  @Delete('posts/:id/like')
  async unlike(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Unliked', await this.postsService.unlike(req.user.sub, id));
  }

  @Get('posts/:id/comments')
  async listComments(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'Comments',
      await this.postsService.listComments(req.user.sub, id, cursor, limit ? Number(limit) : 40)
    );
  }

  @Post('posts/:id/comments')
  async comment(@Req() req: { user: JwtPayload }, @Param('id') id: string, @Body() dto: CommentDto) {
    return ok('Comment created', await this.postsService.comment(req.user.sub, id, dto.body, dto.parentId));
  }

  @Delete('posts/:id/comments/:commentId')
  async deleteComment(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Param('commentId') commentId: string
  ) {
    return ok('Comment deleted', await this.postsService.deleteComment(req.user.sub, id, commentId));
  }

  @Post('posts/:id/bookmark')
  async bookmark(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Bookmarked', await this.postsService.bookmark(req.user.sub, id));
  }

  @Delete('posts/:id/bookmark')
  async unbookmark(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Unbookmarked', await this.postsService.unbookmark(req.user.sub, id));
  }

  @Get('bookmarks')
  async listBookmarks(
    @Req() req: { user: JwtPayload },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'Bookmarks',
      await this.postsService.listBookmarks(
        req.user.sub,
        cursor,
        limit ? Number(limit) : 20
      )
    );
  }

  @Get('users/:idOrUsername/posts')
  async userPosts(
    @Req() req: { user: JwtPayload },
    @Param('idOrUsername') idOrUsername: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      'User posts',
      await this.postsService.postsByUser(
        req.user.sub,
        idOrUsername,
        cursor,
        limit ? Number(limit) : 20
      )
    );
  }

  @Get('posts/:id')
  async getOne(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Post', await this.postsService.getById(req.user.sub, id));
  }

  @Patch('posts/:id')
  async update(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: UpdatePostDto
  ) {
    return ok('Post updated', await this.postsService.update(req.user.sub, id, dto));
  }

  @Delete('posts/:id')
  async remove(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Post deleted', await this.postsService.deletePost(req.user.sub, id));
  }
}
