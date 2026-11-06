import { Body, Controller, Delete, Get, Put, Post, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { RegisterPushDeviceDto, RemovePushDeviceDto } from './dto/register-push-device.dto';
import { UpdateNotificationPrefsDto } from './dto/notification-prefs.dto';
import { PushService } from './push.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('push-status')
  status() {
    return ok('Push status', this.push.status());
  }

  @Post('devices')
  async register(@Req() req: { user: JwtPayload }, @Body() dto: RegisterPushDeviceDto) {
    return ok('Device registered', await this.push.registerDevice(req.user.sub, dto.token, dto.platform));
  }

  @Delete('devices')
  async remove(@Req() req: { user: JwtPayload }, @Body() dto: RemovePushDeviceDto) {
    return ok('Device removed', await this.push.removeDevice(req.user.sub, dto.token));
  }

  @Get('preferences')
  async prefs(@Req() req: { user: JwtPayload }) {
    return ok('Notification preferences', await this.push.getPrefs(req.user.sub));
  }

  @Put('preferences')
  async savePrefs(@Req() req: { user: JwtPayload }, @Body() dto: UpdateNotificationPrefsDto) {
    return ok('Notification preferences saved', await this.push.savePrefs(req.user.sub, dto));
  }
}
