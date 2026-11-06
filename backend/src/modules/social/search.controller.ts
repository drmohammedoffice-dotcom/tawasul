import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { SearchService } from './search.service';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @Req() req: { user: JwtPayload },
    @Query('q') q?: string,
    @Query('limit') limit?: string
  ) {
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query) {
      throw new BadRequestException('q is required');
    }
    return ok(
      'Search results',
      await this.searchService.search(req.user.sub, query, limit ? Number(limit) : 20)
    );
  }
}
