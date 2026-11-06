import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { AccountSettingsService } from './account-settings.service';
import { BusinessService } from './business.service';
import { CloseFriendsService } from './close-friends.service';
import { HighlightsService } from './highlights.service';
import { MediaStorageService } from '../media/media.storage';
import { MessagingProvider } from './messaging-provider';
import { PhoneAuthService } from './phone-auth.service';
import { StoreService } from './store.service';
import { VerificationService } from './verification.service';

class SwitchBusinessDto {
  @IsString() categoryKey!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) businessName?: string;
  @IsOptional() @IsString() subcategoryKey?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

class CatalogProductDto {
  @IsString() postId!: string;
  @IsNumber() priceIqd!: number;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() inStock?: boolean;
  @IsOptional() @IsNumber() deliveryFeeIqd?: number | null;
  @IsOptional() @IsNumber() sortOrder?: number;
}

class PatchCatalogProductDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsNumber() priceIqd?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() inStock?: boolean;
  @IsOptional() @IsNumber() deliveryFeeIqd?: number | null;
  @IsOptional() @IsNumber() sortOrder?: number;
}

class StoreOrderItemDto {
  @IsString() productId!: string;
  @IsNumber() quantity!: number;
}

class PlaceStoreOrderDto {
  @IsString() @MinLength(2) @MaxLength(120) customerName!: string;
  @IsString() phone!: string;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @IsString() @MinLength(2) @MaxLength(80) governorate!: string;
  @IsString() @MinLength(2) @MaxLength(120) area!: string;
  @IsOptional() @IsString() @MaxLength(200) landmark?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreOrderItemDto)
  items!: StoreOrderItemDto[];
}

class UpdateBusinessDto {
  @IsOptional() @IsString() @MaxLength(120) businessName?: string;
  @IsOptional() @IsString() categoryKey?: string;
  @IsOptional() @IsString() subcategoryKey?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsString() websiteUrl?: string | null;
  @IsOptional() externalLinks?: unknown;
  @IsOptional() @IsString() contactPhone?: string | null;
  @IsOptional() @IsString() addressText?: string | null;
  @IsOptional() @IsNumber() latitude?: number | null;
  @IsOptional() @IsNumber() longitude?: number | null;
  @IsOptional() @IsString() mapsPlaceId?: string | null;
  @IsOptional() @IsNumber() defaultDeliveryFeeIqd?: number;
}

class VerifDocDto {
  @IsString() docType!: string;
  @IsString() mediaId!: string;
  @IsString() @MinLength(32) contentHash!: string;
}

class SubmitVerificationDto {
  @IsIn(['licensed_business', 'individual_seller'])
  track!: 'licensed_business' | 'individual_seller';
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() categoryKey?: string;
  @IsOptional() @IsString() applicantName?: string;
  @IsOptional() @IsString() nationalId?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VerifDocDto)
  documents!: VerifDocDto[];
  @IsBoolean() attested!: boolean;
}

class AdminReviewDto {
  @IsIn(['approved', 'rejected', 'more_info_required'])
  status!: 'approved' | 'rejected' | 'more_info_required';
  @IsOptional() @IsString() @MaxLength(1000) adminNote?: string;
}

class PhoneOtpDto {
  @IsString() phone!: string;
  @IsOptional() @IsString() dialPrefix?: string;
  @IsIn(['register', 'login', 'link']) purpose!: 'register' | 'login' | 'link';
  @IsOptional() @IsIn(['sms', 'whatsapp']) channel?: 'sms' | 'whatsapp';
}

class PhoneVerifyDto {
  @IsString() phone!: string;
  @IsOptional() @IsString() dialPrefix?: string;
  @IsString() @Length(4, 8) code!: string;
  @IsIn(['register', 'login']) purpose!: 'register' | 'login';
  @IsString() @MinLength(8) deviceId!: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) interestKeys?: string[];
  @IsOptional() @IsString() email2faCode?: string;
}

@Controller()
export class AccountsController {
  constructor(
    private readonly business: BusinessService,
    private readonly store: StoreService,
    private readonly verification: VerificationService,
    private readonly highlights: HighlightsService,
    private readonly closeFriends: CloseFriendsService,
    private readonly settings: AccountSettingsService,
    private readonly phoneAuth: PhoneAuthService,
    private readonly mediaStorage: MediaStorageService,
    private readonly messaging: MessagingProvider
  ) {}

  @Get('business/categories')
  categories() {
    return ok('Business categories', this.business.listCategories());
  }

