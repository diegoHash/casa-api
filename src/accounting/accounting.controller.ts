import {
  Body,
  Controller,
  Delete,
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
import { AccountingService } from './accounting.service';
import {
  CreateAccountingPeriodDto,
  CreateJournalEntryDto,
  CreateLedgerAccountDto,
  ReverseJournalEntryDto,
  UpdateLedgerAccountDto,
} from './dto/accounting.dto';

@Controller('accounting')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('snapshot')
  @RequireScopes('accounting.read')
  snapshot(@CurrentAuth() auth: AuthPrincipal) {
    return this.accounting.snapshot(auth.communityId as string);
  }

  @Get('receivables')
  @RequireScopes('accounting.read')
  receivables(@CurrentAuth() auth: AuthPrincipal) {
    return this.accounting.receivables(auth.communityId as string);
  }

  @Post('accounts')
  @RequireScopes('accounting.accounts_manage')
  createAccount(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateLedgerAccountDto,
  ) {
    return this.accounting.createAccount(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Patch('accounts/:id')
  @RequireScopes('accounting.accounts_manage')
  updateAccount(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateLedgerAccountDto,
  ) {
    return this.accounting.updateAccount(
      auth.communityId as string,
      auth.userId,
      id,
      input,
    );
  }

  @Delete('accounts/:id')
  @RequireScopes('accounting.accounts_manage')
  deleteAccount(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.accounting.deleteAccount(
      auth.communityId as string,
      auth.userId,
      id,
    );
  }

  @Post('periods')
  @RequireScopes('accounting.close_period')
  createPeriod(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateAccountingPeriodDto,
  ) {
    return this.accounting.createPeriod(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Post('entries')
  @RequireScopes('accounting.journal_post')
  createEntry(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateJournalEntryDto,
  ) {
    return this.accounting.createEntry(
      auth.communityId as string,
      auth.userId,
      input,
    );
  }

  @Post('entries/:entryId/post')
  @RequireScopes('accounting.journal_post')
  postEntry(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('entryId') entryId: string,
  ) {
    return this.accounting.postEntry(
      auth.communityId as string,
      auth.userId,
      entryId,
    );
  }

  @Post('entries/:entryId/reverse')
  @RequireScopes('accounting.journal_post')
  reverseEntry(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('entryId') entryId: string,
    @Body() input: ReverseJournalEntryDto,
  ) {
    return this.accounting.reverseEntry(
      auth.communityId as string,
      auth.userId,
      entryId,
      input,
    );
  }

  @Post('periods/:periodId/close')
  @RequireScopes('accounting.close_period')
  closePeriod(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('periodId') periodId: string,
  ) {
    return this.accounting.closePeriod(
      auth.communityId as string,
      auth.userId,
      periodId,
    );
  }

  @Get('ledger/:accountId')
  @RequireScopes('accounting.journal_read')
  getAccountLedger(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('accountId') accountId: string,
    @Query('periodId') periodId?: string,
  ) {
    return this.accounting.getAccountLedger(
      auth.communityId as string,
      accountId,
      periodId,
    );
  }

  @Get('reports/trial-balance')
  @RequireScopes('accounting.reports_view')
  getTrialBalance(
    @CurrentAuth() auth: AuthPrincipal,
    @Query('periodId') periodId?: string,
  ) {
    return this.accounting.getTrialBalance(
      auth.communityId as string,
      periodId,
    );
  }

  @Get('reports/income-statement')
  @RequireScopes('accounting.reports_view')
  getIncomeStatement(
    @CurrentAuth() auth: AuthPrincipal,
    @Query('periodId') periodId?: string,
  ) {
    return this.accounting.getIncomeStatement(
      auth.communityId as string,
      periodId,
    );
  }

  @Get('reports/balance-sheet')
  @RequireScopes('accounting.reports_view')
  getBalanceSheet(
    @CurrentAuth() auth: AuthPrincipal,
    @Query('periodId') periodId?: string,
  ) {
    return this.accounting.getBalanceSheet(
      auth.communityId as string,
      periodId,
    );
  }
}
