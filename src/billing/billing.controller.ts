import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { BillingService } from './billing.service';
import {
  CreateBillingPeriodDto,
  CreateExpenseCategoryDto,
  CreateExpenseConceptDto,
  CreateVendorDto,
  ListExpenseConceptsQueryDto,
  ListVendorsQueryDto,
  CreateOwnerPaymentDto,
  CreatePeriodExpenseDto,
  PrepareChargeNoticeDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseConceptDto,
} from './dto/billing.dto';

@Controller('billing')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('snapshot')
  @RequireScopes('billing.read')
  snapshot(@CurrentAuth() auth: AuthPrincipal) {
    return this.billing.snapshot(auth.communityId as string);
  }

  @Get('exchange-rate/official')
  @RequireScopes('billing.read')
  officialExchangeRate() {
    return this.billing.officialExchangeRate();
  }

  @Post('owner-payments')
  @RequireScopes('billing.write', 'accounting.post')
  createOwnerPayment(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateOwnerPaymentDto,
  ) {
    return this.billing.createOwnerPayment(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Post('categories')
  @RequireScopes('billing.write')
  createCategory(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateExpenseCategoryDto,
  ) {
    return this.billing.createCategory(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Patch('categories/:categoryId')
  @RequireScopes('billing.write')
  updateCategory(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('categoryId') categoryId: string,
    @Body() input: UpdateExpenseCategoryDto,
  ) {
    return this.billing.updateCategory(
      auth.communityId as string,
      auth.userId,
      categoryId,
      input,
    );
  }

  @Get('concepts')
  @RequireScopes('billing.read')
  listConcepts(
    @CurrentAuth() auth: AuthPrincipal,
    @Query() query: ListExpenseConceptsQueryDto,
  ) {
    return this.billing.listConcepts(auth.communityId as string, query);
  }

  @Get('vendors')
  @RequireScopes('billing.read')
  listVendors(
    @CurrentAuth() auth: AuthPrincipal,
    @Query() query: ListVendorsQueryDto,
  ) {
    return this.billing.listVendors(auth.communityId as string, query);
  }

  @Post('vendors')
  @RequireScopes('billing.write')
  createVendor(@CurrentAuth() auth: AuthPrincipal, @Body() input: CreateVendorDto) {
    return this.billing.createVendor(auth.communityId as string, auth.userId, input);
  }

  @Post('categories/:categoryId/concepts')
  @RequireScopes('billing.write')
  createConcept(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('categoryId') categoryId: string,
    @Body() input: CreateExpenseConceptDto,
  ) {
    return this.billing.createConcept(
      auth.communityId as string,
      auth.userId,
      categoryId,
      input,
    );
  }

  @Patch('concepts/:conceptId')
  @RequireScopes('billing.write')
  updateConcept(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('conceptId') conceptId: string,
    @Body() input: UpdateExpenseConceptDto,
  ) {
    return this.billing.updateConcept(
      auth.communityId as string,
      auth.userId,
      conceptId,
      input,
    );
  }

  @Post('periods')
  @RequireScopes('billing.write')
  createPeriod(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateBillingPeriodDto,
  ) {
    return this.billing.createPeriod(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Post('periods/:periodId/expenses')
  @RequireScopes('billing.write', 'accounting.post')
  createExpense(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('periodId') periodId: string,
    @Body() input: CreatePeriodExpenseDto,
  ) {
    return this.billing.createExpense(
      auth.communityId as string,
      auth.userId,
      periodId,
      input,
    );
  }

  @Post('periods/:periodId/charge-notice/prepare')
  @RequireScopes('billing.write')
  prepareChargeNotice(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('periodId') periodId: string,
    @Body() input: PrepareChargeNoticeDto,
  ) {
    return this.billing.prepareChargeNotice(
      auth.communityId as string,
      auth.userId,
      periodId,
      input,
    );
  }

  @Post('charge-notices/:noticeId/issue')
  @RequireScopes('billing.write')
  issueChargeNotice(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('noticeId') noticeId: string,
  ) {
    return this.billing.issueChargeNotice(
      auth.communityId as string,
      auth.userId,
      noticeId,
    );
  }
}