  @UseGuards(JwtAuthGuard)
  @Get('business/me')
  async myBusiness(@Req() req: { user: JwtPayload }) {
    return ok('Business profile', await this.business.getMine(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Post('business/switch')
  async switchBusiness(@Req() req: { user: JwtPayload }, @Body() dto: SwitchBusinessDto) {
    return ok('Switched to business', await this.business.switchToBusiness(req.user.sub, dto));
  }

  @UseGuards(JwtAuthGuard)
  @Post('business/switch-personal')
  async switchPersonal(@Req() req: { user: JwtPayload }) {
    return ok('Switched to personal', await this.business.switchToPersonal(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Get('business/insights')
  async businessInsights(@Req() req: { user: JwtPayload }) {
    return ok('Business insights', await this.business.insights(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('business/me')
  async updateBusiness(@Req() req: { user: JwtPayload }, @Body() dto: UpdateBusinessDto) {
    return ok('Business updated', await this.business.updateProfile(req.user.sub, dto));
  }

  /** Must be registered before `store/:idOrUsername/catalog` or "me" is treated as a username. */
  @UseGuards(JwtAuthGuard)
  @Get('store/owner/catalog')
  async myStoreCatalog(@Req() req: { user: JwtPayload }) {
    return ok('My catalog', await this.store.listOwnerCatalog(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Get('store/:idOrUsername/catalog')
  async storeCatalog(@Param('idOrUsername') idOrUsername: string) {
    return ok('Catalog', await this.store.catalogForSeller(idOrUsername));
  }

  @UseGuards(JwtAuthGuard)
  @Post('store/products')
  async upsertStoreProduct(@Req() req: { user: JwtPayload }, @Body() dto: CatalogProductDto) {
    return ok('Product saved', await this.store.upsertProduct(req.user.sub, dto));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('store/products/:id')
  async patchStoreProduct(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: PatchCatalogProductDto
  ) {
    return ok('Product updated', await this.store.updateProduct(req.user.sub, id, dto));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('store/products/:id')
  async deleteStoreProduct(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Product removed', await this.store.removeProduct(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Get('store/orders')
  async myStoreOrders(@Req() req: { user: JwtPayload }) {
    return ok('Store orders', await this.store.listSellerOrders(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Post('store/:idOrUsername/orders')
  async placeStoreOrder(
    @Req() req: { user: JwtPayload },
    @Param('idOrUsername') idOrUsername: string,
    @Body() dto: PlaceStoreOrderDto
  ) {
    return ok(
      'Order placed',
      await this.store.placeOrder(req.user.sub, idOrUsername, {
        customerName: dto.customerName,
        phone: dto.phone,
        governorate: dto.governorate,
        area: dto.area,
        items: dto.items,
        ...(dto.countryCode ? { countryCode: dto.countryCode } : {}),
        ...(dto.landmark ? { landmark: dto.landmark } : {})
      })
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/:idOrUsername/business/location')
  async businessLocation(@Param('idOrUsername') idOrUsername: string) {
    return ok('Business location', await this.business.publicLocation(idOrUsername));
  }

  @UseGuards(JwtAuthGuard)
  @Get('verification/me')
  async myVerification(@Req() req: { user: JwtPayload }) {
    return ok('Verification status', await this.verification.myStatus(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Post('verification/submit')
  async submitVerification(@Req() req: { user: JwtPayload }, @Body() dto: SubmitVerificationDto) {
    return ok('Verification submitted', await this.verification.submit(req.user.sub, dto));
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/verification')
  async adminList(
    @Req() req: { user: JwtPayload },
    @Query('status') status?: 'pending_review' | 'approved' | 'rejected' | 'more_info_required'
  ) {
    return ok('Verification queue', await this.verification.adminList(req.user.sub, status));
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/verification/:id')
  async adminGet(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok(
      'Verification detail',
      await this.verification.adminGet(req.user.sub, id, (mediaId, key) =>
        this.mediaStorage.createReadUrl(mediaId, key)
      )
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/verification/:id/review')
  async adminReview(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: AdminReviewDto
  ) {
    return ok('Reviewed', await this.verification.adminReview(req.user.sub, id, dto));
  }

  /** Public status of OTP wiring — never returns secrets or codes. */
  @Get('auth/otp/provider-status')
  otpProviderStatus() {
    return ok('OTP provider status', this.messaging.providerStatus());
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/:idOrUsername/highlights')
  async listHighlights(@Req() req: { user: JwtPayload }, @Param('idOrUsername') idOrUsername: string) {
    return ok('Highlights', await this.highlights.listForProfile(req.user.sub, idOrUsername));
  }

  @UseGuards(JwtAuthGuard)
  @Get('highlights/:id')
  async getHighlight(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Highlight', await this.highlights.getItems(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('highlights')
  async createHighlight(
    @Req() req: { user: JwtPayload },
    @Body() body: { title: string; coverMediaId?: string; storyIds?: string[] }
  ) {
    return ok('Highlight created', await this.highlights.create(req.user.sub, body));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('highlights/:id')
  async updateHighlight(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { title?: string; coverMediaId?: string | null; sortOrder?: number }
  ) {
    return ok('Highlight updated', await this.highlights.update(req.user.sub, id, body));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('highlights/:id')
  async deleteHighlight(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Highlight deleted', await this.highlights.remove(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('highlights/:id/stories')
  async addHighlightStories(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { storyIds: string[] }
  ) {
    return ok('Stories added', await this.highlights.addStories(req.user.sub, id, body.storyIds || []));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('highlights/:id/media/:mediaId')
  async removeHighlightMedia(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Param('mediaId') mediaId: string
  ) {
    return ok('Removed', await this.highlights.removeItem(req.user.sub, id, mediaId));
  }

  @UseGuards(JwtAuthGuard)
  @Get('close-friends')
  async listCloseFriends(@Req() req: { user: JwtPayload }) {
    return ok('Close friends', await this.closeFriends.list(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Get('close-friends/candidates')
  async closeFriendCandidates(@Req() req: { user: JwtPayload }) {
    return ok('Candidates', await this.closeFriends.candidates(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Post('close-friends/:friendId')
  async addCloseFriend(@Req() req: { user: JwtPayload }, @Param('friendId') friendId: string) {
    return ok('Added', await this.closeFriends.add(req.user.sub, friendId));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('close-friends/:friendId')
  async removeCloseFriend(@Req() req: { user: JwtPayload }, @Param('friendId') friendId: string) {
    return ok('Removed', await this.closeFriends.remove(req.user.sub, friendId));
  }

  @UseGuards(JwtAuthGuard)
  @Get('account')
  async accountInfo(@Req() req: { user: JwtPayload }) {
    return ok('Account', await this.settings.accountInfo(req.user.sub));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('account/country')
  async setCountry(@Req() req: { user: JwtPayload }, @Body() body: { countryCode: string }) {
    return ok('Country updated', await this.settings.updateCountry(req.user.sub, body.countryCode));
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/interests')
  async setInterests(@Req() req: { user: JwtPayload }, @Body() body: { keys: string[] }) {
    return ok('Interests saved', await this.settings.setInterests(req.user.sub, body.keys || []));
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/password')
  async changePassword(
    @Req() req: { user: JwtPayload },
    @Body() body: { currentPassword: string; newPassword: string }
  ) {
    return ok(
      'Password changed',
      await this.settings.changePassword(req.user.sub, body.currentPassword, body.newPassword)
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/2fa/email/request')
  async request2fa(@Req() req: { user: JwtPayload }) {
    return ok('OTP requested', await this.settings.requestEmailOtp(req.user.sub, 'enable_2fa'));
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/2fa/email')
  async set2fa(@Req() req: { user: JwtPayload }, @Body() body: { enabled: boolean; code?: string }) {
    return ok(
      '2FA updated',
      await this.settings.setTwoFactorEmail(req.user.sub, body.enabled, body.code)
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/email/request')
  async requestLinkEmail(@Req() req: { user: JwtPayload }, @Body() body: { email: string }) {
    return ok('OTP sent', await this.settings.requestLinkEmailOtp(req.user.sub, body.email));
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/email/confirm')
  async confirmEmail(
    @Req() req: { user: JwtPayload },
    @Body() body: { email: string; code: string }
  ) {
    return ok('Email linked', await this.settings.linkEmail(req.user.sub, body.email, body.code));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account/sessions/:id')
  async revokeSession(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return ok('Session revoked', await this.settings.revokeSession(req.user.sub, id));
  }

  @UseGuards(JwtAuthGuard)
  @Get('account/blocked')
  async blocked(@Req() req: { user: JwtPayload }) {
    return ok('Blocked users', await this.settings.listBlocked(req.user.sub));
  }

  @Post('auth/phone/otp')
  async phoneOtp(@Body() dto: PhoneOtpDto) {
    return ok('OTP requested', await this.phoneAuth.requestOtp(dto));
  }

  @Post('auth/phone/verify')
  async phoneVerify(
    @Req() req: { ip?: string; headers: Record<string, string> },
    @Body() dto: PhoneVerifyDto
  ) {
    return ok(
      'Phone auth',
      await this.phoneAuth.verifyAndAuthenticate(dto, {
        ip: req.ip || '0.0.0.0',
        userAgent: req.headers['user-agent'] || 'unknown'
      })
    );
  }

  @Post('auth/phone/2fa/email')
  async phone2faEmail(
    @Body()
    body: {
      userId: string;
      phoneChallengeId: string;
      phone: string;
      dialPrefix?: string;
      purpose: 'register' | 'login';
      code: string;
    }
  ) {
    return ok(
      '2FA email OTP',
      await this.phoneAuth.requestEmail2faAfterPhoneChallenge({
        userId: body.userId,
        phoneChallengeId: body.phoneChallengeId,
        phone: body.phone,
        ...(body.dialPrefix ? { dialPrefix: body.dialPrefix } : {}),
        purpose: body.purpose || 'login',
        code: body.code
      })
    );
  }
}
