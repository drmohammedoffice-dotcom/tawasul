import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ContactsService } from './contacts.service';

class MatchPhonesDto {
  @IsArray()
  @IsString({ each: true })
  hashes!: string[];
}

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('suggested')
  async suggested(@Req() req: { user: JwtPayload }, @Query('q') q?: string) {
    return ok('Contacts loaded', await this.contacts.suggested(req.user.sub, q));
  }

  @Post('match')
  async match(@Req() req: { user: JwtPayload }, @Body() dto: MatchPhonesDto) {
    return ok('Phone matches', await this.contacts.matchPhoneHashes(req.user.sub, dto.hashes || []));
  }
}
