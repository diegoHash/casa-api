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
  DeleteChargeNoticeDto,
  CreateExpenseCategoryDto,
  CreateExpenseConceptDto,
  CreateVendorDto,
  ListExpenseConceptsQueryDto,
  ListVendorsQueryDto,
  CreateOwnerPaymentDto,
  CreatePaymentApplicationDto,
  CreatePeriodExpenseDto,
  CreateVendorPayableDto,
  CreatePayableReminderDto,
  PayVendorPayableDto,
  PrepareChargeNoticeDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseConceptDto,
  UpdateVendorPayableDto,
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

  @Get('properties/:propertyId/payment-balance')
  @RequireScopes('billing.read')
  ownerPaymentBalance(@CurrentAuth() auth: AuthPrincipal, @Param('propertyId') propertyId: string) {
    return this.billing.ownerPaymentBalance(auth.communityId as string, propertyId);
  }

  @Get('exchange-rate/official')
  @RequireScopes('billing.read')
  officialExchangeRate() {
    return this.billing.officialExchangeRate();
  }

  @Post('owner-payments')
  @RequireScopes('billing.write')
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

  @Post('owner-payments/:paymentId/reconcile')
  @RequireScopes('billing.payments.reconcile')
  reconcileOwnerPayment(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('paymentId') paymentId: string,
  ) {
    return this.billing.reconcileOwnerPayment(
      auth.communityId as string,
      auth,
      paymentId,
    );
  }

  @Post('payment-applications')
  @RequireScopes('billing.payments.apply')
  createPaymentApplication(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreatePaymentApplicationDto,
  ) {
    return this.billing.createPaymentApplication(
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
  createVendor(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateVendorDto,
  ) {
    return this.billing.createVendor(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Get('payables')
  @RequireScopes('billing.read')
  listPayables(@CurrentAuth() auth: AuthPrincipal) {
    return this.billing.listPayables(auth.communityId as string);
  }

  @Post('payables')
  @RequireScopes('billing.write')
  createPayable(@CurrentAuth() auth: AuthPrincipal, @Body() input: CreateVendorPayableDto) {
    return this.billing.createPayable(auth.communityId as string, auth.userId, input);
  }

  @Patch('payables/:payableId')
  @RequireScopes('billing.write')
  updatePayable(@CurrentAuth() auth: AuthPrincipal, @Param('payableId') payableId: string, @Body() input: UpdateVendorPayableDto) {
    return this.billing.updatePayable(auth.communityId as string, auth.userId, payableId, input);
  }

  @Post('payables/:payableId/pay')
  @RequireScopes('billing.write')
  payPayable(@CurrentAuth() auth: AuthPrincipal, @Param('payableId') payableId: string, @Body() input: PayVendorPayableDto) {
    return this.billing.payPayable(auth.communityId as string, auth.userId, payableId, input);
  }

  @Get('payables/:payableId/reminders')
  @RequireScopes('billing.read')
  listPayableReminders(@CurrentAuth() auth: AuthPrincipal, @Param('payableId') payableId: string) {
    return this.billing.listPayableReminders(auth.communityId as string, payableId);
  }

  @Post('payables/:payableId/reminders')
  @RequireScopes('billing.write')
  createPayableReminder(@CurrentAuth() auth: AuthPrincipal, @Param('payableId') payableId: string, @Body() input: CreatePayableReminderDto) {
    return this.billing.createPayableReminder(auth.communityId as string, auth.userId, payableId, input);
  }

  @Post('payable-reminders/:reminderId/cancel')
  @RequireScopes('billing.write')
  cancelPayableReminder(@CurrentAuth() auth: AuthPrincipal, @Param('reminderId') reminderId: string) {
    return this.billing.cancelPayableReminder(auth.communityId as string, auth.userId, reminderId);
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

  @Post('charge-notices/:noticeId/delete')
  @RequireScopes('billing.write')
  deleteChargeNotice(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('noticeId') noticeId: string,
    @Body() input: DeleteChargeNoticeDto,
  ) {
    return this.billing.deleteChargeNotice(
      auth.communityId as string,
      auth.userId,
      noticeId,
      input,
    );
  }

  @Post('charge-notices/:noticeId/void')
  @RequireScopes('billing.write')
  voidChargeNotice(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('noticeId') noticeId: string,
  ) {
    return this.billing.voidChargeNotice(
      auth.communityId as string,
      auth.userId,
      noticeId,
    );
  }
}
